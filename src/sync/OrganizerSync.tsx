// Organizer-only extras of a cloud group (DECISIONS → "Players and live evening — organizer side (v10)"),
// mounted by SyncProvider and kept apart from the doc sync:
// - publishes tonight (teams, match, clock…) to group_live for players and other organizers;
// - reads players' level votes and folds them into the levels (applyPlayerVotes) after every sync round.
import type { SupabaseClient } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { GroupMeta } from '../state/groups';
import { localKV, useGroups, useStore } from '../state/store';
import { liveApi, type LiveRow } from './live';
import { justEnded, withPlayerVotes } from './organizer';
import { createOrganizerControl, ENDED, type TakeResult } from './organizerControl';
import { eveningId } from '../state/history';
import { playersApi, type VoteRow } from './players';
import { useSync } from './SyncProvider';

/** A cloud group this phone organizes (a player's group, once the app has them, says role 'player'). */
export const isOrganizerGroup = (g: GroupMeta) => g.synced && (g as GroupMeta & { role?: string }).role !== 'player';

interface VotesApi {
  /** Players' votes that count in the open group (organizer groups only; [] otherwise). */
  rows: VoteRow[];
  /** Read the votes again now (after allowing/removing a rater). */
  refresh(): void;
}
const VotesCtx = createContext<VotesApi>({ rows: [], refresh: () => {} });
export const usePlayerVotes = () => useContext(VotesCtx);

export interface LiveControlApi {
  /** Another phone runs tonight: this one shows it read-only (null = this phone runs it, or nothing is live). */
  viewer: LiveRow | null;
  /** "לקחת את הניהול בחזרה": take control and import what was played meanwhile. */
  takeBack(): Promise<TakeResult>;
  /** Before ending the evening: take control (and import) first if another phone runs it. */
  ensureRunner(): Promise<TakeResult>;
}
const ok = async (): Promise<TakeResult> => 'ok';
const ControlCtx = createContext<LiveControlApi>({ viewer: null, takeBack: ok, ensureRunner: ok });
export const useLiveControl = () => useContext(ControlCtx);

export function OrganizerSync({ children }: { children: ReactNode }) {
  const sync = useSync();
  const groups = useGroups();
  const { state } = useStore();
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const cur = groups.current;
  const me = sync.userId;
  const meRef = useRef(me);
  meRef.current = me;
  const active = !!me && isOrganizerGroup(cur);
  const gid = cur.id;
  const getClient = sync.client; // stable
  const clientRef = useRef<SupabaseClient | null>(null);
  const client = useCallback(async () => (clientRef.current ??= await getClient()), [getClient]);
  const activeRef = useRef(active);
  activeRef.current = active;

  // ---------- live evening: only the runner's phone writes (organizerControl.ts) ----------
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const ctl = useMemo(
    () =>
      createOrganizerControl({
        api: async () => liveApi(await client()),
        me: () => meRef.current,
        latest: () => groupsRef.current.latest(),
        setState: (g, update) => groupsRef.current.setGroupState(g, update),
        kv: localKV,
        onChange: rerender,
      }),
    [client],
  );
  useEffect(() => () => ctl.dispose(), [ctl]);

  // Open / back on screen: run it (republish, so a crashed phone doesn't leave a stale row) or view
  // it when another phone runs it. Changes on the row (someone took control, ended it) come live.
  useEffect(() => {
    if (!active) return;
    void ctl.open(gid);
    const onVisible = () => document.visibilityState === 'visible' && void ctl.open(gid);
    const onOnline = () => void ctl.flush();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    let unsub = () => {};
    let gone = false;
    void client().then((sb) => {
      if (!gone) unsub = liveApi(sb).subscribe(gid, (row) => ctl.row(gid, row));
    });
    return () => {
      gone = true;
      unsub();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [active, gid, ctl, client]);

  // Tonight changed (teams, goal, clock, borrow, end of match/evening, new day…).
  const prev = useRef({ gid, state });
  useEffect(() => {
    const was = prev.current;
    prev.current = { gid, state };
    if (was.gid === gid && justEnded(was.state, state) && state.result) localKV.set(ENDED(gid), eveningId(state.result));
    if (active) ctl.changed(gid, state);
  }, [active, gid, state, ctl]);

  const control = useMemo<LiveControlApi>(
    () => ({
      viewer: active ? ctl.viewer(gid) : null,
      takeBack: () => (activeRef.current ? ctl.takeBack(groupsRef.current.latest().gid) : ok()),
      ensureRunner: () => (activeRef.current ? ctl.ensureRunner(groupsRef.current.latest().gid) : ok()),
    }),
    [active, gid, ctl, ctl.viewer(gid)],
  );

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
  return (
    <ControlCtx.Provider value={control}>
      <VotesCtx.Provider value={value}>{children}</VotesCtx.Provider>
    </ControlCtx.Provider>
  );
}

const sameRows = (a: VoteRow[], b: VoteRow[]) =>
  a.length === b.length && a.every((r, i) => r.rater === b[i].rater && r.playerId === b[i].playerId && r.level === b[i].level);
