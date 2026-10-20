import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../engine';
import { addGoal, endMatch, keeperIndex, setBorrow, startClock, startSession, type MatchState } from '../match/match';
import { teamMembers } from './history';
import { keepKeeper, leaveEarly, suggestAfterLeave, type LeaveCtx } from './leave';
import { INITIAL_STATE, defaultAttrs, type AppState, type GameResult, type Player } from './model';
import { reducer } from './reducer';
import { isResultStale } from './store';

const p = (id: string, level = 5): Player => ({ id, name: id, attrs: defaultAttrs(level), canGK: false, cards: [] });

function result(teams: string[][], teamSize: number, subs: string[] = []): GameResult {
  const playerIds = teams.flat();
  const assignment = teams.flatMap((t, i) => t.map(() => i));
  return {
    playerIds,
    subIds: subs,
    teamSize,
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

const levels: Record<string, number> = { a1: 9, a2: 5, a3: 5, b1: 6, b2: 6, b3: 6, c1: 5, c2: 5, s1: 2, s2: 6, s3: 9 };
const roster = Object.keys(levels).map((id) => p(id, levels[id]));
const ctx: LeaveCtx = { players: roster, options: DEFAULT_OPTIONS, constraints: { together: [], apart: [] }, rotate: true, every: 1 };

const members = (r: GameResult, t: number) => teamMembers(r, t);

describe('left early: removal', () => {
  it('takes him off his team, the keeper rotation and the result; nobody else moves', () => {
    const r = result([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3']], 3);
    const l = leaveEarly(r, null, 'a2', ctx)!;
    expect(l.outcome).toBe('short');
    expect(l.team).toBe(0);
    expect(l.result.playerIds).toEqual(['a1', 'a3', 'b1', 'b2', 'b3']);
    expect(l.result.assignment).toEqual([0, 0, 1, 1, 1]);
    expect(l.result.generated).toEqual([0, 0, 1, 1, 1]);
    expect(l.result.gkOrder).toEqual([['a1', 'a3'], ['b1', 'b2', 'b3']]);
    expect(members(l.result, 1)).toEqual(['b1', 'b2', 'b3']);
  });

  it('a sub who leaves just leaves the bench', () => {
    const r = result([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3']], 3, ['s1', 's2']);
    const l = leaveEarly(r, null, 's1', ctx)!;
    expect(l.outcome).toBe('sub');
    expect(l.result.subIds).toEqual(['s2']);
    expect(l.result.playerIds).toEqual(r.playerIds);
  });

  it('returns null for someone who is not in tonight’s teams', () => {
    expect(leaveEarly(result([['a1', 'a2'], ['b1', 'b2']], 2), null, 'zz', ctx)).toBeNull();
  });

  it('keeps whoever is in goal in goal; if the keeper left, the next one takes over', () => {
    // conceded 1, every 1 → index 1 of [a1,a2,a3] = a2 is in goal.
    expect(keepKeeper(['a1', 'a2', 'a3'], ['a1', 'a2'], 1, 1, true)[keeperIndex(1, 1, 2)]).toBe('a2');
    expect(keepKeeper(['a1', 'a2', 'a3'], ['a1', 'a3'], 1, 1, true)[keeperIndex(1, 1, 2)]).toBe('a3');
    // conceded 5 → index 2 = a3; a1 leaves → a3 still in goal, order stays cyclic.
    const o = keepKeeper(['a1', 'a2', 'a3'], ['a2', 'a3'], 5, 1, true);
    expect(o[keeperIndex(5, 1, 2)]).toBe('a3');
    // Fixed keepers: the first stays first.
    expect(keepKeeper(['a1', 'a2', 'a3'], ['a1', 'a3'], 4, 1, false)).toEqual(['a1', 'a3']);
  });

  it('during a match the team in goal keeps its keeper after the change', () => {
    const r = result([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3']], 3);
    let m = startClock(startSession(2), 0);
    m = addGoal(m, 1, 1); // team 0 conceded 1 → a2 in goal
    const l = leaveEarly(r, m, 'a3', ctx)!;
    const order = l.result.gkOrder[0];
    expect(order[keeperIndex(l.match!.conceded[0], 1, order.length)]).toBe('a2');
  });

  it('a borrowed player who leaves is dropped from the borrow (the step asks again when nobody is left)', () => {
    const r = result([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3'], ['c1', 'c2']], 3);
    let m = startSession(3);
    m = endMatch(addGoal(m, 0, 1), 1, 2); // b loses, c comes on and borrows from b
    m = setBorrow(m, { team: 2, from: 1, ids: ['b2'] });
    const l = leaveEarly(r, m, 'b2', ctx)!;
    expect(l.match!.borrow).toBeNull();
    m = setBorrow(m, { team: 2, from: 1, ids: ['b2', 'b3'] });
    expect(leaveEarly(r, m, 'b2', ctx)!.match!.borrow).toEqual({ team: 2, from: 1, ids: ['b3'] });
  });

  it('matches already played keep him in their sides', () => {
    const r = result([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3']], 3);
    const m0: MatchState = endMatch(addGoal(startSession(2), 0, 1), 1, 2);
    // A record without sides (older version) is stamped with the rosters before he leaves.
    const l = leaveEarly(r, m0, 'a2', ctx)!;
    expect(l.match!.history[0].sides).toEqual([
      ['a1', 'a2', 'a3'],
      ['b1', 'b2', 'b3'],
    ]);
    const stamped = { ...m0, history: [{ ...m0.history[0], sides: [['a1', 'a2', 'x'], ['b1']] as [string[], string[]] }] };
    expect(leaveEarly(r, stamped, 'a2', ctx)!.match!.history[0].sides).toEqual([['a1', 'a2', 'x'], ['b1']]);
  });
});

describe('left early: short teams and the minimum', () => {
  it('the short team outside, too small for the format, waits as subs (5-a-side: 3 → 2)', () => {
    const r = result([['a1', 'a2', 'a3', 'b1', 'b2'], ['b3', 'c1', 'c2', 's1', 's2'], ['s3', 'x1', 'x2']], 5);
    const players = [...roster, p('x1'), p('x2')];
    const m = startSession(3);
    const l = leaveEarly(r, m, 'x1', { ...ctx, players })!;
    expect(l.outcome).toBe('toBench');
    expect(l.result.numTeams).toBe(2);
    expect(l.result.subIds).toEqual(['s3', 'x2']);
    expect(l.result.playerIds).toHaveLength(10);
    expect(l.result.gkOrder).toHaveLength(2);
    expect(l.match!.queue).toEqual([]);
    expect(l.match!.streak).toHaveLength(2);
  });

  it('a short team that already played stays (and keeps borrowing)', () => {
    const r = result([['a1', 'a2', 'a3', 'b1', 'b2'], ['b3', 'c1', 'c2', 's1', 's2'], ['s3', 'x1', 'x2']], 5);
    const players = [...roster, p('x1'), p('x2')];
    const m = endMatch(addGoal(startSession(3), 0, 1), 1, 2); // the short team comes on
    const l = leaveEarly(r, m, 'x1', { ...ctx, players })!;
    expect(l.outcome).toBe('short');
    expect(l.result.numTeams).toBe(3);
  });

  it("can't take a team below 2 players: blocked, unless a sub can come in", () => {
    const r = result([['a1', 'a2'], ['b1', 'b2']], 2);
    const blocked = leaveEarly(r, null, 'a1', ctx)!;
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.result).toBe(r);
    const withSub = leaveEarly(result([['a1', 'a2'], ['b1', 'b2']], 2, ['s1', 's2']), null, 'a1', ctx)!;
    expect(withSub.outcome).toBe('subIn');
    expect(members(withSub.result, 0)).toHaveLength(2);
    expect(withSub.result.subIds).toHaveLength(1);
  });
});

describe('left early: the small fix', () => {
  it('suggests the sub who fits his team best', () => {
    const r = result([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3']], 3, ['s1', 's2', 's3']);
    // a1 (9) leaves: team 0 is 5,5 vs 6,6,6 → the 9 (s3) is the best fit.
    const l = leaveEarly(r, null, 'a1', ctx)!;
    const s = suggestAfterLeave(l, ctx)!;
    expect(s.kind).toBe('sub');
    if (s.kind !== 'sub') return;
    expect(s.subId).toBe('s3');
    expect(s.team).toBe(0);
    expect(s.after).toBeLessThan(s.before);
  });

  it('without subs, suggests a swap or two with the score before and after', () => {
    // a1 (9) leaves: 6,5 vs 5,6,9 → swapping a 5 for a 6 evens it out.
    const r = result([['a1', 'b1', 'c1'], ['a2', 'b2', 's3']], 3);
    const l = leaveEarly(r, null, 'a1', ctx)!;
    const s = suggestAfterLeave(l, ctx);
    expect(s?.kind).toBe('swaps');
    if (s?.kind !== 'swaps') return;
    expect(s.swaps.swaps.length).toBeGreaterThanOrEqual(1);
    expect(s.swaps.swaps.length).toBeLessThanOrEqual(2);
    expect(s.swaps.after).toBeLessThan(s.swaps.before);
  });

  it('never swaps the two teams in the middle of a match', () => {
    const r = result([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3'], ['c1', 'c2', 's3']], 3);
    const m = startClock(startSession(3), 0);
    // He leaves the team on the pitch mid-match: they play one short, no swap.
    expect(suggestAfterLeave(leaveEarly(r, m, 'a1', ctx)!, ctx)).toBeNull();
    // He leaves the team outside: a swap may involve only teams that aren't playing (just one here).
    expect(suggestAfterLeave(leaveEarly(r, m, 'c1', ctx)!, ctx)).toBeNull();
    const four = result([['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2'], ['s1', 's3', 's2']], 3);
    const s = suggestAfterLeave(leaveEarly(four, m, 's2', ctx)!, ctx);
    if (s?.kind === 'swaps') for (const [i, j] of s.swaps.swaps) for (const x of [i, j]) expect(s.swaps.assignment[x]).toBeGreaterThanOrEqual(2);
  });

  it('a sub is still offered to a team in the middle of a match', () => {
    const r = result([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3']], 3, ['s1']);
    const m = startClock(startSession(2), 0);
    const s = suggestAfterLeave(leaveEarly(r, m, 'a1', ctx)!, ctx);
    expect(s).toMatchObject({ kind: 'sub', subId: 's1', team: 0 });
  });
});

describe('left early: reducer', () => {
  const base = (): AppState => {
    const r = result([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3']], 3, ['s1']);
    return { ...INITIAL_STATE, players: roster, teamSize: 3, presentIds: [...r.playerIds, ...r.subIds], result: r };
  };

  it('removes him from attendance too, so the teams are not "changed since the split"', () => {
    const s0 = base();
    expect(isResultStale(s0)).toBe(false);
    const s1 = reducer(s0, { type: 'leave', id: 'a2', now: 5 });
    expect(s1.presentIds).not.toContain('a2');
    expect(s1.result!.playerIds).not.toContain('a2');
    expect(isResultStale(s1)).toBe(false);
    // Then the suggested sub comes in.
    const s2 = reducer(s1, { type: 'subIn', subId: 's1', team: 0 });
    expect(members(s2.result!, 0)).toEqual(['a1', 'a3', 's1']);
    expect(s2.result!.subIds).toEqual([]);
    expect(isResultStale(s2)).toBe(false);
  });

  it('keeps the evening going: history untouched, the match keeps running', () => {
    let s = base();
    s = reducer(s, { type: 'setMatch', match: startSession(2), now: 1 });
    s = reducer(s, { type: 'setMatch', match: endMatch(addGoal(s.match!, 0, 2, 'a2'), 1, 3), now: 3 });
    const sides = s.match!.history[0].sides;
    expect(sides![0]).toContain('a2');
    const after = reducer(s, { type: 'leave', id: 'a2', now: 4 });
    expect(after.match!.history).toEqual(s.match!.history);
    expect(after.history).toEqual(s.history);
    expect(after.match!.onPitch).toEqual(s.match!.onPitch);
  });

  it('a blocked leave changes nothing', () => {
    const r = result([['a1', 'a2'], ['b1', 'b2']], 2);
    const s0: AppState = { ...INITIAL_STATE, players: roster, teamSize: 2, presentIds: r.playerIds, result: r };
    expect(reducer(s0, { type: 'leave', id: 'a1', now: 1 })).toBe(s0);
  });
});
