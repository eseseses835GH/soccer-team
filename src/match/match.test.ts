import { describe, expect, it } from 'vitest';
import {
  addGoal,
  addTeam,
  adjustMatchLength,
  borrowNeed,
  borrowedInto,
  cleanPens,
  defaultOutOnDraw,
  dismissDominance,
  dominantTeam,
  elapsedMs,
  endMatch,
  endOnPenalties,
  keeperIndex,
  loserOf,
  matchWinner,
  matchLength,
  pauseClock,
  remainingMs,
  setBorrow,
  setMatchLength,
  sanitizeMatch,
  standings,
  startClock,
  startSession,
  topScorers,
  undoGoal,
  type MatchState,
} from './match';

const win = (m: MatchState, team: number, goals = 1) => {
  for (let i = 0; i < goals; i++) m = addGoal(m, team, 0);
  return endMatch(m, loserOf(m)!, 0);
};

describe('match night', () => {
  it('three teams: winner stays, loser to the back of the queue', () => {
    let m = startSession(3);
    expect(m.onPitch).toEqual([0, 1]);
    expect(m.queue).toEqual([2]);
    m = win(m, 0);
    expect(m.onPitch).toEqual([0, 2]);
    expect(m.queue).toEqual([1]);
    m = win(m, 2);
    expect(m.onPitch).toEqual([1, 2]);
    expect(m.queue).toEqual([0]);
  });

  it('two teams: nobody leaves', () => {
    let m = startSession(2);
    m = win(m, 1);
    expect(m.onPitch).toEqual([0, 1]);
    expect(m.history[0].out).toBeNull();
    expect(standings(m, 2)[1].won).toBe(1);
  });

  it('draws: the team on the pitch longer leaves by default; first match asks', () => {
    let m = startSession(3);
    expect(defaultOutOnDraw(m)).toBeNull();
    m = win(m, 0); // 0 since match 0, 2 since match 1
    expect(defaultOutOnDraw(m)).toBe(0);
  });

  it('goals, undo, scorers and conceded counts', () => {
    let m = startSession(2);
    m = addGoal(m, 0, 1, 'a');
    m = addGoal(m, 1, 2, 'b');
    m = addGoal(m, 1, 3, 'b');
    expect(m.conceded).toEqual([2, 1]);
    m = undoGoal(m);
    expect(m.conceded).toEqual([1, 1]);
    expect(topScorers(m)).toEqual([
      ['a', 1],
      ['b', 1],
    ]);
    expect(addGoal(startSession(3), 2, 0)).toEqual(startSession(3)); // team not on the pitch
  });

  it('clock survives pauses and uses timestamps', () => {
    let m = startClock(startSession(2), 1000);
    expect(elapsedMs(m.clock, 61000)).toBe(60000);
    m = pauseClock(m, 31000);
    expect(elapsedMs(m.clock, 999999)).toBe(30000);
    m = startClock(m, 50000);
    expect(elapsedMs(m.clock, 60000)).toBe(40000);
  });

  it('dominance: 3 wins in a row, with dismissal', () => {
    let m = startSession(3);
    m = win(m, 0);
    m = win(m, 0);
    expect(dominantTeam(m, 3)).toBeNull();
    m = win(m, 0);
    expect(dominantTeam(m, 3)).toBe(0);
    m = dismissDominance(m, 0);
    expect(dominantTeam(m, 3)).toBeNull();
    m = win(m, 0);
    m = win(m, 0);
    expect(dominantTeam(m, 3)).toBe(0);
  });

  it('keeper rotation', () => {
    expect([0, 1, 2, 3, 4].map((c) => keeperIndex(c, 1, 3))).toEqual([0, 1, 2, 0, 1]);
    expect([0, 1, 2, 3].map((c) => keeperIndex(c, 2, 3))).toEqual([0, 0, 1, 1]);
  });

  it('new team joins the queue; sanitize repairs', () => {
    const m = addTeam(startSession(2), 2);
    expect(m.queue).toEqual([2]);
    expect(m.streak).toHaveLength(3);
    expect(sanitizeMatch({ onPitch: [0, 0] }, 2)).toBeNull();
    expect(sanitizeMatch({ onPitch: [1, 2], queue: [] }, 4)!.queue).toEqual([0, 3]);
  });

  it('borrowing: the short team completes itself from the team that just left, for one match', () => {
    const sizes = [5, 5, 4];
    let m = startSession(3);
    expect(borrowNeed(m, sizes, 5)).toBeNull(); // first match: the short team waits
    m = win(m, 0); // 1 loses, 2 (short) comes on
    expect(m.onPitch).toEqual([0, 2]);
    expect(borrowNeed(m, sizes, 5)).toEqual({ team: 2, from: 1, opponent: 0, need: 1 });
    m = setBorrow(m, { team: 2, from: 1, ids: ['dani'] });
    expect(borrowedInto(m, 2)).toEqual(['dani']);
    expect(borrowedInto(m, 0)).toEqual([]);
    // The short team wins and stays: the borrower goes back, and it borrows again from the new loser.
    m = win(m, 2);
    expect(m.borrow).toBeNull();
    expect(m.history[1].borrow).toEqual({ team: 2, from: 1, ids: ['dani'] });
    expect(m.onPitch).toEqual([1, 2]);
    expect(m.queue).toEqual([0]);
    expect(borrowNeed(m, sizes, 5)).toEqual({ team: 2, from: 0, opponent: 1, need: 1 });
    // Skipping is recorded as an empty list and isn't kept in history.
    m = setBorrow(m, { team: 2, from: 0, ids: [] });
    m = win(m, 1);
    expect(m.history[2].borrow).toBeUndefined();
    // Two full teams on the pitch: nothing to borrow.
    expect(m.onPitch).toEqual([1, 0]);
    expect(borrowNeed(m, sizes, 5)).toBeNull();
  });

  it('borrowing: two short players, and no borrowing without a queue', () => {
    let m = win(startSession(3), 1);
    expect(borrowNeed(m, [5, 5, 3], 5)).toEqual({ team: 2, from: 0, opponent: 1, need: 2 });
    let two = win(startSession(2), 0);
    expect(borrowNeed(two, [5, 4], 5)).toBeNull();
    two = setBorrow(two, null);
    expect(two.borrow).toBeNull();
  });

  it('sanitize keeps a valid borrow and loads old states without one', () => {
    let m = win(startSession(3), 0);
    m = setBorrow(m, { team: 2, from: 1, ids: ['a', 'a', 'b'] });
    expect(sanitizeMatch(JSON.parse(JSON.stringify(m)), 3)!.borrow).toEqual({ team: 2, from: 1, ids: ['a', 'b'] });
    const old = JSON.parse(JSON.stringify(m));
    delete old.borrow;
    expect(sanitizeMatch(old, 3)!.borrow).toBeNull();
    expect(sanitizeMatch({ ...old, borrow: { team: 9, from: 1, ids: [] } }, 3)!.borrow).toBeNull();
    expect(sanitizeMatch({ ...old, borrow: { team: 1, from: 1, ids: [] } }, 3)!.borrow).toBeNull();
    expect(sanitizeMatch({ ...old, borrow: { team: 2, from: 1, ids: 'x' } }, 3)!.borrow).toBeNull();
    expect(sanitizeMatch({ ...old, borrow: { team: 2, from: 1, ids: [1, 'c'] } }, 3)!.borrow).toEqual({ team: 2, from: 1, ids: ['c'] });
  });
});

