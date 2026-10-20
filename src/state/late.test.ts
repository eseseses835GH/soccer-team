import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../engine';
import { addGoal, endMatch, keeperIndex, setBorrow, startClock, startSession } from '../match/match';
import { teamMembers } from './history';
import { lateJoin, nowTarget, suggestAfterLate } from './late';
import type { LeaveCtx } from './leave';
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

const ids = 'a b c d e f g h i j k l m n o x y z w v'.split(' ');
const roster = ids.map((id, i) => p(id, 1 + (i % 9)));
const ctx: LeaveCtx = { players: roster, options: DEFAULT_OPTIONS, constraints: { together: [], apart: [] }, rotate: true, every: 1 };
const now = { kind: 'now' } as const;
const wait = { kind: 'wait' } as const;
const sizes = (r: GameResult) => Array.from({ length: r.numTeams }, (_, t) => teamMembers(r, t).length);

describe('late arrival: wait on the side', () => {
  it('keeps every team size (3×3 stays 3×3), even mid-match; he is a sub', () => {
    const r = result([['a', 'b', 'c'], ['d', 'e', 'f']], 4);
    const m = startClock(startSession(2), 0);
    for (const match of [null, m]) {
      const j = lateJoin(r, match, 'x', wait, ctx, 1);
      expect(j.outcome).toBe('bench');
      expect(sizes(j.result)).toEqual([3, 3]);
      expect(j.result.subIds).toEqual(['x']);
      expect(j.result.gkOrder).toEqual(r.gkOrder);
      expect(j.match).toBe(match);
    }
  });

  it('never forms a new team, however many wait', () => {
    let r = result([['a', 'b', 'c', 'd', 'e'], ['f', 'g', 'h', 'i', 'j']], 5);
    for (const id of ['x', 'y', 'z', 'w']) r = lateJoin(r, null, id, wait, ctx, 1).result;
    expect(r.numTeams).toBe(2);
    expect(r.subIds).toEqual(['x', 'y', 'z', 'w']);
  });
});

