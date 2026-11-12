import { describe, expect, it, vi } from 'vitest';
import { addGoal, endMatch, score, startClock, startSession } from '../match/match';
import { DEFAULT_SETTINGS, defaultAttrs, INITIAL_STATE, type AppState, type GameResult } from '../state/model';
import type { KV } from '../state/groups';
import { liveFromState, type LiveData, type LiveRow } from './live';
import { eveningId, type EveningRecord } from '../state/history';
import { createRunner, loadRunner, runnerApp, runnerKey, type RunnerApi } from './runner';
import { SyncError } from './supabase';

const GID = 'g1';
const ME = 'me-uuid';
const OTHER = 'other-uuid';
const T0 = Date.now();
const names = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3'];
const players = names.map((id) => ({ id, name: `P${id}` }));

function result(): GameResult {
  const teams = [names.slice(0, 3), names.slice(3, 6), names.slice(6)];
  const assignment = teams.flatMap((t, i) => t.map(() => i));
  return { playerIds: teams.flat(), subIds: [], teamSize: 3, numTeams: 3, sizes: [3, 3, 3], assignment, generated: assignment, pool: [], shown: [], gkOrder: teams, createdAt: T0 - 60_000 };
}
const settings = { ...DEFAULT_SETTINGS, hasBibs: true, matchMinutes: 7 };
const live = (match = startClock(startSession(3), T0)): LiveData => JSON.parse(JSON.stringify(liveFromState({ result: result(), match, players, settings, now: T0 })));
const row = (p: Partial<LiveRow> = {}): LiveRow => ({ data: live(), updatedBy: OTHER, byName: 'דני', updatedAt: new Date().toISOString(), runner: OTHER, runnerName: 'דני', runnerSince: null, rev: 5, ...p });

/** The player group's own state: roster names only, his own look and sounds. */
const base: AppState = { ...INITIAL_STATE, players: players.map((p) => ({ ...p, attrs: defaultAttrs(5), canGK: false, cards: [] })), settings: { ...DEFAULT_SETTINGS, goalSound: 'off', theme: 'dark' } };

function memKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: (k) => (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null), set: (k, v) => (data.set(k, v), true), remove: (k) => void data.delete(k) };
}

function setup(o: { kv?: ReturnType<typeof memKV>; online?: () => boolean; ended?: boolean; base?: AppState } = {}) {
  const kv = o.kv ?? memKV();
  let server = row();
  /** v20: an evening is open on the server (a player may only start one when none is). */
  let open = !o.ended;
  if (o.ended) server = { ...server, runner: null, runnerName: '' };
  const ended: (EveningRecord | null)[] = [];
  const api = {
    get: vi.fn(async () => (open ? server : null)),
    set: vi.fn(async (_g: string, data: LiveData, rev?: number) => {
      if (rev === undefined && !open) {
        open = true;
        server = { ...server, data, runner: ME, runnerName: 'אני', rev: server.rev + 1 };
        return server.rev;
      }
      if (server.runner !== ME || rev !== server.rev) throw new SyncError('x', 'conflict');
      server = { ...server, data, rev: server.rev + 1 };
      return server.rev;
    }),
    end: vi.fn(async (_g: string, record: EveningRecord | null, rev: number) => {
      if (!open) throw new SyncError('x', 'invalid');
      if (server.runner !== ME || rev !== server.rev) throw new SyncError('x', 'conflict');
      ended.push(record);
      open = false;
      server = { ...server, runner: null, runnerName: '', rev: server.rev + 1 };
      return server.rev;
    }),
    takeControl: vi.fn(async () => (server = { ...server, runner: ME, runnerName: 'אני', rev: server.rev + 1 })),
    releaseControl: vi.fn(async () => {
      server = { ...server, runner: null, runnerName: '', rev: server.rev + 1 };
      return server.rev;
    }),
  } satisfies RunnerApi;
  const changes: (AppState | null)[] = [];
  const lost: string[] = [];
  const r = createRunner({ gid: GID, me: ME, kv, api, base: () => o.base ?? base, onChange: (a) => changes.push(a), onLost: (n) => lost.push(n), delay: 0, isOnline: o.online });
  return {
    r,
    api,
    kv,
    changes,
    lost,
    ended,
    server: () => server,
    setServer: (s: Partial<LiveRow>) => (server = { ...server, ...s }),
  };
}
const tick = () => new Promise((res) => setTimeout(res, 5));

describe('runnerApp', () => {
  it('the snapshot on top of his own state: rules and bibs from the runner, his sounds and look', () => {
    const app = runnerApp(base, live());
    expect(app.result?.numTeams).toBe(3);
    expect(app.match?.clock.running).toBe(true);
    expect(app.settings).toMatchObject({ matchMinutes: 7, hasBibs: true, goalSound: 'off', theme: 'dark' });
    expect(app.history).toBe(base.history);
  });
  it('teams but no match yet: the match starts on his phone', () => {
    const data = { ...live(), match: null };
    expect(runnerApp(base, data).match).toEqual(startSession(3));
  });
});

