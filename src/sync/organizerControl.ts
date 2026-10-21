// Who runs tonight, on an organizer's phone (DECISIONS → "Match runner handoff — organizer side (v12)").
// Only the runner's phone writes the live row. This phone publishes while it runs the evening (or
// nobody does: its first publish makes it the runner); when another phone runs it, this one is a
// viewer: it shows the row read-only and sends nothing until the organizer takes control back,
// which imports everything played meanwhile into this phone's evening. No React: unit-tested.
import { eveningId } from '../state/history';
import type { KV } from '../state/groups';
import { defaultMatchMs, sanitizePlayer, type AppState, type Player } from '../state/model';
import { importLive } from './control';
import { iAmRunner, liveFromState, type LiveData, type LiveRow } from './live';
import { eveningEnded } from './organizer';
import { liveNow } from './playerGroup';
import { createLivePublisher, type LivePublisher } from './publish';
import { SyncError } from './supabase';

/** This phone published a live evening that it hasn't ended yet (survives a crash / reload). */
export const MINE = (gid: string) => `kochot:liveMine:${gid}`;
/** eveningId of teams whose evening was ended without anything saved (see eveningEnded). */
export const ENDED = (gid: string) => `kochot:liveEnded:${gid}`;

export interface ControlApi {
  get(gid: string): Promise<LiveRow | null>;
  set(gid: string, live: LiveData | null, rev?: number): Promise<number>;
  takeControl(gid: string): Promise<LiveRow | null>;
}

export interface ControlDeps {
  api(): Promise<ControlApi>;
  me(): string | null;
  /** The open group and its state, now. */
  latest(): { gid: string; app: AppState };
  setState(gid: string, update: (s: AppState) => AppState): void;
  kv: KV;
  /** Viewer mode changed (re-render). */
  onChange(): void;
  now?(): number;
  delay?: number;
  retryMs?: number;
  isOnline?(): boolean;
}

/** 'ok', or why taking control didn't happen: the evening is over, or no connection. */
export type TakeResult = 'ok' | 'ended' | 'offline';

export interface OrganizerControl {
  /** The row another phone runs (this phone is read-only for it); null = this phone may run tonight. */
  viewer(gid: string): LiveRow | null;
  /** Tonight changed on this phone: publish it if this phone runs it. */
  changed(gid: string, app: AppState): void;
  /** App opened / back on screen: read the row and either run (republish) or view. */
  open(gid: string): Promise<void>;
  /** A realtime change of the row. */
  row(gid: string, row: LiveRow | null): void;
  /** "לקחת את הניהול בחזרה": take control, import what was played meanwhile, publish. */
  takeBack(gid: string): Promise<TakeResult>;
  /** Before "סיום הערב": take control first when another phone runs it. */
  ensureRunner(gid: string): Promise<TakeResult>;
  flush(): Promise<void>;
  publisher: LivePublisher;
  dispose(): void;
}

const endedId = (kv: KV, gid: string) => {
  const v = kv.get(ENDED(gid));
  return typeof v === 'string' ? v : null;
};

/** What this phone would publish for tonight (null = nothing live). */
export const liveOf = (kv: KV, gid: string, s: AppState, now = Date.now()): LiveData | null =>
  eveningEnded(s, endedId(kv, gid)) ? null : liveFromState({ result: s.result, match: s.match, players: s.players, settings: s.settings, now });

/**
 * This phone's state after taking control: the snapshot's evening (keeping the local split when the
 * teams are the same), today's attendance = everyone on a team or the bench, and anyone the other
 * phone added that this roster doesn't know yet (name only, default level).
 */
export function takeBackState(app: AppState, live: LiveData, now = Date.now()): AppState {
  const imp = importLive({ result: app.result }, live, defaultMatchMs(app.settings));
  const known = new Set(app.players.map((p) => p.id));
  const added = imp.players
    .filter((p) => !known.has(p.id))
    .map((p) => sanitizePlayer({ id: p.id, name: p.name }))
    .filter((p): p is Player => !!p);
  return {
    ...app,
    players: added.length ? [...app.players, ...added] : app.players,
    presentIds: [...imp.result.playerIds, ...imp.result.subIds],
    teamSize: imp.result.teamSize,
    result: imp.result,
    match: imp.match,
    dayAt: now,
  };
}