describe('penalties', () => {
  const level = (m: MatchState, goals = 0) => {
    for (let i = 0; i < goals; i++) m = addGoal(addGoal(m, m.onPitch[0], 0), m.onPitch[1], 0);
    return m;
  };

  it('the penalty winner stays and the loser goes to the back of the queue', () => {
    let m = startSession(4); // 0 v 1, queue 2, 3
    m = endOnPenalties(level(m), 1, 5, [2, 3]);
    expect(m.onPitch).toEqual([2, 1]);
    expect(m.queue).toEqual([3, 0]);
    expect(m.history[0]).toMatchObject({ goalsA: 0, goalsB: 0, out: 0, pens: { winner: 1, a: 2, b: 3 } });
    expect(m.streak[1]).toBe(1);
    expect(m.streak[0]).toBe(0);
  });

  it('counts as a win and a loss in standings and streaks, never as goals', () => {
    let m = startSession(3);
    m = win(m, 0); // 0 beats 1
    m = endOnPenalties(level(m, 1), 0, 0); // 0 v 2, 1–1, 0 wins on pens
    m = endOnPenalties(level(m), 0, 0, [5, 4]); // 0 v 1
    const t = standings(m, 3);
    expect(t[0]).toMatchObject({ played: 3, won: 3, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 1 });
    expect(t[2]).toMatchObject({ played: 1, won: 0, drawn: 0, lost: 1, goalsFor: 1, goalsAgainst: 1 });
    expect(m.streak[0]).toBe(3);
    expect(dominantTeam(m, 3)).toBe(0);
    expect(matchWinner(m.history[1])).toBe(0);
  });

  it('two teams: nobody leaves, but the shoot-out still decides the result', () => {
    let m = startSession(2);
    m = endOnPenalties(level(m), 1, 0);
    expect(m.onPitch).toEqual([0, 1]);
    expect(m.history[0]).toMatchObject({ out: null, pens: { winner: 1 } });
    expect(standings(m, 2)[1].won).toBe(1);
  });

  it('ignores penalties on a match that was not level, or a winner not on the pitch', () => {
    const m = addGoal(startSession(3), 0, 0);
    expect(endOnPenalties(m, 1, 0)).toBe(m);
    expect(endOnPenalties(startSession(3), 2, 0).history).toHaveLength(0);
    // endMatch with pens that contradict "who leaves": recorded as a plain draw.
    const plain = endMatch(startSession(3), 0, 0, { winner: 0 });
    expect(plain.history[0].pens).toBeUndefined();
    expect(standings(plain, 3)[0].drawn).toBe(1);
  });

  it('keeps the kicks only when they agree with the winner', () => {
    expect(cleanPens({ winner: 1, a: 3, b: 4 }, 0, 1, 2, 2)).toEqual({ winner: 1, a: 3, b: 4 });
    expect(cleanPens({ winner: 1, a: 4, b: 3 }, 0, 1, 2, 2)).toEqual({ winner: 1 });
    expect(cleanPens({ winner: 0, a: 3, b: 3 }, 0, 1, 0, 0)).toEqual({ winner: 0 });
    expect(cleanPens({ winner: 0, a: -1, b: 'x' }, 0, 1, 0, 0)).toEqual({ winner: 0 });
    expect(cleanPens({ winner: 2 }, 0, 1, 0, 0)).toBeNull();
    expect(cleanPens({ winner: 0 }, 0, 1, 1, 0)).toBeNull();
    expect(cleanPens('pens', 0, 1, 0, 0)).toBeNull();
  });

  it('sanitize: old records without pens load unchanged, garbage pens are dropped', () => {
    let m = endOnPenalties(level(startSession(3)), 1, 0, [1, 3]);
    m = win(m, 2);
    const raw = JSON.parse(JSON.stringify(m));
    expect(sanitizeMatch(raw, 3)!.history).toEqual(m.history);
    raw.history[0].pens = { winner: 7, a: 1, b: 3 };
    raw.history[1].pens = { winner: raw.history[1].a }; // not a level match
    const clean = sanitizeMatch(raw, 3)!;
    expect(clean.history[0]).not.toHaveProperty('pens');
    expect(clean.history[1]).not.toHaveProperty('pens');
    expect(standings(clean, 3)[0].drawn).toBe(1);
  });
});