describe('runner', () => {
  it('take control → controls; the snapshot is kept apart from the group', async () => {
    const t = setup();
    expect(t.r.state()).toBeNull();
    expect(await t.r.take()).toBeNull();
    expect(t.r.state()?.match).toBeTruthy();
    expect(t.r.rev()).toBe(6);
    expect(t.changes.at(-1)).toBe(t.r.state());
    expect([...t.kv.data.keys()]).toEqual([runnerKey(GID)]);
    expect(loadRunner(t.kv, GID, ME)?.rev).toBe(6);
    await tick();
    expect(t.api.set).not.toHaveBeenCalled(); // nothing changed since the take
  });

  it('every change is published with the rev, and the new rev is kept', async () => {
    const t = setup();
    await t.r.take();
    const m = t.r.state()!.match!;
    t.r.dispatch({ type: 'setMatch', match: addGoal(m, 0, T0 + 1000), now: T0 });
    await t.r.flush();
    expect(t.api.set).toHaveBeenLastCalledWith(GID, expect.objectContaining({ v: 1 }), 6);
    expect(t.server().data.match?.score).toEqual([1, 0]);
    expect(t.r.rev()).toBe(7);
    t.r.dispatch({ type: 'setMatch', match: addGoal(t.r.state()!.match!, 1, T0 + 2000), now: T0 });
    await t.r.flush();
    expect(t.api.set).toHaveBeenLastCalledWith(GID, expect.anything(), 7);
    expect(loadRunner(t.kv, GID, ME)?.rev).toBe(8);
  });

  it('conflict and someone else runs it → read-only, toast with his name', async () => {
    const t = setup();
    await t.r.take();
    t.setServer({ runner: OTHER, runnerName: 'דני', rev: 9 });
    t.r.dispatch({ type: 'setMatch', match: addGoal(t.r.state()!.match!, 0, T0), now: T0 });
    await t.r.flush();
    await tick();
    expect(t.api.get).toHaveBeenCalled();
    expect(t.r.state()).toBeNull();
    expect(t.lost).toEqual(['דני']);
    expect(t.kv.data.size).toBe(0);
  });

  it('conflict while still the runner (stale rev) → resent on the new rev', async () => {
    const t = setup();
    await t.r.take();
    t.setServer({ rev: 20 });
    t.r.dispatch({ type: 'setMatch', match: addGoal(t.r.state()!.match!, 0, T0), now: T0 });
    await t.r.flush();
    await tick();
    await t.r.flush();
    expect(t.api.set).toHaveBeenLastCalledWith(GID, expect.anything(), 20);
    expect(t.r.rev()).toBe(21);
    expect(t.r.state()).not.toBeNull();
  });

  it('realtime: someone else took it → read-only; an older row is ignored', async () => {
    const t = setup();
    await t.r.take();
    t.r.seen(row({ rev: 5 })); // the row from before the take
    expect(t.r.state()).not.toBeNull();
    t.r.seen(row({ rev: 7, runner: OTHER, runnerName: 'יוסי' }));
    expect(t.r.state()).toBeNull();
    expect(t.lost).toEqual(['יוסי']);
  });

  it('nothing live seen → asks the server; ended → read-only without a toast', async () => {
    const t = setup();
    await t.r.take();
    t.api.get.mockResolvedValueOnce(null as never);
    t.r.seen(null);
    await tick();
    expect(t.r.state()).toBeNull();
    expect(t.lost).toEqual([]);
  });

  it('reload: carries on from this phone and sends with the stored rev', async () => {
    const first = setup();
    await first.r.take();
    first.r.dispatch({ type: 'setMatch', match: addGoal(first.r.state()!.match!, 0, T0), now: T0 });
    first.r.dispose(); // closed before the send
    const t = setup({ kv: first.kv });
    t.setServer({ runner: ME, rev: 6 });
    expect(score(t.r.state()!.match!)).toEqual([1, 0]);
    await t.r.flush();
    expect(t.api.set).toHaveBeenCalledWith(GID, expect.anything(), 6);
  });

  it('opened as the runner with nothing on this phone → resumes from the live data', () => {
    const t = setup();
    t.r.seen(row({ runner: ME, rev: 12 }));
    expect(t.r.state()?.match).toBeTruthy();
    expect(t.r.rev()).toBe(12);
    // Someone else's row: stays a viewer.
    const v = setup();
    v.r.seen(row());
    expect(v.r.state()).toBeNull();
  });

  it('another login\'s stored run is ignored', () => {
    const kv = memKV();
    kv.set(runnerKey(GID), { user: 'someone', rev: 3, app: { ...runnerApp(base, live()) } });
    expect(setup({ kv }).r.state()).toBeNull();
  });

  it('release: sends what waits, then lets go; the old row does not bring it back', async () => {
    const t = setup();
    await t.r.take();
    t.r.dispatch({ type: 'setMatch', match: addGoal(t.r.state()!.match!, 0, T0), now: T0 });
    expect(await t.r.release()).toBeNull();
    expect(t.api.set).toHaveBeenCalledTimes(1);
    expect(t.api.releaseControl).toHaveBeenCalled();
    expect(t.r.state()).toBeNull();
    expect(t.kv.data.size).toBe(0);
    t.r.seen(row({ runner: ME, rev: 7 })); // realtime echo of the last write
    expect(t.r.state()).toBeNull();
    expect(t.lost).toEqual([]);
  });

  it('offline: keeps running, only the latest snapshot goes out when back', async () => {
    let online = false;
    const t = setup({ online: () => online });
    await t.r.take();
    t.r.dispatch({ type: 'setMatch', match: addGoal(t.r.state()!.match!, 0, T0), now: T0 });
    t.r.dispatch({ type: 'setMatch', match: addGoal(t.r.state()!.match!, 0, T0 + 1), now: T0 });
    await tick();
    expect(t.api.set).not.toHaveBeenCalled();
    online = true;
    await t.r.flush();
    expect(t.api.set).toHaveBeenCalledTimes(1);
    expect(t.server().data.match?.score).toEqual([2, 0]);
  });

  it('release offline → stays the runner', async () => {
    const t = setup();
    await t.r.take();
    t.api.releaseControl.mockRejectedValueOnce(new SyncError('x', 'offline'));
    expect(await t.r.release()).toBe('offline');
    expect(t.r.state()).not.toBeNull();
  });
});

