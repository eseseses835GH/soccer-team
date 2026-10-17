import { describe, expect, it } from 'vitest';
import {
  ATTR_KEYS,
  DEFAULT_OPTIONS,
  canonical,
  createRng,
  evaluate,
  keyOf,
  pickReroll,
  search,
  teamSizes,
  type Attributes,
  type Constraints,
  type Player,
} from './index';

const NONE: Constraints = { together: [], apart: [] };

function mkPlayers(n: number, seed = 1, gkEvery = 0): Player[] {
  const rng = createRng(seed);
  return Array.from({ length: n }, (_, i) => {
    const attrs = {} as Attributes;
    for (const k of ATTR_KEYS) attrs[k] = 1 + Math.floor(rng() * 10);
    return { id: `p${i}`, name: `P${i}`, attrs, canGK: gkEvery > 0 && i % gkEvery === 0 };
  });
}

function sizesOf(asg: number[], k: number) {
  const s = new Array(k).fill(0);
  asg.forEach((t) => s[t]++);
  return s.sort((a, b) => b - a);
}

/** Brute force over all k^n labelings (tiny n only) for an optimality check. */
function bruteForceBest(players: Player[], k: number, c: Constraints = NONE) {
  const n = players.length;
  let best = Infinity;
  const asg = new Array(n).fill(0);
  const total = k ** n;
  for (let m = 0; m < total; m++) {
    let x = m;
    for (let i = 0; i < n; i++) {
      asg[i] = x % k;
      x = Math.floor(x / k);
    }
    const sz = sizesOf(asg, k);
    if (sz.join() !== teamSizes(n, k).join()) continue;
    best = Math.min(best, evaluate(players, asg, k, DEFAULT_OPTIONS, c).cost);
  }
  return best;
}

describe('teamSizes', () => {
  it('auto-detects formats', () => {
    expect(teamSizes(8, 2)).toEqual([4, 4]);
    expect(teamSizes(10, 2)).toEqual([5, 5]);
    expect(teamSizes(11, 2)).toEqual([6, 5]);
    expect(teamSizes(14, 3)).toEqual([5, 5, 4]);
    expect(teamSizes(12, 3)).toEqual([4, 4, 4]);
  });
});

describe('search — 2 teams', () => {
  it('even count: equal sizes and optimal (exhaustive)', () => {
    const players = mkPlayers(10, 3);
    const r = search(players, 2, DEFAULT_OPTIONS, NONE, { seed: 1 });
    expect(r.method).toBe('exhaustive');
    expect(sizesOf(r.best.assignment, 2)).toEqual([5, 5]);
    // Exhaustive over fixed-first: C(9,4) = 126 splits.
    expect(r.evaluated).toBe(126);
    expect(r.best.cost).toBeCloseTo(bruteForceBest(players, 2), 9);
  });

  it('odd count: sizes differ by one and optimal', () => {
    const players = mkPlayers(9, 5);
    const r = search(players, 2, DEFAULT_OPTIONS, NONE, { seed: 1 });
    expect(sizesOf(r.best.assignment, 2)).toEqual([5, 4]);
    expect(r.best.cost).toBeCloseTo(bruteForceBest(players, 2), 9);
  });

  it('balanced result is much better than an arbitrary split', () => {
    const players = mkPlayers(12, 7);
    const r = search(players, 2, DEFAULT_OPTIONS, NONE, { seed: 1 });
    const naive = players.map((_, i) => (i < 6 ? 0 : 1));
    const naiveCost = evaluate(players, naive, 2, DEFAULT_OPTIONS).cost;
    expect(r.best.cost).toBeLessThanOrEqual(naiveCost);
    expect(evaluate(players, r.best.assignment, 2, DEFAULT_OPTIONS).score).toBeGreaterThan(75);
  });

  it('local search finds the exhaustive optimum on 12 players', () => {
    const players = mkPlayers(12, 11);
    const ex = search(players, 2, DEFAULT_OPTIONS, NONE, { seed: 1 });
    const loc = search(players, 2, DEFAULT_OPTIONS, NONE, { seed: 1, exhaustiveMax: 0, maxRestarts: 200, timeBudgetMs: 1e9 });
    expect(loc.method).toBe('local');
    expect(loc.best.cost).toBeCloseTo(ex.best.cost, 9);
  });
});

describe('search — 3 teams', () => {
  it('splits 12 into 4/4/4 and matches brute force on small input', () => {
    const players = mkPlayers(9, 13);
    const r = search(players, 3, DEFAULT_OPTIONS, NONE, { seed: 2, maxRestarts: 300, timeBudgetMs: 1e9 });
    expect(r.method).toBe('local');
    expect(sizesOf(r.best.assignment, 3)).toEqual([3, 3, 3]);
    expect(r.best.cost).toBeCloseTo(bruteForceBest(players, 3), 9);
  });

  it('uneven 3-team sizes differ by at most one', () => {
    const players = mkPlayers(16, 17);
    const r = search(players, 3, DEFAULT_OPTIONS, NONE, { seed: 3 });
    expect(sizesOf(r.best.assignment, 3)).toEqual([6, 5, 5]);
  });
});

