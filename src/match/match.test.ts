import { describe, expect, it } from 'vitest';
import {
  addGoal,
  addTeam,
  defaultOutOnDraw,
  dismissDominance,
  dominantTeam,
  elapsedMs,
  endMatch,
  keeperIndex,
  loserOf,
  pauseClock,
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
});
