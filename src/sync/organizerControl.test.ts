import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addGoal, endMatch, startClock, startSession, type MatchState } from '../match/match';
import { eveningId } from '../state/history';
import type { KV } from '../state/groups';
import { DEFAULT_SETTINGS, INITIAL_STATE, defaultAttrs, type AppState, type GameResult, type Player } from '../state/model';
import { reducer } from '../state/reducer';
import { liveFromState, type LiveData, type LiveRow } from './live';
import { createOrganizerControl, MINE, takeBackState } from './organizerControl';
import { SyncError } from './supabase';

const T = 1_800_000_000_000;
const MIN = 60_000;
const ME = 'org-me';
const G = 'g1';
const p = (id: string): Player => ({ id, name: `P${id}`, attrs: defaultAttrs(6), canGK: true, cards: [] });
const players = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 's1'].map(p);

function result(): GameResult {
  const teams = [['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2']];
  const assignment = teams.flatMap((t, i) => t.map(() => i));
  return {
    playerIds: teams.flat(),
    subIds: ['s1'],
    teamSize: 2,
    numTeams: 3,
    sizes: [2, 2, 2],
    assignment,
    generated: assignment,
    pool: [],
    shown: [],
    gkOrder: teams,
    createdAt: T - 30 * MIN,
  };
}

const base = (match: MatchState | null): AppState => ({
  ...INITIAL_STATE,
  settings: DEFAULT_SETTINGS,
  players,
  presentIds: [...players.map((x) => x.id)],
  teamSize: 2,
  dayAt: T - 30 * MIN,
  result: result(),
  match,
});

/** Tonight as another phone would publish it: one finished match and a goal in the next. */
function playedElsewhere(): LiveData {
  let m = startClock(startSession(3), T - 20 * MIN);
  m = addGoal(m, 0, T - 18 * MIN, 'a1');
  m = endMatch(m, 1, T - 12 * MIN);
  m = addGoal(startClock(m, T - 10 * MIN), 2, T - 5 * MIN, 'c2');
  return liveFromState({ result: result(), match: m, players, settings: DEFAULT_SETTINGS, now: T - MIN })!;
}

function memKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => !!data.set(k, v), remove: (k) => void data.delete(k) };
}

/** The live row on a fake server, with the v12 rules (only the runner writes; rev checked when given). */
function server(init: { runner?: string | null; runnerName?: string; data?: LiveData | null } = {}) {
  const s = { runner: init.runner ?? null, runnerName: init.runnerName ?? '', data: init.data ?? null, rev: init.data ? 5 : 0 };
  const calls: { op: string; live?: LiveData | null; rev?: number }[] = [];
  const row = (): LiveRow | null =>
    s.data ? { data: s.data, updatedBy: s.runner, byName: s.runnerName, updatedAt: new Date(T - MIN).toISOString(), runner: s.runner, runnerName: s.runnerName, runnerSince: null, rev: s.rev } : null;
  const api = {
    get: async () => {
      calls.push({ op: 'get' });
      return row();
    },
    set: async (_g: string, live: LiveData | null, rev?: number) => {
      calls.push({ op: 'set', live, rev });
      if (s.runner && s.runner !== ME) throw new SyncError('runs elsewhere', 'conflict');
      if (rev !== undefined && rev !== s.rev) throw new SyncError('stale rev', 'conflict');
      s.data = live;
      s.runner = live ? ME : null;
      return ++s.rev;
    },
    takeControl: async () => {
      calls.push({ op: 'take' });
      if (!s.data) throw new SyncError('no evening', 'invalid');
      s.runner = ME;
      s.runnerName = 'אלי';
      s.rev++;
      return row();
    },
  };
  return { s, calls, api, row, sets: () => calls.filter((c) => c.op === 'set') };
}

