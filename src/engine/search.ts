import { buildProblem, cost, type Problem } from './cost';
import { createRng, randInt, shuffle, type Rng } from './rng';
import type { Assignment, Constraints, EngineOptions, Player, Solution } from './types';

export interface SearchOptions {
  seed: number;
  /** How many distinct good solutions to keep for re-rolls. */
  poolSize?: number;
  /** Use exhaustive search for 2 teams up to this many players. */
  exhaustiveMax?: number;
  /** Local search: wall-clock budget in ms. */
  timeBudgetMs?: number;
  /** Local search: max number of restarts (deterministic stop). */
  maxRestarts?: number;
  /** Explicit team sizes (default: as equal as possible). */
  sizes?: number[];
  /** Injectable clock (tests). */
  now?: () => number;
}

export interface SearchResult {
  best: Solution;
  /** Distinct solutions sorted by cost, best first. */
  pool: Solution[];
  method: 'exhaustive' | 'local';
  evaluated: number;
}

/**
 * Canonical key of a partition: team labels are interchangeable, so relabel
 * teams in order of first appearance.
 */
export function canonical(asg: Assignment): Assignment {
  const map = new Map<number, number>();
  return asg.map((t) => {
    let c = map.get(t);
    if (c === undefined) {
      c = map.size;
      map.set(t, c);
    }
    return c;
  });
}

export function keyOf(asg: Assignment): string {
  return canonical(asg).join('');
}

/** Bounded pool of the best distinct solutions. */
class Pool {
  private items: Solution[] = [];
  private keys = new Set<string>();
  constructor(private cap: number) {}

  add(asg: Assignment, c: number) {
    if (this.items.length >= this.cap && c >= this.items[this.items.length - 1].cost) return;
    const can = canonical(asg);
    const key = can.join(',');
    if (this.keys.has(key)) return;
    // Insert sorted (cap is small, linear insert is fine).
    let i = this.items.length;
    while (i > 0 && this.items[i - 1].cost > c) i--;
    this.items.splice(i, 0, { assignment: can, cost: c });
    this.keys.add(key);
    if (this.items.length > this.cap) {
      const dropped = this.items.pop()!;
      this.keys.delete(dropped.assignment.join(','));
    }
  }

  get list() {
    return this.items;
  }
}

/** Enumerate all 2-team splits with the target sizes. */
function exhaustive2(pr: Problem, pool: Pool): number {
  const { n } = pr;
  const [s0, s1] = pr.targetSizes;
  const asg = new Array<number>(n).fill(1);
  let count = 0;
  // With equal sizes, fixing player 0 in team 0 removes mirrored duplicates.
  const fixFirst = s0 === s1;
  const start = fixFirst ? 1 : 0;
  const need = fixFirst ? s0 - 1 : s0;
  if (fixFirst) asg[0] = 0;

  const rec = (from: number, left: number) => {
    if (left === 0) {
      count++;
      pool.add(asg, cost(pr, asg));
      return;
    }
    for (let i = from; i <= n - left; i++) {
      asg[i] = 0;
      rec(i + 1, left - 1);
      asg[i] = 1;
    }
  };
  rec(start, need);
  return count;
}

/** Strength used to seed a snake draft. */
function strengthOf(pr: Problem, i: number): number {
  let s = 0;
  const na = pr.weights.length;
  for (let a = 0; a < na; a++) s += pr.weights[a] * pr.vals[i * na + a];
  return s;
}

/** Random assignment that respects target sizes. */
function randomStart(pr: Problem, rng: Rng): Assignment {
  const order = shuffle(rng, Array.from({ length: pr.n }, (_, i) => i));
  const asg = new Array<number>(pr.n);
  let p = 0;
  pr.targetSizes.forEach((size, t) => {
    for (let j = 0; j < size; j++) asg[order[p++]] = t;
  });
  return asg;
}

/** Noisy snake draft: strongest first, A-B-B-A..., respecting sizes. */
function greedyStart(pr: Problem, rng: Rng): Assignment {
  const noisy = Array.from({ length: pr.n }, (_, i) => ({ i, s: strengthOf(pr, i) * (0.85 + 0.3 * rng()) }));
  noisy.sort((a, b) => b.s - a.s);
  const asg = new Array<number>(pr.n);
  const left = [...pr.targetSizes];
  // Random team order so the "first pick" isn't always team 0.
  const teams = shuffle(rng, Array.from({ length: pr.k }, (_, t) => t));
  let dir = 1;
  let pos = 0;
  for (const { i } of noisy) {
    // Find the next team in snake order that still has room.
    let guard = 0;
    while (left[teams[pos]] === 0 && guard++ < 2 * pr.k) {
      pos += dir;
      if (pos === pr.k || pos === -1) {
        dir = -dir;
        pos += dir;
      }
    }
    const t = teams[pos];
    asg[i] = t;
    left[t]--;
    pos += dir;
    if (pos === pr.k || pos === -1) {
      dir = -dir;
      pos += dir;
    }
  }
  return asg;
}