describe('a player starts and ends an evening (v20)', () => {
  const fresh = (): AppState => ({ ...base, settings: { ...base.settings, ...settings, goalSound: 'off', theme: 'dark' }, presentIds: names, result: result(), match: null });

  it('teams made on his phone go live with the first write (no rev), then on with the rev', async () => {
    const t = setup({ ended: true });
    t.r.seen(t.server()); // the old row (nobody runs it) must not stop the new evening
    t.r.startNew(fresh());
    expect(t.r.state()?.match).toEqual(startSession(3));
    t.r.seen(null);
    await tick();
    expect(t.r.state()).not.toBeNull();
    expect(t.api.set.mock.calls[0][2]).toBeUndefined();
    expect(t.server().runner).toBe(ME);
    const first = t.server().rev;
    expect(t.r.rev()).toBe(first);
    t.r.dispatch({ type: 'setMatch', match: addGoal(startClock(startSession(3), T0), 0, T0 + 1000), now: T0 });
    await tick();
    expect(t.api.set.mock.calls[1][2]).toBe(first);
  });

  it('an evening already open: his first write is refused and he goes back to watching', async () => {
    const t = setup();
    t.r.startNew(fresh());
    await tick();
    await tick();
    expect(t.r.state()).toBeNull();
    expect(t.lost).toEqual(['דני']);
  });

  it('ending saves the evening merged with the same one in the history, and stops', async () => {
    const t = setup({ ended: true });
    t.r.startNew(fresh());
    await tick();
    let m = startClock(startSession(3), T0);
    m = addGoal(m, 0, T0 + 1000);
    t.r.dispatch({ type: 'setMatch', match: endMatch(m, 1, T0 + 60_000), now: T0 });
    await tick();
    const res = await t.r.end();
    expect(res.error).toBeNull();
    expect(t.ended).toHaveLength(1);
    expect(t.ended[0]?.id).toBe(eveningId(result()));
    expect(t.ended[0]?.matches.length).toBeGreaterThan(0);
    expect(JSON.stringify(t.ended[0])).not.toMatch(/attrs|overall|levelVotes/);
    expect(t.r.state()).toBeNull();
    expect(t.kv.get(runnerKey(GID))).toBeNull();
  });

  it('a stored new evening that never reached the server resumes and is sent without a rev', async () => {
    const kv = memKV();
    kv.set(runnerKey(GID), { user: ME, rev: null, app: { players: base.players, settings, result: result(), match: startSession(3) } });
    expect(loadRunner(kv, GID, ME)?.rev).toBeNull();
    const t = setup({ kv, ended: true });
    await tick();
    expect(t.api.set).toHaveBeenCalledTimes(1);
    expect(t.api.set.mock.calls[0][2]).toBeUndefined();
    expect(t.server().runner).toBe(ME);
  });
});

