// Organizer-only extras of a cloud group (DECISIONS → "Players and live evening — organizer side (v10)"),
// mounted by SyncProvider and kept apart from the doc sync:
// - publishes tonight (teams, match, clock…) to group_live for players and other organizers;
// - reads players' level votes and folds them into the levels (applyPlayerVotes) after every sync round.
import type { SupabaseClient } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GroupMeta } from '../state/groups';
import type { AppState } from '../state/model';
import { localKV, useGroups, useStore } from '../state/store';
import { liveApi, liveFromState, type LiveData } from './live';
import { eveningEnded, justEnded, withPlayerVotes } from './organizer';
import { eveningId } from '../state/history';
import { playersApi, type VoteRow } from './players';
import { createLivePublisher, shouldRepublish } from './publish';
import { useSync } from './SyncProvider';

/** A cloud group this phone organizes (a player's group, once the app has them, says role 'player'). */
export const isOrganizerGroup = (g: GroupMeta) => g.synced && (g as GroupMeta & { role?: string }).role !== 'player';

/** This phone published a live evening that it hasn't ended yet (survives a crash / reload). */
const MINE = (gid: string) => `kochot:liveMine:${gid}`;
const isMine = (gid: string) => localKV.get(MINE(gid)) === true;
/** eveningId of teams whose evening was ended without anything saved (see eveningEnded). */
const ENDED = (gid: string) => `kochot:liveEnded:${gid}`;
const endedId = (gid: string) => {
  const v = localKV.get(ENDED(gid));
  return typeof v === 'string' ? v : null;
};

const liveOf = (gid: string, s: AppState): LiveData | null =>
  eveningEnded(s, endedId(gid)) ? null : liveFromState({ result: s.result, match: s.match, players: s.players, settings: s.settings, now: Date.now() });

interface VotesApi {
  /** Players' votes that count in the open group (organizer groups only; [] otherwise). */
  rows: VoteRow[];
  /** Read the votes again now (after allowing/removing a rater). */
  refresh(): void;
}
const VotesCtx = createContext<VotesApi>({ rows: [], refresh: () => {} });
export const usePlayerVotes = () => useContext(VotesCtx);

export function OrganizerSync({ children }: { children: ReactNode }) {
  const sync = useSync();
  const groups = useGroups();
  const { state } = useStore();
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const cur = groups.current;
  const me = sync.userId;
  const active = !!me && isOrganizerGroup(cur);
  const gid = cur.id;
  const getClient = sync.client; // stable
  const clientRef = useRef<SupabaseClient | null>(null);
  const client = useCallback(async () => (clientRef.current ??= await getClient()), [getClient]);

  // ---------- live evening ----------
  const publisher = useMemo(
    () =>
      createLivePublisher({
        send: async (g, live) => liveApi(await client()).set(g, live),
        onSent: (g, live) => (live ? localKV.set(MINE(g), true) : localKV.remove(MINE(g))),
      }),
    [client],
  );
  useEffect(() => () => publisher.dispose(), [publisher]);

  // Open / back on screen: republish (a crashed phone mustn't leave a stale row), unless another
  // organizer's phone is running the evening right now; then only our own changes are sent.
  const activeRef = useRef(active);
  activeRef.current = active;
  const onOpen = useCallback(async () => {
    const { gid: g, app } = groupsRef.current.latest();
    const live = liveOf(g, app);
    publisher.baseline(g, live);
    if (!live) {
      if (isMine(g)) publisher.republish(g, null);
      return;
    }
    try {
      const row = await liveApi(await client()).get(g);
      if (activeRef.current && groupsRef.current.latest().gid === g && shouldRepublish(row, me ?? '')) publisher.republish(g, liveOf(g, groupsRef.current.latest().app));
    } catch {
      if (activeRef.current) publisher.republish(g, live); // offline: queued until 'online'
    }
  }, [publisher, client, me]);

  useEffect(() => {
    if (!active) return;
    void onOpen();
    const onVisible = () => document.visibilityState === 'visible' && void onOpen();
    const onOnline = () => void publisher.flush();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [active, gid, onOpen, publisher]);

  // Tonight changed (teams, goal, clock, borrow, end of match/evening, new day…).
  const prev = useRef({ gid, state });
  useEffect(() => {
    const was = prev.current;
    prev.current = { gid, state };
    if (was.gid === gid && justEnded(was.state, state) && state.result) localKV.set(ENDED(gid), eveningId(state.result));
    if (!active) return;
    const live = liveOf(gid, state);
    if (live || isMine(gid)) publisher.update(gid, live);
  }, [active, gid, state, publisher]);

  // ---------- players' votes ----------
  const [votes, setVotes] = useState<{ gid: string; rows: VoteRow[] }>({ gid: '', rows: [] });
  const fetching = useRef(false);
  const loadVotes = useCallback(async () => {
    if (!activeRef.current || fetching.current) return;
    const g = groupsRef.current.latest().gid;
    fetching.current = true;
    try {
      const rows = await playersApi(await client()).groupVotes(g);
      setVotes((v) => (v.gid === g && sameRows(v.rows, rows) ? v : { gid: g, rows }));
      const { gid: open, app } = groupsRef.current.latest();
      // Only when a level actually changes: that edit is pushed by the next round, which applies again and finds nothing.
      if (open === g && withPlayerVotes(app, rows) !== app) groupsRef.current.setGroupState(g, (s) => withPlayerVotes(s, rows));
    } catch {
      /* offline or not allowed: keep what we have */
    } finally {
      fetching.current = false;
    }
  }, [client]);

  // After every sync round (each one goes through 'syncing' → 'synced').
  useEffect(() => {
    if (active && sync.status === 'synced') void loadVotes();
  }, [active, gid, sync.status, loadVotes]);

  const value = useMemo<VotesApi>(
    () => ({ rows: active && votes.gid === gid ? votes.rows : [], refresh: () => void loadVotes() }),
    [active, gid, votes, loadVotes],
  );
  return <VotesCtx.Provider value={value}>{children}</VotesCtx.Provider>;
}

const sameRows = (a: VoteRow[], b: VoteRow[]) =>
  a.length === b.length && a.every((r, i) => r.rater === b[i].rater && r.playerId === b[i].playerId && r.level === b[i].level);