function phone(srv: ReturnType<typeof server>, app: AppState) {
  const kv = memKV();
  let state = app;
  const changes = vi.fn();
  const ctl = createOrganizerControl({
    api: async () => srv.api,
    me: () => ME,
    latest: () => ({ gid: G, app: state }),
    setState: (_g, f) => void (state = f(state)),
    kv,
    onChange: changes,
    now: () => T,
    delay: 0,
    isOnline: () => true,
  });
  const settle = async () => {
    await vi.runAllTimersAsync();
    await ctl.flush();
    await vi.runAllTimersAsync();
  };
  return { ctl, kv, changes, settle, get state() {
    return state;
  }, set state(s: AppState) {
    state = s;
  } };
}

describe('organizer control (v12)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('publishes only as the runner: the first publish of an evening has no rev, the next carry it', async () => {
    const srv = server();
    const ph = phone(srv, base(startSession(3)));
    await ph.ctl.open(G);
    await ph.settle();
    expect(srv.sets()).toHaveLength(1);
    expect(srv.sets()[0].rev).toBeUndefined();
    expect(srv.s.runner).toBe(ME);
    ph.state = { ...ph.state, match: addGoal(ph.state.match!, 0, T) };
    ph.ctl.changed(G, ph.state);
    await ph.settle();
    expect(srv.sets()).toHaveLength(2);
    expect(srv.sets()[1].rev).toBe(1);
    expect(ph.ctl.viewer(G)).toBeNull();
  });

  it('a conflict (someone took control) makes this phone a viewer, and it stops sending', async () => {
    const srv = server();
    const ph = phone(srv, base(startSession(3)));
    await ph.ctl.open(G);
    await ph.settle();
    // A player takes control on his phone.
    srv.s.runner = 'player-1';
    srv.s.runnerName = 'דני';
    srv.s.rev++;
    ph.state = { ...ph.state, match: addGoal(ph.state.match!, 0, T) };
    ph.ctl.changed(G, ph.state);
    await ph.settle();
    expect(ph.ctl.viewer(G)?.runnerName).toBe('דני');
    expect(ph.changes).toHaveBeenCalled();
    const n = srv.sets().length;
    ph.ctl.changed(G, { ...ph.state, match: addGoal(ph.state.match!, 1, T) });
    await ph.settle();
    expect(srv.sets()).toHaveLength(n);
  });

  it('a realtime change to another runner also makes it a viewer', async () => {
    const srv = server();
    const ph = phone(srv, base(startSession(3)));
    await ph.ctl.open(G);
    await ph.settle();
    srv.s.runner = 'org-2';
    srv.s.runnerName = 'משה';
    ph.ctl.row(G, srv.row());
    expect(ph.ctl.viewer(G)?.runnerName).toBe('משה');
  });

  it('taking it back imports what was played meanwhile and publishes with the rev', async () => {
    const live = playedElsewhere();
    const srv = server({ runner: 'player-1', runnerName: 'דני', data: live });
    const local = base(startSession(3)); // this phone stopped at the first kick-off
    const ph = phone(srv, local);
    await ph.ctl.open(G);
    await ph.settle();
    expect(ph.ctl.viewer(G)).not.toBeNull();
    expect(srv.sets()).toHaveLength(0);

    expect(await ph.ctl.takeBack(G)).toBe('ok');
    expect(ph.ctl.viewer(G)).toBeNull();
    const m = ph.state.match!;
    expect(m.history).toHaveLength(1);
    expect(m.history[0].goalsA).toBe(1);
    expect(m.goals.map((g) => g.scorerId)).toEqual(['c2']);
    expect(ph.state.result!.pool).toBe(local.result!.pool);
    expect(new Set(ph.state.presentIds)).toEqual(new Set(['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 's1']));
    expect(eveningId(ph.state.result!)).toBe(eveningId(local.result!));
    await ph.settle();
    const last = srv.sets().at(-1)!;
    expect(last.rev).toBe(6); // the rev take_control returned
    expect(last.live?.match?.played).toHaveLength(1);
    expect(srv.s.runner).toBe(ME);
    expect(ph.kv.get(MINE(G))).toBe(true);
  });

  it('ending the evening while someone else runs it: take control, import, then end (null with the rev)', async () => {
    const srv = server({ runner: 'player-1', runnerName: 'דני', data: playedElsewhere() });
    const ph = phone(srv, base(null));
    await ph.ctl.open(G);
    expect(await ph.ctl.ensureRunner(G)).toBe('ok');
    expect(srv.calls.map((c) => c.op)).toContain('take');
    const id = eveningId(ph.state.result!);
    ph.state = reducer(ph.state, { type: 'endEvening', id, now: T });
    ph.ctl.changed(G, ph.state);
    await ph.settle();
    expect(ph.state.history.find((h) => h.id === id)?.matches).toHaveLength(2); // the finished one + the one with a goal
    const last = srv.sets().at(-1)!;
    expect(last.live).toBeNull();
    expect(typeof last.rev).toBe('number');
    expect(srv.s.data).toBeNull();
  });

  it('ensureRunner when this phone runs it takes nothing', async () => {
    const srv = server();
    const ph = phone(srv, base(startSession(3)));
    await ph.ctl.open(G);
    await ph.settle();
    expect(await ph.ctl.ensureRunner(G)).toBe('ok');
    expect(srv.calls.some((c) => c.op === 'take')).toBe(false);
  });

  it('a second organizer phone opens as a viewer, even with an old evening of its own', async () => {
    const srv = server({ runner: 'org-2', runnerName: 'משה', data: playedElsewhere() });
    for (const app of [base(null), { ...INITIAL_STATE, players }, base(endMatch(startSession(3), 0, T - 50 * MIN))]) {
      const ph = phone(srv, app);
      await ph.ctl.open(G);
      ph.ctl.changed(G, ph.state);
      await ph.settle();
      expect(ph.ctl.viewer(G)?.runnerName).toBe('משה');
    }
    expect(srv.sets()).toHaveLength(0);
  });

  it('taking back an evening that just ended: nothing to take, the local match goes', async () => {
    const srv = server({ runner: 'org-2', runnerName: 'משה', data: playedElsewhere() });
    const ph = phone(srv, base(startSession(3)));
    await ph.ctl.open(G);
    srv.s.data = null;
    srv.s.runner = null;
    expect(await ph.ctl.takeBack(G)).toBe('ended');
    expect(ph.state.match).toBeNull();
    expect(ph.ctl.viewer(G)).toBeNull();
    ph.ctl.changed(G, ph.state);
    await ph.settle();
    expect(srv.sets()).toHaveLength(0);
  });

  it('the watched evening ends elsewhere: the viewer stops and nothing is republished', async () => {
    const srv = server({ runner: 'org-2', runnerName: 'משה', data: playedElsewhere() });
    const ph = phone(srv, base(startSession(3)));
    await ph.ctl.open(G);
    ph.ctl.row(G, null);
    expect(ph.ctl.viewer(G)).toBeNull();
    expect(ph.state.match).toBeNull();
    await ph.ctl.open(G);
    await ph.settle();
    expect(srv.sets()).toHaveLength(0);
  });

  it('a stale rev (same login elsewhere) re-reads and retries with the new rev', async () => {
    const srv = server();
    const ph = phone(srv, base(startSession(3)));
    await ph.ctl.open(G);
    await ph.settle();
    srv.s.rev += 3; // our other write landed from elsewhere
    ph.state = { ...ph.state, match: addGoal(ph.state.match!, 0, T) };
    ph.ctl.changed(G, ph.state);
    await ph.settle();
    const sets = srv.sets();
    expect(sets.at(-1)!.rev).toBe(4);
    expect(srv.s.data?.match?.score).toEqual([1, 0]);
    expect(ph.ctl.viewer(G)).toBeNull();
  });

  it('takeBackState adds people the other phone added and keeps the split when the teams are the same', () => {
    const live = playedElsewhere();
    live.players.push({ id: 'new1', name: 'אורח' });
    live.subs.push('new1');
    const app = base(null);
    const next = takeBackState(app, live, T);
    expect(next.players.find((x) => x.id === 'new1')?.name).toBe('אורח');
    expect(next.presentIds).toContain('new1');
    expect(next.result!.subIds).toContain('new1');
    expect(next.dayAt).toBe(T);
  });
});
