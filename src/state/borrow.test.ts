import { describe, expect, it } from 'vitest';
import { addGoal, addTeam, borrowNeed, endMatch, keeperAt, setBorrow, shiftOf, startSession, type MatchState } from '../match/match';
import { buildEvening, rosterChanged, sanitizeHistory, teamMembers } from './history';
import { moveBorrowers } from './borrow';
import { INITIAL_STATE, defaultAttrs, type AppState, type GameResult, type Player } from './model';
import { reducer } from './reducer';

const p = (id: string): Player => ({ id, name: id, attrs: defaultAttrs(5), canGK: false, cards: [] });

function result(teams: string[][], teamSize: number): GameResult {
  const playerIds = teams.flat();
  const assignment = teams.flatMap((t, i) => t.map(() => i));
  return {
    playerIds,
    subIds: [],
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

const A = ['a1', 'a2', 'a3', 'a4', 'a5'];
const B = ['b1', 'b2', 'b3', 'b4', 'b5'];
const C = ['c1', 'c2', 'c3'];
const sizesOf = (r: GameResult) => Array.from({ length: r.numTeams }, (_, t) => r.assignment.filter((x) => x === t).length);

function state(r: GameResult, m: MatchState): AppState {
  return { ...INITIAL_STATE, players: r.playerIds.map(p), presentIds: [...r.playerIds], result: r, match: m };
}

/** 5·5·3: team 1 loses the first match, the short team 2 comes on against team 0. */
function afterFirstMatch(): AppState {
  const r = result([A, B, C], 5);
  let m = addGoal(startSession(3), 0, 10);
  m = endMatch(m, 1, 20);
  return state(r, m);
}

describe('borrowing for good ("עוברים אליהם")', () => {
  it('moves the borrowers into the short team, last in its keeper rotation; the lender becomes short', () => {
    const s0 = afterFirstMatch();
    expect(borrowNeed(s0.match!, sizesOf(s0.result!), 5)).toEqual({ team: 2, from: 1, opponent: 0, need: 2 });
    const s = reducer(s0, { type: 'borrowMove', team: 2, from: 1, ids: ['b4', 'b2'] });
    const r = s.result!;
    expect(sizesOf(r)).toEqual([5, 3, 5]);
    expect(teamMembers(r, 2)).toEqual(['c1', 'c2', 'c3', 'b4', 'b2']);
    expect(teamMembers(r, 1)).toEqual(['b1', 'b3', 'b5']);
    expect(r.generated).toEqual(r.assignment); // "ביטול החלפות" doesn't undo the move
    // Nobody is borrowed for the match any more and the card is gone.
    expect(s.match!.borrow).toBeNull();
    expect(borrowNeed(s.match!, sizesOf(r), 5)).toBeNull();
    // The match already played keeps who played.
    expect(s.match!.history[0].sides).toEqual([A, B]);
  });

  it('whoever is in goal stays in goal', () => {
    const s0 = afterFirstMatch();
    // Team 2 has conceded 4 goals in an earlier session-ish state: its keeper is c2 (4 % 3 = 1).
    const m0 = { ...s0.match!, conceded: [0, 1, 4] };
    const s1 = { ...s0, match: m0, settings: { ...s0.settings, gkMode: 'rotate' as const, gkSwitchGoals: 1 } };
    const before = keeperAt(teamMembers(s1.result!, 2), 4, 1, true, undefined, shiftOf(m0, 2)).now;
    const s = reducer(s1, { type: 'borrowMove', team: 2, from: 1, ids: ['b1', 'b2'] });
    const after = keeperAt(teamMembers(s.result!, 2), 4, 1, true, undefined, shiftOf(s.match!, 2)).now;
    expect(before).toBe('c2');
    expect(after).toBe('c2');
  });

  it('the next match is stamped with the new teams; the lender borrows when its turn comes', () => {
    let s = reducer(afterFirstMatch(), { type: 'borrowMove', team: 2, from: 1, ids: ['b1', 'b2'] });
    // Team 0 loses; the lender (team 1, now 3) comes on against team 2.
    s = reducer(s, { type: 'setMatch', match: endMatch(addGoal(s.match!, 2, 30), 0, 40), now: 40 });
    expect(s.match!.history[1].sides).toEqual([A, ['c1', 'c2', 'c3', 'b1', 'b2']]);
    expect(s.match!.history[1].borrow).toBeUndefined();
    expect(s.match!.onPitch).toEqual([1, 2]);
    expect(borrowNeed(s.match!, sizesOf(s.result!), 5)).toEqual({ team: 1, from: 0, opponent: 2, need: 2 });
    // The evening reads as "teams changed" (like a swap), and that survives a save/load.
    const rec = buildEvening({ match: s.match!, result: s.result!, players: s.players, bibs: ['n1', 'n2', 'n3'], now: 50 })!;
    expect(rec.moved?.sort()).toEqual(['b1', 'b2']);
    expect(rosterChanged(rec)).toBe(true);
    expect(rosterChanged(sanitizeHistory([JSON.parse(JSON.stringify(rec))])[0])).toBe(true);
  });

  it('only this match: the teams stay, the borrow is in that match only', () => {
    const s0 = afterFirstMatch();
    let s = reducer(s0, { type: 'setMatch', match: setBorrow(s0.match!, { team: 2, from: 1, ids: ['b1', 'b2'] }), now: 25 });
    expect(s.result).toBe(s0.result);
    s = reducer(s, { type: 'setMatch', match: endMatch(addGoal(s.match!, 2, 30), 0, 40), now: 40 });
    expect(s.match!.history[1].borrow).toEqual({ team: 2, from: 1, ids: ['b1', 'b2'] });
    expect(s.match!.history[1].sides).toEqual([A, [...C, 'b1', 'b2']]);
    const rec = buildEvening({ match: s.match!, result: s.result!, players: s.players, bibs: ['n1', 'n2', 'n3'], now: 50 })!;
    expect(rec.moved).toBeUndefined();
    expect(rosterChanged(rec)).toBe(false);
  });

  it('ignores players who are not in the lending team', () => {
    const s0 = afterFirstMatch();
    expect(moveBorrowers(s0.result!, s0.match, { team: 2, from: 1, ids: ['a1'] }).result).toBe(s0.result);
    expect(reducer(s0, { type: 'borrowMove', team: 2, from: 1, ids: [] })).toBe(s0);
  });
});

describe('the borrow card shows for a short team that comes on', () => {
  it('a team made between matches (2 teams playing) borrows when it enters', () => {
    // 5 v 5, no queue: the first match ends with nobody leaving.
    let m = endMatch(addGoal(startSession(2), 0, 10), 1, 20);
    expect(m.history[0].out).toBeNull();
    // Three newcomers form team 2 between matches; it waits for the next match.
    m = addTeam(m, 2);
    const sizes = [5, 5, 3];
    expect(borrowNeed(m, sizes, 5)).toBeNull();
    m = endMatch(addGoal(m, 1, 30), 0, 40);
    expect(borrowNeed(m, sizes, 5)).toEqual({ team: 2, from: 0, opponent: 1, need: 2 });
  });

  it('a short team on the pitch with nobody just out borrows from the back of the queue', () => {
    // No match finished yet (or the queue formed after the last one): the short team still gets the card.
    const m: MatchState = { ...startSession(3), onPitch: [0, 2], queue: [1] };
    expect(borrowNeed(m, [5, 5, 3], 5)).toEqual({ team: 2, from: 1, opponent: 0, need: 2 });
    const after: MatchState = { ...endMatch(addGoal(startSession(2), 0, 10), 1, 20), onPitch: [0, 2], queue: [1], streak: [1, 0, 0], pitchSince: [0, 0, 1], conceded: [0, 1, 0] };
    expect(borrowNeed(after, [5, 5, 3], 5)).toEqual({ team: 2, from: 1, opponent: 0, need: 2 });
  });
});
