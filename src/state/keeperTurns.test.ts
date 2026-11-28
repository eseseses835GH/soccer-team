import { describe, expect, it } from 'vitest';
import { addGoal, endMatch, startClock, startSession, type MatchState } from '../match/match';
import { INITIAL_STATE, defaultAttrs, type AppState, type GameResult, type Player } from './model';
import { reducer } from './reducer';
import { fairKeeperOrders, keeperTurns } from './keeperTurns';

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const g = (team: number) => ({ team });

describe('keeperTurns', () => {
  const orders = [
    ['a', 'b', 'c'],
    ['d', 'e', 'f'],
  ];

  it('counts the keeper who starts each match once per stint', () => {
    const t = keeperTurns([{ orders, matches: [{ a: 0, b: 1, goals: [] }, { a: 0, b: 1, goals: [] }] }], 1);
    expect(Object.fromEntries(t)).toEqual({ a: 1, d: 1 });
  });

  it('a keeper who comes in after a goal counts when the match goes on, else when his team plays again', () => {
    // 1 concedes twice: d, then e (a goal follows), then f only after the last goal.
    const t = keeperTurns([{ orders, matches: [{ a: 0, b: 1, goals: [g(0), g(0)] }] }], 1);
    expect(Object.fromEntries(t)).toEqual({ a: 1, d: 1, e: 1 });
    const t2 = keeperTurns([{ orders, matches: [{ a: 0, b: 1, goals: [g(0), g(0)] }, { a: 0, b: 1, goals: [] }] }], 1);
    expect(Object.fromEntries(t2)).toEqual({ a: 1, d: 1, e: 1, f: 1 });
  });

  it('every N goals, the shift and "לא בשער" follow the match screen', () => {
    const t = keeperTurns([{ orders, matches: [{ a: 0, b: 1, goals: [g(0), g(0), g(1)] }], shifts: [1, 0] }], 2, new Set(['e']));
    // team 0 starts with b (shift 1); team 1 rotates d, f (e skipped): 2 conceded → f, then a goal follows.
    expect(Object.fromEntries(t)).toEqual({ b: 1, d: 1, f: 1 });
  });

  it('adds up over the parts of the night', () => {
    const m = [{ a: 0, b: 1, goals: [] }];
    const t = keeperTurns([{ orders, matches: m }, { orders: [['a', 'e'], ['d', 'b']], matches: m }], 1);
    expect(Object.fromEntries(t)).toEqual({ a: 2, d: 2 });
  });
});

describe('fairKeeperOrders', () => {
  it('no turns yet first, then fewest; equals keep their order; "לא בשער" last', () => {
    const turns = new Map([
      ['a', 2],
      ['b', 1],
      ['x', 0],
    ]);
    expect(fairKeeperOrders([['a', 'n', 'b', 'c', 'x', 'd']], turns, new Set(['n']))).toEqual([['c', 'x', 'd', 'b', 'a', 'n']]);
  });

  it('a team of only "לא בשער" still rotates fairly', () => {
    expect(fairKeeperOrders([['a', 'b']], new Map([['a', 1]]), new Set(['a', 'b']))).toEqual([['b', 'a']]);
  });
});

describe('shuffle: keepers who already kept goal go after the rest', () => {
  const p = (id: string, extra: Partial<Player> = {}): Player => ({ id, name: id, attrs: defaultAttrs(5), canGK: false, cards: [], ...extra });
  const TEAMS = [
    ['a', 'b'],
    ['c', 'd'],
    ['e', 'f'],
  ];
  function result(teams: string[][]): GameResult {
    const assignment = teams.flatMap((t, i) => t.map(() => i));
    return { playerIds: teams.flat(), subIds: [], teamSize: 2, numTeams: teams.length, sizes: teams.map((t) => t.length), assignment, generated: assignment, pool: [], shown: [], gkOrder: teams.map((t) => [...t]), createdAt: T0 };
  }
  const play = (m: MatchState, win: number, at: number): MatchState => {
    const [a, b] = m.onPitch;
    return endMatch(addGoal(startClock(m, at), win, at + MIN), win === a ? b : a, at + 2 * MIN);
  };
  const shuffleTo = (teams: string[][], now: number) => ({
    type: 'shuffle' as const,
    playerIds: teams.flat(),
    subIds: [],
    sizes: teams.map((t) => t.length),
    teamSize: 3,
    assignment: teams.flatMap((t, i) => t.map(() => i)),
    gkOrder: teams,
    pool: [],
    now,
  });

  it('reorders the new teams by tonight\'s turns, over two shuffles', () => {
    const players = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => p(id, id === 'f' ? { noGK: true } : {}));
    let s: AppState = { ...INITIAL_STATE, players, presentIds: players.map((x) => x.id), dayAt: T0, result: result(TEAMS), match: startSession(3) };
    // 0 beats 1 (a and c in goal), 0 beats 2 (a, e).
    s = { ...s, match: play(play(s.match!, 0, T0), 0, T0 + 10 * MIN) };
    s = reducer(s, shuffleTo([['a', 'f', 'b'], ['e', 'c', 'd']], T0 + 30 * MIN));
    expect(s.result!.gkOrder).toEqual([['b', 'a', 'f'], ['d', 'e', 'c']]);
    // Second part: 1 beats 0 2–0: b, then a (a goal follows), then b again (last goal: not counted); d.
    let m = startClock(s.match!, T0 + 40 * MIN);
    m = addGoal(addGoal(m, 1, T0 + 41 * MIN), 1, T0 + 42 * MIN);
    s = { ...s, match: endMatch(m, 0, T0 + 45 * MIN) };
    s = reducer(s, shuffleTo([['a', 'b', 'c'], ['f', 'd', 'e']], T0 + 60 * MIN));
    // a 2, b 1, c 1 → b, c (given order), a; d 1, e 1, f "לא בשער" last.
    expect(s.result!.gkOrder).toEqual([['b', 'c', 'a'], ['d', 'e', 'f']]);
  });

  it('fixed keepers: the order is left alone', () => {
    let s: AppState = { ...INITIAL_STATE, settings: { ...INITIAL_STATE.settings, gkMode: 'fixed' }, players: TEAMS.flat().map((id) => p(id)), presentIds: TEAMS.flat(), dayAt: T0, result: result(TEAMS), match: startSession(3) };
    s = { ...s, match: play(s.match!, 0, T0) };
    s = reducer(s, shuffleTo([['a', 'b', 'c'], ['d', 'e', 'f']], T0 + 30 * MIN));
    expect(s.result!.gkOrder).toEqual([['a', 'b', 'c'], ['d', 'e', 'f']]);
  });
});