export function createOrganizerControl(d: ControlDeps): OrganizerControl {
  const now = d.now ?? Date.now;
  const me = () => d.me() ?? '';
  const revs = new Map<string, number>(); // gid → rev of the row as this phone last saw it while running
  const viewers = new Map<string, LiveRow>();
  const conflicts = new Map<string, number>(); // re-reads after a conflict since the last good send
  const isMine = (gid: string) => d.kv.get(MINE(gid)) === true;
  const current = (gid: string) => d.latest().gid === gid;
  const local = (gid: string) => liveOf(d.kv, gid, d.latest().app, now());

  const publisher = createLivePublisher({
    send: async (gid, live) => {
      const rev = await (await d.api()).set(gid, live, revs.get(gid));
      if (live) revs.set(gid, rev);
      else revs.delete(gid);
    },
    onSent: (gid, live) => {
      conflicts.delete(gid);
      if (live) d.kv.set(MINE(gid), true);
      else d.kv.remove(MINE(gid));
    },
    onConflict: (gid) => void reread(gid),
    now: d.now,
    delay: d.delay,
    retryMs: d.retryMs,
    isOnline: d.isOnline,
  });

  const setViewer = (gid: string, row: LiveRow | null) => {
    const was = viewers.get(gid) ?? null;
    if (row) viewers.set(gid, row);
    else viewers.delete(gid);
    if (was !== row) d.onChange();
  };

  /** Someone else ran tonight and ended it: this phone's copy of the evening is over too (the history comes with the group). */
  const endedElsewhere = (gid: string) => {
    revs.delete(gid);
    d.kv.remove(MINE(gid));
    if (current(gid)) {
      const r = d.latest().app.result;
      if (r) d.kv.set(ENDED(gid), eveningId(r));
      d.setState(gid, (s) => (s.match ? { ...s, match: null } : s));
    }
    publisher.baseline(gid, null);
    setViewer(gid, null);
  };

  /** Act on what the server has. `republish`: (re)send this phone's evening if it runs it. */
  const apply = (gid: string, row: LiveRow | null, republish: boolean) => {
    const open = liveNow(row, now());
    if (open && !iAmRunner(row, me())) return setViewer(gid, row); // another phone runs it (or ran it and let go)
    // Our login, but this phone has no evening: the same organizer on his other phone.
    if (open && current(gid) && !local(gid) && !isMine(gid)) return setViewer(gid, row);
    if (open) {
      revs.set(gid, Math.max(row!.rev, revs.get(gid) ?? 0));
      setViewer(gid, null);
    } else {
      const live = current(gid) ? local(gid) : null;
      // Nothing live any more although this phone still has the evening: someone else ended it.
      if (viewers.has(gid) || (!row && isMine(gid) && live)) return endedElsewhere(gid);
      revs.delete(gid); // free: the next publish makes this phone the runner
    }
    if (!republish || !current(gid)) return;
    const live = local(gid);
    if (live) publisher.republish(gid, live);
    else if (isMine(gid)) publisher.republish(gid, null);
  };

  /** A write was refused (someone else runs it, or our rev is old): look again. */
  const reread = async (gid: string) => {
    const n = conflicts.get(gid) ?? 0;
    if (n >= 2) return; // the server keeps saying no: stop until something changes
    conflicts.set(gid, n + 1);
    try {
      apply(gid, await (await d.api()).get(gid), true);
    } catch {
      /* offline: the next open / change tries again */
    }
  };

  const takeBack = async (gid: string): Promise<TakeResult> => {
    let row: LiveRow | null;
    try {
      row = await (await d.api()).takeControl(gid);
    } catch (e) {
      if (e instanceof SyncError && e.code === 'invalid') row = null; // no open evening to take
      else return 'offline';
    }
    if (!row) {
      endedElsewhere(gid);
      return 'ended';
    }
    revs.set(gid, row.rev);
    conflicts.delete(gid);
    d.kv.remove(ENDED(gid));
    if (current(gid)) {
      d.setState(gid, (s) => takeBackState(s, row.data, now()));
      d.kv.set(MINE(gid), true);
      publisher.republish(gid, local(gid));
    }
    setViewer(gid, null);
    return 'ok';
  };

  return {
    viewer: (gid) => viewers.get(gid) ?? null,
    changed(gid, app) {
      if (viewers.has(gid)) return; // read-only until control is taken back
      const live = liveOf(d.kv, gid, app, now());
      if (live || isMine(gid)) publisher.update(gid, live);
    },
    async open(gid) {
      if (!current(gid)) return;
      const live = local(gid);
      publisher.baseline(gid, live);
      let row: LiveRow | null;
      try {
        row = await (await d.api()).get(gid);
      } catch {
        // Offline: queue our own evening (sent on 'online'); the server refuses it if someone else runs it.
        if (!viewers.has(gid) && (live || isMine(gid))) publisher.republish(gid, live);
        return;
      }
      apply(gid, row, true);
    },
    row: (gid, row) => apply(gid, row, false),
    takeBack,
    async ensureRunner(gid) {
      if (viewers.has(gid)) return takeBack(gid);
      let row: LiveRow | null;
      try {
        row = await (await d.api()).get(gid);
      } catch {
        return 'ok'; // offline: end it here; the end is sent later (refused if someone took over)
      }
      if (liveNow(row, now()) && !iAmRunner(row, me())) return takeBack(gid);
      if (row && iAmRunner(row, me())) revs.set(gid, Math.max(row.rev, revs.get(gid) ?? 0));
      return 'ok';
    },
    flush: () => publisher.flush(),
    publisher,
    dispose: () => publisher.dispose(),
  };
}