describe('late arrival: in now', () => {
  it('before kickoff: the short team outside; completing it is "filled"', () => {
    const r = result([['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h'], ['i', 'j']], 4);
    const one = lateJoin(r, null, 'x', now, ctx, 1);
    expect(one.outcome).toBe('joined');
    expect(one.team).toBe(2);
    const two = lateJoin(one.result, null, 'y', now, ctx, 1);
    expect(two.outcome).toBe('filled');
    expect(two.result.gkOrder[2]).toEqual(['i', 'j', 'x', 'y']);
  });

  it('a reduced split (3v3 at 4-a-side): he makes it 4v3, the later team first', () => {
    const r = result([['a', 'b', 'c'], ['d', 'e', 'f']], 4);
    expect(nowTarget(r)).toBe(1);
    const j = lateJoin(r, null, 'x', now, ctx, 1);
    expect(sizes(j.result)).toEqual([3, 4]);
    expect(lateJoin(j.result, null, 'y', now, ctx, 1).outcome).toBe('filled');
  });

  it('during a running match: joins the suggested team on the pitch; the keeper in goal stays', () => {
    const r = result([['a', 'b', 'c'], ['d', 'e', 'f']], 4);
    let m = startClock(startSession(2), 0);
    m = addGoal(m, 0, 1); // team 1 conceded once: its 2nd keeper is in goal
    const keeper = r.gkOrder[1][keeperIndex(1, 1, 3)];
    const j = lateJoin(r, m, 'x', now, ctx, 1);
    expect(j.team).toBe(1);
    expect(teamMembers(j.result, 1)).toContain('x');
    expect(j.result.gkOrder[1][keeperIndex(1, 1, 4)]).toBe(keeper);
    expect(j.match!.onPitch).toEqual([0, 1]);
    expect(j.match!.goals).toEqual(m.goals);
  });

  it('can go to another team with a tap, even a full one', () => {
    const r = result([['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h'], ['i', 'j']], 4);
    const j = lateJoin(r, null, 'x', { kind: 'now', team: 0 }, ctx, 1);
    expect(sizes(j.result)).toEqual([5, 4, 2]);
    expect(j.outcome).toBe('joined');
  });

  it('all teams full: a new team only when he and the subs reach the threshold', () => {
    let r = result([['a', 'b', 'c', 'd', 'e'], ['f', 'g', 'h', 'i', 'j']], 5);
    // Alone he isn't enough for a team (threshold 3): "in now" makes a team bigger.
    expect(nowTarget(r)).toBe(1);
    r = lateJoin(r, null, 'x', wait, ctx, 1).result;
    expect(nowTarget(r)).toBe(1);
    r = lateJoin(r, null, 'y', wait, ctx, 1).result;
    expect(nowTarget(r)).toBe(2);
    const j = lateJoin(r, null, 'z', now, ctx, 1);
    expect(j.outcome).toBe('newTeam');
    expect(j.result.numTeams).toBe(3);
    expect(j.result.subIds).toEqual([]);
    expect(teamMembers(j.result, 2).sort()).toEqual(['x', 'y', 'z']);
  });

  it('into a short team with a borrower: he takes the borrower’s place', () => {
    const r = result([['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h'], ['i', 'j', 'k']], 4);
    let m = startSession(3);
    m = endMatch(addGoal(m, 0, 1), 1, 2); // team 2 (index 1) loses; team 3 comes on short
    m = setBorrow(m, { team: 2, from: 1, ids: ['e'] });
    const j = lateJoin(r, m, 'x', now, ctx, 1);
    expect(j.team).toBe(2);
    expect(j.match!.borrow).toBeNull();
  });

  it('swap suggestions leave the two teams of a running match alone', () => {
    const r = result([['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h'], ['i', 'j', 'k']], 4);
    const m = startClock(startSession(3), 0);
    const j = lateJoin(r, m, 'x', now, ctx, 1);
    expect(j.outcome).toBe('filled');
    // Only one team is free: nothing to swap with.
    expect(suggestAfterLate(j, ctx)).toBeNull();
  });
});

describe('late arrival: reducer', () => {
  const base = (): AppState => {
    const r = result([['a', 'b', 'c'], ['d', 'e', 'f']], 4);
    return { ...INITIAL_STATE, players: roster, teamSize: 4, presentIds: [...r.playerIds], result: r };
  };

  it('both choices mark him present without flagging the teams as changed', () => {
    for (const choice of [now, wait]) {
      const s = reducer(base(), { type: 'lateJoin', id: 'x', choice, seed: 1, now: 5 });
      expect(s.presentIds).toContain('x');
      expect(isResultStale(s)).toBe(false);
    }
  });

  it('a new player is added to the roster', () => {
    const s = reducer(base(), { type: 'lateJoin', player: p('new'), id: 'new', choice: wait, seed: 1, now: 5 });
    expect(s.players.some((x) => x.id === 'new')).toBe(true);
    expect(s.result!.subIds).toEqual(['new']);
  });

  it('a new team joins the back of the queue of the evening', () => {
    const r = result([['a', 'b', 'c', 'd', 'e'], ['f', 'g', 'h', 'i', 'j']], 5, ['x', 'y']);
    let s: AppState = { ...INITIAL_STATE, players: roster, teamSize: 5, presentIds: [...r.playerIds, ...r.subIds], result: r };
    s = reducer(s, { type: 'setMatch', match: startClock(startSession(2), 0), now: 1 });
    s = reducer(s, { type: 'lateJoin', id: 'z', choice: now, seed: 1, now: 5 });
    expect(s.result!.numTeams).toBe(3);
    expect(s.match!.queue).toEqual([2]);
    expect(s.match!.onPitch).toEqual([0, 1]);
  });
});
