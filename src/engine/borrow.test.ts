import { describe, expect, it } from 'vitest';
import { ATTR_KEYS, DEFAULT_OPTIONS, borrowCost, suggestBorrowers, type Attributes, type Constraints, type Player } from './index';

const NONE: Constraints = { together: [], apart: [] };

function p(id: string, level: number, over: Partial<Attributes> = {}): Player {
  const attrs = {} as Attributes;
  for (const k of ATTR_KEYS) attrs[k] = level;
  return { id, name: id, attrs: { ...attrs, ...over }, canGK: false };
}

const team = (prefix: string, levels: number[]) => levels.map((l, i) => p(`${prefix}${i}`, l));

describe('suggestBorrowers', () => {
  it('picks the donor that makes the short team closest to the opponent', () => {
    const short = team('s', [6, 6, 6, 6]); // sum 24
    const opponent = team('o', [6, 6, 6, 6, 6]); // sum 30 → needs a 6
    const donors = team('d', [9, 3, 6, 8, 4]);
    const best = suggestBorrowers({ short, donors, opponent, need: 1, options: DEFAULT_OPTIONS, constraints: NONE })!;
    expect(best.picks).toEqual([2]);
    expect(best.cost).toBeCloseTo(0);
    expect(best.score).toBe(100);
  });

  it('compensates a weak short team with a strong borrower', () => {
    const short = team('s', [4, 4, 5, 5]); // sum 18
    const opponent = team('o', [7, 7, 6, 6, 6]); // sum 32 → needs a 14, best is the 9
    const donors = team('d', [5, 9, 6, 7, 3]);
    const best = suggestBorrowers({ short, donors, opponent, need: 1, options: DEFAULT_OPTIONS, constraints: NONE })!;
    expect(best.picks).toEqual([1]);
    // Every other choice is worse.
    for (const i of [0, 2, 3, 4]) expect(borrowCost({ short, donors, opponent, need: 1, options: DEFAULT_OPTIONS, constraints: NONE }, [i])).toBeGreaterThan(best.cost);
  });

  it('uses the weighted per-attribute gap, not just the level', () => {
    const short = team('s', [6, 6, 6, 6]);
    const opponent = team('o', [6, 6, 6, 6, 6]);
    // Same level, but d0 is a stamina monster and a poor passer; d1 is plain.
    const donors = [p('d0', 6, { stamina: 10, passing: 2 }), p('d1', 6)];
    const best = suggestBorrowers({ short, donors, opponent, need: 1, options: DEFAULT_OPTIONS, constraints: NONE })!;
    expect(best.picks).toEqual([1]);
  });

  it('handles two borrowers (5 · 5 · 3)', () => {
    const short = team('s', [6, 6, 6]); // sum 18
    const opponent = team('o', [6, 6, 6, 6, 6]); // sum 30 → needs 12 from two
    const donors = team('d', [10, 9, 3, 6, 6]);
    const best = suggestBorrowers({ short, donors, opponent, need: 2, options: DEFAULT_OPTIONS, constraints: NONE })!;
    expect(best.picks).toHaveLength(2);
    expect(best.cost).toBeCloseTo(0);
    // [9,3] and [6,6] both sum to 12 with a zero gap: the earliest combination wins.
    expect(best.picks).toEqual([1, 2]);
  });

  it('breaks ties deterministically by donor order', () => {
    const short = team('s', [5, 5, 5, 5]);
    const opponent = team('o', [5, 5, 5, 5, 5]);
    const donors = team('d', [7, 5, 5, 3]);
    for (let i = 0; i < 3; i++) {
      expect(suggestBorrowers({ short, donors, opponent, need: 1, options: DEFAULT_OPTIONS, constraints: NONE })!.picks).toEqual([1]);
    }
  });

  it('avoids keep-apart pairs inside the new lineup', () => {
    const short = team('s', [6, 6, 6, 6]);
    const opponent = team('o', [6, 6, 6, 6, 6]);
    const donors = team('d', [6, 7]);
    const constraints: Constraints = { together: [], apart: [['s0', 'd0']] };
    const best = suggestBorrowers({ short, donors, opponent, need: 1, options: DEFAULT_OPTIONS, constraints })!;
    expect(best.picks).toEqual([1]);
  });

  it("doesn't split a keep-together pair on the losing team", () => {
    const short = team('s', [6, 6, 6, 6]);
    const opponent = team('o', [6, 6, 6, 6, 6]);
    const donors = team('d', [6, 7, 5]);
    const constraints: Constraints = { together: [['d0', 'd2']], apart: [] };
    const best = suggestBorrowers({ short, donors, opponent, need: 1, options: DEFAULT_OPTIONS, constraints })!;
    expect(best.picks).toEqual([1]);
  });

  it('returns null when nobody is needed, and caps at the donors available', () => {
    const short = team('s', [6, 6, 6, 6]);
    const opponent = team('o', [6, 6, 6, 6, 6]);
    expect(suggestBorrowers({ short, donors: team('d', [6]), opponent, need: 0, options: DEFAULT_OPTIONS, constraints: NONE })).toBeNull();
    expect(suggestBorrowers({ short, donors: [], opponent, need: 1, options: DEFAULT_OPTIONS, constraints: NONE })).toBeNull();
    expect(suggestBorrowers({ short, donors: team('d', [6]), opponent, need: 2, options: DEFAULT_OPTIONS, constraints: NONE })!.picks).toEqual([0]);
  });
});
