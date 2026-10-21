// The open player group (role 'player'): its public copy (roster names, history, my claim and
// whether I may rate), the live evening and my votes. Kept apart from SyncProvider's organizer
// sync on purpose: nothing here ever reads or writes `groups`.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { newGroupState } from '../state/groups';
import { localKV, useGroups } from '../state/store';
import { EMPTY_META, saveMeta } from './engine';
import { liveApi, type LiveRow } from './live';
import { isPlayerGroup, loadPublic, publicKey, publicToState } from './playerGroup';
import { playersApi, type PublicGroup } from './players';
import { SyncError } from './supabase';
import { useSync } from './SyncProvider';

export type PlayerLoad = 'loading' | 'ok' | 'offline' | 'denied' | 'error' | 'signedOut';

interface PlayerGroupApi {
  /** The open group is a player group. */
  active: boolean;
  pub: PublicGroup | null;
  live: LiveRow | null;
  /** My votes ({} until loaded or when I may not rate). */
  votes: Record<string, number>;
  load: PlayerLoad;
  /** "This is me". Resolves to an error code, or null when it worked. */
  claim(playerId: string): Promise<SyncError['code'] | null>;
  /** One vote (null takes it back). Resolves false when it didn't reach the server. */
  vote(playerId: string, level: number | null): Promise<boolean>;
  refresh(): void;
}

const Ctx = createContext<PlayerGroupApi | null>(null);
const code = (e: unknown): SyncError['code'] => (e instanceof SyncError ? e.code : 'other');

export function PlayerGroupProvider({ children }: { children: ReactNode }) {
  const groups = useGroups();
  const sync = useSync();
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const gid = groups.current.id;
  const active = isPlayerGroup(groups.current);

  const [pub, setPub] = useState<PublicGroup | null>(() => (active ? loadPublic(localKV, gid) : null));
  const [live, setLive] = useState<LiveRow | null>(null);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [load, setLoad] = useState<PlayerLoad>('loading');
  const [tick, setTick] = useState(0);

  // Another group opened: start from what this phone has.
  useEffect(() => {
    setPub(active ? loadPublic(localKV, gid) : null);
    setLive(null);
    setVotes({});
    setLoad('loading');
  }, [gid, active]);

  useEffect(() => {
    if (!active || !sync.userId) return;
    let off = false;
    const unsub: (() => void)[] = [];
    void (async () => {
      const c = await sync.client().catch(() => null);
      if (!c || off) return;
      const papi = playersApi(c);
      const lapi = liveApi(c);
      const fetchPublic = async () => {
        try {
          const p = await papi.getPublic(gid);
          if (off) return;
          if (!p) return setLoad('error');
          const g = groupsRef.current;
          if (p.me.role === 'organizer') {
            // Became an organizer (opened an organizer link on another phone): from now on this is
            // an ordinary synced group. Start from an empty state so nothing of the public copy is merged in.
            const { theme, accent } = g.latest().app.settings;
            g.setGroupState(gid, () => newGroupState({ theme, accent }));
            saveMeta(localKV, gid, EMPTY_META);
            localKV.remove(publicKey(gid));
            g.setMeta(gid, { role: undefined });
            return;
          }
          localKV.set(publicKey(gid), p);
          setPub(p);
          setLoad('ok');
          g.setGroupState(gid, (s) => publicToState(s, p));
          if (p.name && p.name !== g.latestIndex().groups.find((x) => x.id === gid)?.name) g.setMeta(gid, { name: p.name });
          if (p.me.canRate && p.me.playerId) {
            const v = await papi.myVotes(gid).catch(() => null);
            if (!off && v) setVotes(v);
          } else setVotes({});
        } catch (e) {
          if (!off) setLoad(code(e) === 'offline' ? 'offline' : code(e) === 'denied' ? 'denied' : 'error');
        }
      };
      const fetchLive = async () => {
        try {
          const row = await lapi.get(gid);
          if (!off) setLive(row);
        } catch {
          /* keep what is on screen */
        }
      };
      await Promise.all([fetchPublic(), fetchLive()]);
      if (off) return;
      unsub.push(lapi.subscribe(gid, (row) => setLive(row)));
      unsub.push(papi.subscribePublic(gid, () => void fetchPublic()));
      // Claims, "may rate" and being removed don't touch group_public: refresh on focus and slowly.
      const again = () => {
        if (document.visibilityState !== 'visible') return;
        void fetchPublic();
        void fetchLive();
      };
      document.addEventListener('visibilitychange', again);
      window.addEventListener('online', again);
      const poll = window.setInterval(again, 60_000);
      unsub.push(() => {
        document.removeEventListener('visibilitychange', again);
        window.removeEventListener('online', again);
        window.clearInterval(poll);
      });
    })();
    return () => {
      off = true;
      unsub.forEach((f) => f());
    };
  }, [active, gid, sync.userId, sync.client, tick]);

  const claim = useCallback(
    async (playerId: string) => {
      try {
        await playersApi(await sync.client()).claimPlayer(gid, playerId);
        setPub((p) => (p ? { ...p, claimed: [...p.claimed, playerId], me: { ...p.me, playerId } } : p));
        setTick((t) => t + 1);
        return null;
      } catch (e) {
        if (code(e) === 'taken') setTick((t) => t + 1);
        return code(e);
      }
    },
    [gid, sync],
  );

  const vote = useCallback(
    async (playerId: string, level: number | null) => {
      const before = votes;
      setVotes((v) => {
        const next = { ...v };
        if (level === null) delete next[playerId];
        else next[playerId] = level;
        return next;
      });
      try {
        setVotes(await playersApi(await sync.client()).submitVotes(gid, { [playerId]: level }));
        return true;
      } catch {
        setVotes(before);
        return false;
      }
    },
    [gid, sync, votes],
  );

  const api = useMemo<PlayerGroupApi>(
    () => ({ active, pub, live, votes, load: sync.email === false ? 'signedOut' : load, claim, vote, refresh: () => setTick((t) => t + 1) }),
    [active, pub, live, votes, load, sync.email, claim, vote],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePlayerGroup() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePlayerGroup outside PlayerGroupProvider');
  return ctx;
}
