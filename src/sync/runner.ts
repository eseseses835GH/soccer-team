// A player running the match from his phone (DECISIONS → "Match runner handoff — player side (v12)").
// The evening is rebuilt from the live snapshot into a local AppState that only this phone has
// (kept in `kochot:runner:<gid>`, never in the group's state), the match screen runs on it, and every
// change goes out through the publish queue with the row's rev. Losing control (someone took it,
// the evening ended) drops it. No React here, so it is unit-tested.
import { startSession } from '../match/match';
import type { KV } from '../state/groups';
import { addEvening, buildEvening, eveningId, type EveningRecord } from '../state/history';
import { defaultMatchMs, sanitizePlayer, teamBibs, type AppState, type Player } from '../state/model';
import { reducer, type Action } from '../state/reducer';
import { liveToState, settingsFromLive } from './control';
import { iAmRunner, liveFromState, someoneElseRuns, type LiveData, type LiveRow } from './live';
import { liveNow } from './playerGroup';
import { createLivePublisher, type LivePublisher } from './publish';
import { SyncError } from './supabase';

export const runnerKey = (gid: string) => `kochot:runner:${gid}`;

/** What this phone keeps while it runs the evening. */
interface Stored {
  user: string;
  /** null = an evening this phone started (v20) that hasn't reached the server yet. */
  rev: number | null;
  app: Pick<AppState, 'players' | 'settings' | 'result' | 'match'>;
}

export interface RunnerApi {
  get(gid: string): Promise<LiveRow | null>;
  /** rev undefined = the first write of an evening this phone started (v20). */
  set(gid: string, live: LiveData, rev?: number): Promise<number>;
  /** v20: end the evening as its runner; the record goes into the group's history. */
  end(gid: string, record: EveningRecord | null, rev: number): Promise<number>;
  takeControl(gid: string): Promise<LiveRow | null>;
  releaseControl(gid: string): Promise<number | null>;
}

export interface RunnerOptions {
  gid: string;
  me: string;
  kv: KV;
  api: RunnerApi;
  /** The player group's own state (roster names, history, his look and sounds). */
  base(): AppState;
  /** The local evening changed (null = this phone doesn't run it). */
  onChange(app: AppState | null): void;
  /** Someone else's phone runs it now (his display name). */
  onLost(name: string): void;
  isOnline?(): boolean;
  now?(): number;
  delay?: number;
}

export interface Runner {
  state(): AppState | null;
  dispatch(action: Action): void;
  /** Take control. Resolves to an error code, or null when this phone runs it now. */
  take(): Promise<SyncError['code'] | null>;
  /** Stop running it (sends what waits first). Resolves to an error code, or null. */
  release(): Promise<SyncError['code'] | null>;
  /** v20: run a new evening from teams made on this phone (it goes live with the first write). */
  startNew(app: AppState): void;
  /**
   * v20: end the evening (sends what waits first). The record (null = no match played) is merged
   * with the same evening in the group's history and saved on the server.
   */
  end(): Promise<{ error: SyncError['code'] | null; record: EveningRecord | null }>;
  /** A live row seen (fetch or realtime; null = nothing live or not loaded yet). */
  seen(row: LiveRow | null): void;
  /** Back online: send what waits. */
  flush(): Promise<void>;
  rev(): number | null;
  dispose(): void;
}

const code = (e: unknown): SyncError['code'] => (e instanceof SyncError ? e.code : 'other');

/** The evening of a snapshot as a local AppState on top of the player group's state. */
export function runnerApp(base: AppState, live: LiveData): AppState {
  const imp = liveToState(live, defaultMatchMs(base.settings));
  const tonight = new Map(imp.players.map((p) => [p.id, p.name]));
  const known = new Set(base.players.map((p) => p.id));
  const players: Player[] = [
    ...base.players.map((p) => (tonight.has(p.id) ? { ...p, name: tonight.get(p.id)! } : p)),
    ...imp.players.filter((p) => !known.has(p.id)).map((p) => sanitizePlayer({ id: p.id, name: p.name })).filter((p): p is Player => !!p),
  ];
  return {
    ...base,
    players,
    settings: settingsFromLive(base.settings, live),
    presentIds: [...imp.result.playerIds, ...imp.result.subIds],
    result: imp.result,
    // Teams made, no match yet: the runner starts it (like the organizer's "start").
    match: imp.match ?? startSession(imp.result.numTeams),
  };
}

export function loadRunner(kv: KV, gid: string, me: string): Stored | null {
  const s = kv.get(runnerKey(gid)) as Stored | null;
  if (!s || typeof s !== 'object' || s.user !== me || (typeof s.rev !== 'number' && s.rev !== null) || !s.app?.result || !s.app.match || !s.app.settings) return null;
  return s;
}