describe('constraints', () => {
  it('keep-together and keep-apart are respected', () => {
    const players = mkPlayers(10, 21);
    const c: Constraints = {
      together: [
        ['p0', 'p1'],
        ['p2', 'p3'],
      ],
      apart: [
        ['p4', 'p5'],
        ['p0', 'p6'],
      ],
    };
    for (const k of [2, 3]) {
      const r = search(players, k, DEFAULT_OPTIONS, c, { seed: 4, maxRestarts: 200, timeBudgetMs: 1e9 });
      const a = r.best.assignment;
      expect(a[0]).toBe(a[1]);
      expect(a[2]).toBe(a[3]);
      expect(a[4]).not.toBe(a[5]);
      expect(a[0]).not.toBe(a[6]);
      expect(evaluate(players, a, k, DEFAULT_OPTIONS, c).violations).toEqual({ together: [], apart: [] });
    }
  });

  it('reports violations after a manual change', () => {
    const players = mkPlayers(4, 1);
    const c: Constraints = { together: [['p0', 'p1']], apart: [] };
    const ev = evaluate(players, [0, 1, 0, 1], 2, DEFAULT_OPTIONS, c);
    expect(ev.violations.together).toEqual([['p0', 'p1']]);
    expect(ev.penalties.constraints).toBeGreaterThan(0);
  });
});

describe('goalkeepers and leaders', () => {
  it('every team gets a goalkeeper when enough exist', () => {
    // Goalkeepers p0, p1, p2 (bunched at the start), 12 players, 3 teams.
    const players = mkPlayers(12, 31).map((p, i) => ({ ...p, canGK: i < 3 }));
    for (const k of [2, 3]) {
      const r = search(players, k, DEFAULT_OPTIONS, NONE, { seed: 5, maxRestarts: 200, timeBudgetMs: 1e9 });
      const ev = evaluate(players, r.best.assignment, k, DEFAULT_OPTIONS);
      expect(ev.teams.every((t) => t.goalkeepers >= 1)).toBe(true);
      expect(ev.penalties.goalkeeper).toBe(0);
    }
  });

  it('with fewer keepers than teams, keepers are not stacked', () => {
    const players = mkPlayers(12, 33).map((p, i) => ({ ...p, canGK: i < 2 }));
    const r = search(players, 3, DEFAULT_OPTIONS, NONE, { seed: 6, maxRestarts: 200, timeBudgetMs: 1e9 });
    const ev = evaluate(players, r.best.assignment, 3, DEFAULT_OPTIONS);
    expect(ev.teams.filter((t) => t.goalkeepers > 0).length).toBe(2);
  });

  it('every team gets a leader when enough exist', () => {
    const players = mkPlayers(10, 41).map((p, i) => ({
      ...p,
      attrs: { ...p.attrs, leadership: i < 2 ? 9 : 3 },
    }));
    const r = search(players, 2, DEFAULT_OPTIONS, NONE, { seed: 7 });
    const ev = evaluate(players, r.best.assignment, 2, DEFAULT_OPTIONS);
    expect(ev.teams.map((t) => t.leaders)).toEqual([1, 1]);
  });
});

describe('determinism and re-roll', () => {
  it('same seed -> same result (local search)', () => {
    const players = mkPlayers(18, 51);
    const o = { maxRestarts: 50, timeBudgetMs: 1e9 };
    const a = search(players, 3, DEFAULT_OPTIONS, NONE, { seed: 42, ...o });
    const b = search(players, 3, DEFAULT_OPTIONS, NONE, { seed: 42, ...o });
    expect(a.best).toEqual(b.best);
    expect(a.pool).toEqual(b.pool);
  });

  it('re-roll yields a different, near-optimal split', () => {
    const players = mkPlayers(10, 61);
    const r = search(players, 2, DEFAULT_OPTIONS, NONE, { seed: 1 });
    const rng = createRng(9);
    const seen = new Set([keyOf(r.best.assignment)]);
    let shown = [r.best.assignment];
    for (let i = 0; i < 5; i++) {
      const next = pickReroll(r.pool, shown, rng);
      expect(keyOf(next.assignment)).not.toBe(keyOf(shown[shown.length - 1]));
      expect(next.cost).toBeLessThanOrEqual(r.best.cost + 0.5 + 1e-9);
      seen.add(keyOf(next.assignment));
      shown = [...shown, next.assignment];
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it('canonical relabels teams by first appearance', () => {
    expect(canonical([2, 2, 0, 1])).toEqual([0, 0, 1, 2]);
    expect(keyOf([1, 0, 1])).toBe(keyOf([0, 1, 0]));
  });
});

describe('performance', () => {
  it('22 players, 2 teams in under a second', () => {
    const players = mkPlayers(22, 71, 5);
    const t0 = performance.now();
    const r = search(players, 2, DEFAULT_OPTIONS, NONE, { seed: 1, timeBudgetMs: 300 });
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(1000);
    expect(sizesOf(r.best.assignment, 2)).toEqual([11, 11]);
    expect(evaluate(players, r.best.assignment, 2, DEFAULT_OPTIONS).score).toBeGreaterThan(75);
  });

  it('22 players, 3 teams in under a second', () => {
    const players = mkPlayers(22, 72, 4);
    const t0 = performance.now();
    search(players, 3, DEFAULT_OPTIONS, NONE, { seed: 1, timeBudgetMs: 300 });
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('14 players exhaustive is fast', () => {
    const players = mkPlayers(14, 73);
    const t0 = performance.now();
    const r = search(players, 2, DEFAULT_OPTIONS, NONE, { seed: 1 });
    expect(r.method).toBe('exhaustive');
    expect(r.evaluated).toBe(1716);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
