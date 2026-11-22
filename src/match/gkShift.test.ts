import { describe, expect, it } from 'vitest';
import { teamMembers } from '../state/history';
import { DEFAULT_SETTINGS, INITIAL_STATE, defaultAttrs, type AppState, type GameResult, type Player, type Settings } from '../state/model';
import { reducer } from '../state/reducer';
import { liveToState } from '../sync/control';
import { liveFromState, sanitizeLive } from '../sync/live';
import { addGoal, addTeam, endMatch, keeperAt, nextKeeper, pickKeeper, sanitizeMatch, shiftOf, startClock, startSession, type MatchState } from './match';

const p = (id: string, extra: Partial<Player> = {}): Player => ({ id, name: id, attrs: defaultAttrs(5), canGK: false, cards: [], ...extra });

function result(teams: string[][], subs: string[] = []): GameResult {
  const playerIds = teams.flat();
  const assignment = teams.flatMap((t, i) => t.map(() => i));
  return {
    playerIds,
    subIds: subs,
    teamSize: 3,
    numTeams: teams.length,
    sizes: teams.map((t) => t.length),
    assignment,
    generated: assignment,
    pool: [],
    shown: [],
    gkOrder: teams.map((t) => [...t]),
    createdAt: 1,
  };
}

const settings: Settings = { ...DEFAULT_SETTINGS, gkMode: 'rotate', gkSwitchGoals: 1 };
const ids = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3', 's1', 'x'];
const players = ids.map((id) => p(id));

function state(r: GameResult, m: MatchState, s: Settings = settings): AppState {
  return { ...INITIAL_STATE, players, settings: s, presentIds: [...r.playerIds, ...r.subIds], result: r, match: m };
}
const keeper = (s: AppState, t: number) =>
  keeperAt(teamMembers(s.result!, t), s.match!.conceded[t] ?? 0, s.settings.gkSwitchGoals, s.settings.gkMode === 'rotate', undefined, shiftOf(s.match, t)).now;