describe('match length (v5)', () => {
  const M = 60_000;
  const started = (ms: number) => pauseClock(startClock(startSession(3), 0), ms);

  it('a match without its own length uses the default', () => {
    const m = started(3 * M);
    expect(matchLength(m, 8 * M)).toBe(8 * M);
    expect(remainingMs(m, 3 * M, 8 * M)).toBe(5 * M);
    expect(remainingMs(m, 3 * M, null)).toBeNull();
  });

  it('changing the length mid-match keeps the elapsed time and moves the finish', () => {
    let m = startClock(startSession(3), 0);
    m = setMatchLength(m, 6 * M);
    expect(remainingMs(m, 2 * M, 8 * M)).toBe(4 * M);
    expect(elapsedMs(m.clock, 2 * M)).toBe(2 * M);
    // Shorter than what's already played: overtime, never a "negative remaining" bug elsewhere.
    m = setMatchLength(m, 1 * M);
    expect(remainingMs(m, 2 * M, 8 * M)).toBe(-1 * M);
    expect(m.clock.running).toBe(true);
  });

  it('+1 / −1 minute change this match only, clamped to 1–60', () => {
    let m = started(7.5 * M);
    m = adjustMatchLength(m, M, 8 * M);
    expect(matchLength(m, 8 * M)).toBe(9 * M);
    expect(remainingMs(m, 0, 8 * M)).toBe(1.5 * M);
    m = adjustMatchLength(adjustMatchLength(m, -M, 8 * M), -M, 8 * M);
    expect(remainingMs(m, 0, 8 * M)).toBe(-0.5 * M);
    expect(matchLength(setMatchLength(m, 0), 8 * M)).toBe(M);
    expect(matchLength(setMatchLength(m, 999 * M), 8 * M)).toBe(60 * M);
    expect(matchLength(adjustMatchLength(setMatchLength(m, M), -M, 8 * M), 8 * M)).toBe(M);
    // The next match goes back to the default.
    m = endMatch(m, 1, 10 * M);
    expect(matchLength(m, 8 * M)).toBe(8 * M);
  });

  it('no time limit: no remaining time, ±1 does nothing, and it can be switched back', () => {
    let m = setMatchLength(started(20 * M), null);
    expect(matchLength(m, 8 * M)).toBeNull();
    expect(remainingMs(m, 0, 8 * M)).toBeNull();
    expect(adjustMatchLength(m, M, 8 * M)).toBe(m);
    m = setMatchLength(m, 8 * M);
    expect(remainingMs(m, 0, 8 * M)).toBe(-12 * M);
    // A default of "no limit" applies to a match that didn't set its own.
    expect(remainingMs(started(M), 0, null)).toBeNull();
  });

  it('sanitize: old saved states have no length; stale and malformed ones are dropped', () => {
    const m = started(M);
    const { length: _drop, ...old } = setMatchLength(m, 5 * M);
    void _drop;
    expect(sanitizeMatch(JSON.parse(JSON.stringify(old)), 3)!.length).toBeUndefined();
    expect(matchLength(sanitizeMatch(JSON.parse(JSON.stringify(old)), 3)!, 8 * M)).toBe(8 * M);
    const kept = sanitizeMatch(JSON.parse(JSON.stringify(setMatchLength(m, 5 * M))), 3)!;
    expect(matchLength(kept, 8 * M)).toBe(5 * M);
    expect(sanitizeMatch(JSON.parse(JSON.stringify(setMatchLength(m, null))), 3)!.length).toEqual({ at: 0, ms: null });
    expect(sanitizeMatch({ ...m, length: { at: 3, ms: 5 * M } }, 3)!.length).toBeUndefined();
    expect(sanitizeMatch({ ...m, length: { at: 0, ms: 'x' } }, 3)!.length).toBeUndefined();
    expect(sanitizeMatch({ ...m, length: { at: 0, ms: -5 } }, 3)!.length).toBeUndefined();
    expect(sanitizeMatch({ ...m, length: { at: 0, ms: 7.4 * M } }, 3)!.length).toEqual({ at: 0, ms: 7 * M });
  });
});
