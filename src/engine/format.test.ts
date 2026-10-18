import { describe, expect, it } from 'vitest';
import {
  ATTR_KEYS,
  DEFAULT_OPTIONS,
  createRng,
  describePlan,
  evaluate,
  planFormat,
  search,
  suggestSwaps,
  suggestWeakeningSwap,
  type Attributes,
  type Player,
} from './index';

const NONE = { together: [], apart: [] };

function mkPlayers(n: number, seed = 1): Player[] {
  const rng = createRng(seed);
  return Array.from({ length: n }, (_, i) => {
    const attrs = {} as Attributes;
    for (const k of ATTR_KEYS) attrs[k] = 1 + Math.floor(rng() * 10);
    return { id: `p${i}`, name: `P${i}`, attrs, canGK: false };
  });
}

describe('planFormat (winner stays)', () => {
  it('full teams, short waiting team, or subs', () => {
    expect(planFormat(10, 5)).toMatchObject({ sizes: [5, 5], subs: 0 });
    expect(planFormat(14, 5)).toMatchObject({ sizes: [5, 5, 4], subs: 0, shortWaiting: true });
    expect(planFormat(13, 5)).toMatchObject({ sizes: [5, 5, 3], subs: 0 });
    expect(planFormat(11, 5)).toMatchObject({ sizes: [5, 5], subs: 1 });
    expect(planFormat(12, 5)).toMatchObject({ sizes: [5, 5], subs: 2 });
    expect(planFormat(15, 5)).toMatchObject({ sizes: [5, 5, 5], subs: 0 });
    expect(planFormat(11, 4)).toMatchObject({ sizes: [4, 4, 3], subs: 0 });
    expect(planFormat(9, 4)).toMatchObject({ sizes: [4, 4], subs: 1 });
    expect(planFormat(10, 4)).toMatchObject({ sizes: [4, 4, 2], subs: 0 });
  });
  it('too few for the chosen size falls back to two even teams', () => {
    expect(planFormat(8, 5)).toMatchObject({ sizes: [4, 4], subs: 0, reduced: true });
    expect(planFormat(9, 5)).toMatchObject({ sizes: [5, 4], reduced: true });
    expect(planFormat(3, 5)).toBeNull();
  });
  it('describes the plan in Hebrew', () => {
    expect(describePlan(planFormat(14, 5)!)).toBe('5 נגד 5 · 4 בחוץ');
    expect(describePlan(planFormat(11, 5)!)).toBe('5 נגד 5 + מחליף');
    expect(describePlan(planFormat(15, 5)!)).toBe('5 נגד 5 · קבוצה בחוץ');
  });
});

describe('explicit sizes', () => {
  it('search honours [5,5,4]', () => {
    const players = mkPlayers(14, 3);
    const r = search(players, 3, DEFAULT_OPTIONS, NONE, { seed: 1, sizes: [5, 5, 4], maxRestarts: 100, timeBudgetMs: 1e9 });
    const counts = [0, 0, 0];
    r.best.assignment.forEach((t) => counts[t]++);
    expect(counts.sort()).toEqual([4, 5, 5]);
  });
  it('rejects sizes that do not add up', () => {
    expect(() => search(mkPlayers(10), 2, DEFAULT_OPTIONS, NONE, { seed: 1, sizes: [5, 4] })).toThrow();
  });
  it('gkPenalty 0 turns the goalkeeper rule off', () => {
    const players = mkPlayers(6, 2).map((p, i) => ({ ...p, canGK: i < 2 }));
    const ev = evaluate(players, [0, 0, 0, 1, 1, 1], 2, { ...DEFAULT_OPTIONS, gkPenalty: 0 });
    expect(ev.penalties.goalkeeper).toBe(0);
    const ev2 = evaluate(players, [0, 0, 0, 1, 1, 1], 2, DEFAULT_OPTIONS);
    expect(ev2.penalties.goalkeeper).toBeGreaterThan(0);
  });
});

describe('swap suggestions', () => {
  it('improves a bad split with at most 2 swaps', () => {
    const players = mkPlayers(10, 5).sort((a, b) => b.attrs.overall - a.attrs.overall);
    const bad = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1];
    const s = suggestSwaps(players, bad, 2, DEFAULT_OPTIONS, NONE)!;
    expect(s.swaps.length).toBeGreaterThan(0);
    expect(s.swaps.length).toBeLessThanOrEqual(2);
    expect(s.after).toBeLessThan(s.before);
  });
  it('returns null when already optimal', () => {
    const players = mkPlayers(8, 6);
    const best = search(players, 2, DEFAULT_OPTIONS, NONE, { seed: 1 }).best.assignment;
    expect(suggestSwaps(players, best, 2, DEFAULT_OPTIONS, NONE)).toBeNull();
  });
  it('weakening swap makes the dominant team weaker', () => {
    const players = mkPlayers(10, 7);
    const asg = search(players, 2, DEFAULT_OPTIONS, NONE, { seed: 1 }).best.assignment;
    const s = suggestWeakeningSwap(players, asg, 2, 0, DEFAULT_OPTIONS, NONE)!;
    const before = evaluate(players, asg, 2, DEFAULT_OPTIONS).teams[0].strength;
    const after = evaluate(players, s.assignment, 2, DEFAULT_OPTIONS).teams[0].strength;
    expect(after).toBeLessThan(before);
  });
});