/**
 * First-improvement hill climbing over pairwise swaps between teams (swaps
 * keep team sizes fixed). Visits pairs in random order. Every evaluated
 * neighbour is offered to the pool, which builds a rich set of near-optimal
 * alternatives for re-rolls at no extra cost.
 */
function hillClimb(pr: Problem, asg: Assignment, rng: Rng, pool: Pool): { cost: number; evals: number } {
  const n = pr.n;
  let cur = cost(pr, asg);
  let evals = 1;
  const idx = Array.from({ length: n }, (_, i) => i);
  let improved = true;
  while (improved) {
    improved = false;
    shuffle(rng, idx);
    outer: for (let x = 0; x < n; x++) {
      const i = idx[x];
      for (let y = x + 1; y < n; y++) {
        const j = idx[y];
        if (asg[i] === asg[j]) continue;
        const ti = asg[i];
        asg[i] = asg[j];
        asg[j] = ti;
        const c = cost(pr, asg);
        evals++;
        pool.add(asg, c);
        if (c < cur - 1e-12) {
          cur = c;
          improved = true;
          break outer;
        }
        asg[j] = asg[i];
        asg[i] = ti;
      }
    }
  }
  pool.add(asg, cur);
  return { cost: cur, evals };
}

function localSearch(pr: Problem, rng: Rng, pool: Pool, opts: Required<Omit<SearchOptions, 'seed'>>): number {
  const t0 = opts.now();
  let evals = 0;
  for (let r = 0; r < opts.maxRestarts; r++) {
    if (r > 0 && opts.now() - t0 > opts.timeBudgetMs) break;
    const start = r % 2 === 0 ? greedyStart(pr, rng) : randomStart(pr, rng);
    evals += hillClimb(pr, start, rng, pool).evals;
  }
  return evals;
}

const nowDefault = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Find balanced teams. Deterministic for a given seed (and maxRestarts-bound runs). */
export function search(
  players: Player[],
  k: number,
  options: EngineOptions,
  constraints: Constraints,
  sopts: SearchOptions,
): SearchResult {
  const opts = {
    poolSize: sopts.poolSize ?? 40,
    exhaustiveMax: sopts.exhaustiveMax ?? 14,
    timeBudgetMs: sopts.timeBudgetMs ?? 250,
    maxRestarts: sopts.maxRestarts ?? 2000,
    now: sopts.now ?? nowDefault,
    sizes: sopts.sizes as number[],
  };
  if (k < 1) throw new Error('need at least one team');
  if (players.length < k) throw new Error('not enough players');
  const pr = buildProblem(players, k, options, constraints, sopts.sizes);
  const pool = new Pool(opts.poolSize);
  const rng = createRng(sopts.seed);
  let method: SearchResult['method'];
  let evaluated: number;
  if (k === 1) {
    const asg = new Array<number>(players.length).fill(0);
    pool.add(asg, cost(pr, asg));
    method = 'exhaustive';
    evaluated = 1;
  } else if (k === 2 && players.length <= opts.exhaustiveMax) {
    method = 'exhaustive';
    evaluated = exhaustive2(pr, pool);
  } else {
    method = 'local';
    evaluated = localSearch(pr, rng, pool, opts);
  }
  return { best: pool.list[0], pool: [...pool.list], method, evaluated };
}

/**
 * Pick a different near-optimal solution for a re-roll.
 *
 * Candidates are pool entries within `max(minTol, relTol * best)` rating points
 * of the best one. If that leaves fewer than `minCandidates`, the next best
 * ones are added, but never beyond `hardCap` points (which is kept below every
 * penalty, so a re-roll never drops a goalkeeper/leader/constraint).
 * The current and recently shown splits are excluded when possible.
 */
export function pickReroll(
  pool: Solution[],
  exclude: Assignment[],
  rng: Rng,
  { minTol = 0.15, relTol = 0.4, minCandidates = 3, hardCap = 0.5 } = {},
): Solution {
  if (pool.length === 0) throw new Error('empty pool');
  const best = pool[0].cost;
  const tol = Math.max(minTol, relTol * best);
  let near = pool.filter((s) => s.cost <= best + tol);
  if (near.length < minCandidates) {
    near = pool.filter((s) => s.cost <= best + hardCap).slice(0, Math.max(near.length, minCandidates));
  }
  const excluded = new Set(exclude.map(keyOf));
  let candidates = near.filter((s) => !excluded.has(keyOf(s.assignment)));
  if (candidates.length === 0) {
    // Everything near-optimal was shown already: allow repeats, but still
    // avoid the one currently on screen if possible.
    const current = exclude.length ? keyOf(exclude[exclude.length - 1]) : '';
    candidates = near.filter((s) => keyOf(s.assignment) !== current);
  }
  if (candidates.length === 0) candidates = pool.slice(0, 1);
  return candidates[randInt(rng, candidates.length)];
}