describe('keeper shift', () => {
  it('keeperAt: the shift moves the keeper on from where the goals put him, wrapping round', () => {
    const o = ['a', 'b', 'c'];
    expect(keeperAt(o, 0, 1, true, undefined, 1)).toEqual({ now: 'b', next: 'c' });
    expect(keeperAt(o, 2, 1, true, undefined, 2)).toEqual({ now: 'b', next: 'c' });
    expect(keeperAt(o, 5, 2, true, undefined, -1).now).toBe('b');
    // Fixed mode: goals don't move him, the shift picks who stays.
    expect(keeperAt(o, 7, 1, false, undefined, 2)).toEqual({ now: 'c', next: null });
    // "לא בשער" are skipped by the shift too.
    expect(keeperAt(o, 0, 1, true, new Set(['b']), 1).now).toBe('c');
  });

  it('"שוער הבא" at the end of a match: the next one in goal for the teams that played; the order stays', () => {
    const r = result([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3'], ['c1', 'c2', 'c3']]);
    let m = addGoal(startClock(startSession(3), 0), 0, 1); // team 1 conceded 1 → b2
    m = endMatch(m, 1, 2);
    const order = (t: number) => teamMembers(r, t);
    const next = nextKeeper(m, [0, 1], order);
    expect(shiftOf(next, 0)).toBe(1);
    expect(shiftOf(next, 1)).toBe(1);
    expect(shiftOf(next, 2)).toBe(0);
    expect(keeperAt(order(1), next.conceded[1], 1, true, undefined, shiftOf(next, 1)).now).toBe('b3');
    expect(keeperAt(order(0), 0, 1, true, undefined, shiftOf(next, 0)).now).toBe('a2');
    // Goals keep rotating from there.
    const later = addGoal(next, 2, 3); // team 0 (on the pitch with 2) concedes
    expect(keeperAt(order(0), later.conceded[0], 1, true, undefined, shiftOf(later, 0)).now).toBe('a3');
    // A team of one keeper (or nobody) stays as it is.
    expect(nextKeeper(m, [0], () => ['a1'])).toBe(m);
  });

  it('picking who is in goal sets the shift; picking him again changes nothing', () => {
    const o = ['a', 'b', 'c'];
    const m = { ...startSession(2), conceded: [4, 0] }; // 4 % 3 → b
    const picked = pickKeeper(m, 0, o, 'a', 1, true);
    expect(keeperAt(o, 4, 1, true, undefined, shiftOf(picked, 0)).now).toBe('a');
    expect(pickKeeper(picked, 0, o, 'a', 1, true)).toBe(picked);
    expect(pickKeeper(m, 0, o, 'zz', 1, true)).toBe(m);
    const fixed = pickKeeper(m, 1, o, 'c', 1, false);
    expect(keeperAt(o, 0, 1, false, undefined, shiftOf(fixed, 1)).now).toBe('c');
  });

  it('sanitize: old states have none; a saved one survives; junk becomes 0; a new team gets 0', () => {
    const m = startSession(3);
    expect(sanitizeMatch(m, 3)!.gkShift).toBeUndefined();
    expect(sanitizeMatch({ ...m, gkShift: [1, 'x', -3] }, 3)!.gkShift).toEqual([1, 0, 0]);
    expect(addTeam({ ...m, gkShift: [1, 2, 0] }, 3).gkShift).toEqual([1, 2, 0, 0]);
  });
});

describe('roster changes keep the keeper in goal', () => {
  const r = result([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3']], ['s1']);
  const m0 = addGoal(addGoal(startClock(startSession(2), 0), 1, 1), 1, 2); // team 0 conceded 2 → a3

  it('a late arrival into the team in goal: last in the order, same keeper', () => {
    const s = reducer(state({ ...r, subIds: [] }, m0), { type: 'lateJoin', player: undefined, id: 'x', choice: { kind: 'now', team: 0 }, seed: 1, now: 3 });
    expect(s.result!.gkOrder[0]).toEqual(['a1', 'a2', 'a3', 'x']);
    expect(keeper(s, 0)).toBe('a3');
  });

  it('a sub coming in, someone leaving, the keeper leaving', () => {
    let s = reducer(state(r, m0), { type: 'addFromBench', subId: 's1', team: 0 });
    expect(keeper(s, 0)).toBe('a3');
    s = reducer(s, { type: 'leave', id: 'a1', now: 4 });
    expect(keeper(s, 0)).toBe('a3');
    s = reducer(s, { type: 'leave', id: 'a3', now: 5 });
    expect(keeper(s, 0)).toBe('s1');
  });

  it('a shift picked by hand survives a roster change', () => {
    const picked = pickKeeper(m0, 0, teamMembers(r, 0), 'a1', 1, true);
    const s = reducer(state(r, picked), { type: 'addFromBench', subId: 's1', team: 0 });
    expect(keeper(s, 0)).toBe('a1');
  });

  it('a swap between teams and reordering the keepers: whoever is in goal stays', () => {
    let s = state(r, m0);
    // a1 ↔ b1: team 0's keeper stays; team 1's keeper (b1) left, so the next one goes in.
    s = reducer(s, { type: 'swap', i: 0, j: 3 });
    expect(keeper(s, 0)).toBe('a3');
    expect(keeper(s, 1)).toBe('b2');
    s = reducer(s, { type: 'swapKeepers', team: 0, a: 'a3', b: 'a2' });
    expect(s.result!.gkOrder[0]).toEqual(['b1', 'a3', 'a2']);
    expect(keeper(s, 0)).toBe('a3');
  });

  it('fixed keepers: the one who stays keeps staying', () => {
    const fixed = { ...settings, gkMode: 'fixed' as const };
    let s = state(r, pickKeeper(m0, 0, teamMembers(r, 0), 'a2', 1, false), fixed);
    expect(keeper(s, 0)).toBe('a2');
    s = reducer(s, { type: 'leave', id: 'a1', now: 4 });
    expect(keeper(s, 0)).toBe('a2');
  });
});

describe('live', () => {
  it('the snapshot carries the shift: watchers and a player who takes over see the same keeper', () => {
    const r = result([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3']]);
    const m = pickKeeper(addGoal(startSession(2), 1, 1), 0, teamMembers(r, 0), 'a3', 1, true);
    const live = sanitizeLive(JSON.parse(JSON.stringify(liveFromState({ result: r, match: m, players, settings, now: 10 }))))!;
    expect(live.match!.gkShift).toEqual([1, 0]); // conceded 1 → a2, a3 picked
    expect(live.teams[0].keeper).toBe('a3');
    const back = liveToState(live);
    expect(shiftOf(back.match, 0)).toBe(1);
    expect(keeper(state(back.result, back.match!), 0)).toBe('a3');
    // No shift: the field stays off the wire (old phones never see it).
    expect('gkShift' in liveFromState({ result: r, match: addGoal(startSession(2), 1, 1), players, settings, now: 10 })!.match!).toBe(false);
    // Junk from the wire is 0.
    const raw = JSON.parse(JSON.stringify(liveFromState({ result: r, match: m, players, settings, now: 10 })));
    raw.match.gkShift = ['x', 99999];
    expect(sanitizeLive(raw)!.match!.gkShift).toEqual([0, 0]);
  });
});

describe('"לא בשער" mid-evening', () => {
  const r = result([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3']]);
  const mark = (s: AppState, id: string, on: boolean): AppState =>
    reducer(s, { type: 'updatePlayer', player: on ? { ...s.players.find((x) => x.id === id)!, noGK: true } : (({ noGK: _n, ...rest }) => rest)(s.players.find((x) => x.id === id)!) });
  const gk = (s: AppState, t: number) =>
    keeperAt(teamMembers(s.result!, t), s.match!.conceded[t] ?? 0, s.settings.gkSwitchGoals, s.settings.gkMode === 'rotate', new Set(s.players.filter((x) => x.noGK).map((x) => x.id)), shiftOf(s.match, t)).now;

  it('marking someone else, or unmarking, keeps who is in goal now', () => {
    let s = state(r, addGoal(startClock(startSession(2), 0), 0, 1)); // team 1 conceded 1 → b2 in goal
    s = { ...s, match: addGoal(s.match!, 1, 2) }; // team 0 conceded 1 → a2
    expect([gk(s, 0), gk(s, 1)]).toEqual(['a2', 'b2']);
    s = mark(s, 'a1', true);
    expect([gk(s, 0), gk(s, 1)]).toEqual(['a2', 'b2']);
    s = mark(s, 'b1', true);
    expect(gk(s, 1)).toBe('b2');
    s = mark(s, 'a1', false);
    s = mark(s, 'b1', false);
    expect([gk(s, 0), gk(s, 1)]).toEqual(['a2', 'b2']);
    // The rotation goes on from him: next goal → the one after him.
    s = { ...s, match: addGoal(s.match!, 0, 3) };
    expect(gk(s, 1)).toBe('b3');
  });

  it('marking the keeper himself sends the next one in; the live snapshot follows', () => {
    let s = state(r, addGoal(startClock(startSession(2), 0), 0, 1)); // b2 in goal
    s = mark(s, 'b2', true);
    expect(gk(s, 1)).toBe('b3');
    const live = sanitizeLive(JSON.parse(JSON.stringify(liveFromState({ result: s.result!, match: s.match, players: s.players, settings: s.settings, now: 5 }))));
    expect(live?.teams[1].keeper).toBe('b3');
  });

  it('no match session: nothing to hold', () => {
    const s = { ...state(r, startSession(2)), match: null };
    expect(mark(s, 'a1', true).match).toBeNull();
  });
});