export function createRunner(o: RunnerOptions): Runner {
  const now = o.now ?? Date.now;
  let app: AppState | null = null;
  let rev: number | null = 0;
  /** Rows up to this rev are from before this phone stopped running it: never resume from them. */
  let ignoreUpTo = -1;
  let pub: LivePublisher | null = null;
  let disposed = false;

  const snapshot = () => (app ? liveFromState({ result: app.result, match: app.match, players: app.players, settings: app.settings, now: now() }) : null);
  const persist = () => {
    if (!app) return o.kv.remove(runnerKey(o.gid));
    const s: Stored = { user: o.me, rev, app: { players: app.players, settings: app.settings, result: app.result, match: app.match } };
    o.kv.set(runnerKey(o.gid), s);
  };
  const emit = () => !disposed && o.onChange(app);

  const newPublisher = () =>
    createLivePublisher({
      delay: o.delay,
      isOnline: o.isOnline,
      now,
      async send(gid, live) {
        if (!live) return; // a player never ends the evening
        const r = await o.api.set(gid, live, rev ?? undefined);
        if (app) {
          rev = r;
          persist();
        }
      },
      onConflict: () => void recheck(),
    });

  function start(next: AppState, r: number | null, serverHas: LiveData | null) {
    pub?.dispose();
    app = next;
    rev = r;
    pub = newPublisher();
    if (serverHas) pub.baseline(o.gid, serverHas);
    persist();
    emit();
    publish();
  }

  function stop(name: string | null) {
    ignoreUpTo = Math.max(ignoreUpTo, rev ?? -1);
    pub?.dispose();
    pub = null;
    app = null;
    persist();
    emit();
    if (name !== null) o.onLost(name);
  }

  function publish() {
    const live = snapshot();
    if (live && pub) pub.update(o.gid, live);
  }

  /** After a conflict (or nothing live seen): who runs it now? */
  async function recheck() {
    let row: LiveRow | null;
    try {
      row = await o.api.get(o.gid);
    } catch {
      return; // offline: keep running, the queue retries
    }
    if (!app || disposed) return;
    if (!row) return stop(null); // the evening ended
    if (someoneElseRuns(row, o.me)) return stop(row.runnerName);
    if (!row.runner) return stop(null);
    // Still mine, the rev moved on: send again on top of it.
    rev = row.rev;
    persist();
    const live = snapshot();
    if (live && pub) pub.republish(o.gid, live);
  }

  // After a reload: carry on from what this phone had, and send it (the server may be behind).
  const stored = loadRunner(o.kv, o.gid, o.me);
  if (stored) {
    app = { ...o.base(), ...stored.app };
    rev = stored.rev;
    pub = newPublisher();
    publish();
  }

  return {
    state: () => app,
    rev: () => rev,
    dispatch(action) {
      if (!app) return;
      const next = reducer(app, action);
      if (next === app) return;
      app = next;
      persist();
      emit();
      publish();
    },
    async take() {
      try {
        const row = await o.api.takeControl(o.gid);
        if (disposed) return null;
        if (!row) return 'invalid';
        start(runnerApp(o.base(), row.data), row.rev, row.data);
        return null;
      } catch (e) {
        return code(e);
      }
    },
    async release() {
      if (!app) return null;
      try {
        await pub?.flush();
        const r = await o.api.releaseControl(o.gid);
        ignoreUpTo = Math.max(ignoreUpTo, r ?? rev ?? -1);
        stop(null);
        return null;
      } catch (e) {
        return code(e);
      }
    },
    startNew(next) {
      start({ ...next, match: next.match ?? (next.result ? startSession(next.result.numTeams) : null) }, null, null);
    },
    async end() {
      if (!app?.result || !app.match) return { error: null, record: null };
      try {
        await pub?.flush();
        if (rev === null) return { error: 'offline', record: null }; // it never went live yet
        const t = now();
        const built = buildEvening({ match: app.match, result: app.result, players: app.players, bibs: teamBibs(app.settings, app.result.numTeams), now: t });
        // The same evening may already be in the history (ended once, then played on): send it merged.
        const record = built ? (addEvening(o.base().history, built).find((h) => h.id === eveningId(app!.result!)) ?? built) : null;
        const r = await o.api.end(o.gid, record, rev);
        ignoreUpTo = Math.max(ignoreUpTo, r);
        stop(null);
        return { error: null, record };
      } catch (e) {
        const c = code(e);
        if (c === 'invalid') stop(null); // ended meanwhile
        else if (c === 'conflict') void recheck();
        return { error: c, record: null };
      }
    },
    seen(row) {
      if (disposed) return;
      if (!app) {
        // Opened as the runner (another tab, or local data gone): resume from the live data.
        if (row && iAmRunner(row, o.me) && row.rev > ignoreUpTo && liveNow(row, now())) start(runnerApp(o.base(), row.data), row.rev, row.data);
        return;
      }
      if (rev === null) return; // a new evening not written yet: what's on the server is from before
      if (!row) return void recheck(); // not loaded yet, or ended: ask
      if (row.rev < rev) return; // older than what this phone wrote
      if (someoneElseRuns(row, o.me)) return stop(row.runnerName);
      if (!row.runner) return stop(null);
      if (row.rev > rev) {
        rev = row.rev;
        persist();
      }
    },
    flush: () => pub?.flush() ?? Promise.resolve(),
    dispose() {
      disposed = true;
      pub?.dispose();
    },
  };
}
