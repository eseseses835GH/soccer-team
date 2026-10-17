import {
  ATTR_KEYS,
  type Assignment,
  type Attributes,
  type Constraints,
  type EngineOptions,
  type Evaluation,
  type Pair,
  type Player,
  type TeamStats,
} from './types';
import { teamSizes } from './sizes';

const NA = ATTR_KEYS.length;
const GK_IDX = ATTR_KEYS.indexOf('goalkeeping');

/**
 * Pre-processed problem: flat numeric arrays so the hot loop in the search
 * does no object lookups.
 */
export interface Problem {
  n: number;
  k: number;
  /** n * NA attribute matrix (row-major). */
  vals: Float64Array;
  weights: Float64Array;
  weightSum: number;
  canGK: Uint8Array;
  isLeader: Uint8Array;
  gkCount: number;
  leaderCount: number;
  together: [number, number][];
  apart: [number, number][];
  targetSizes: number[];
  /** Per-attribute mean over all players. */
  groupMean: Float64Array;
  options: EngineOptions;
}

export function buildProblem(
  players: Player[],
  k: number,
  options: EngineOptions,
  constraints: Constraints = { together: [], apart: [] },
): Problem {
  const n = players.length;
  const vals = new Float64Array(n * NA);
  const canGK = new Uint8Array(n);
  const isLeader = new Uint8Array(n);
  const groupMean = new Float64Array(NA);
  players.forEach((p, i) => {
    ATTR_KEYS.forEach((key, a) => {
      const v = clampRating(p.attrs[key]);
      vals[i * NA + a] = v;
      groupMean[a] += v / Math.max(1, n);
    });
    canGK[i] = p.canGK ? 1 : 0;
    isLeader[i] = clampRating(p.attrs.leadership) >= options.leadershipThreshold ? 1 : 0;
  });
  const weights = new Float64Array(ATTR_KEYS.map((key) => Math.max(0, options.weights[key] ?? 0)));
  const weightSum = weights.reduce((s, w) => s + w, 0) || 1;
  const index = new Map(players.map((p, i) => [p.id, i]));
  const mapPairs = (pairs: Pair[]) =>
    pairs
      .map(([a, b]) => [index.get(a), index.get(b)] as const)
      .filter((pr): pr is readonly [number, number] => pr[0] !== undefined && pr[1] !== undefined && pr[0] !== pr[1])
      .map(([a, b]) => [a, b] as [number, number]);
  return {
    n,
    k,
    vals,
    weights,
    weightSum,
    canGK,
    isLeader,
    gkCount: canGK.reduce((s, v) => s + v, 0),
    leaderCount: isLeader.reduce((s, v) => s + v, 0),
    together: mapPairs(constraints.together),
    apart: mapPairs(constraints.apart),
    targetSizes: teamSizes(n, k),
    groupMean,
    options,
  };
}

function clampRating(v: number | undefined): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return 5;
  return Math.min(10, Math.max(1, v));
}

interface Aggregates {
  sizes: number[];
  sums: Float64Array; // k * NA
  bestGK: Float64Array; // k
  gks: number[];
  leaders: number[];
}

function aggregate(pr: Problem, asg: Assignment): Aggregates {
  const { k, n, vals } = pr;
  const sizes = new Array<number>(k).fill(0);
  const gks = new Array<number>(k).fill(0);
  const leaders = new Array<number>(k).fill(0);
  const sums = new Float64Array(k * NA);
  const bestGK = new Float64Array(k);
  for (let i = 0; i < n; i++) {
    const t = asg[i];
    sizes[t]++;
    gks[t] += pr.canGK[i];
    leaders[t] += pr.isLeader[i];
    const row = i * NA;
    const off = t * NA;
    for (let a = 0; a < NA; a++) sums[off + a] += vals[row + a];
    // The keeper's rating that matters is the team's best one (only one
    // player stands in goal). Prefer declared goalkeepers.
    const g = vals[row + GK_IDX] + (pr.canGK[i] ? 100 : 0);
    if (g > bestGK[t]) bestGK[t] = g;
  }
  for (let t = 0; t < k; t++) if (bestGK[t] >= 100) bestGK[t] -= 100;
  return { sizes, sums, bestGK, gks, leaders };
}

/**
 * Balance part of the cost, in "rating points": for every attribute, the mean
 * absolute deviation of each team's per-player average from the group average,
 * summed over teams, weighted, and divided by the total weight.
 *
 * Comparing per-player averages (rather than raw sums) keeps odd splits
 * (6 vs 5) meaningful: it equals padding the short team with one "average"
 * phantom player. For goalkeeping we compare the best keeper of each team.
 * For two teams this is exactly the weighted gap between the teams.
 */
function balanceCost(pr: Problem, ag: Aggregates): number {
  const { k, weights } = pr;
  let total = 0;
  for (let a = 0; a < NA; a++) {
    const w = weights[a];
    if (w === 0) continue;
    let dev = 0;
    if (a === GK_IDX) {
      let mean = 0;
      for (let t = 0; t < k; t++) mean += ag.bestGK[t] / k;
      for (let t = 0; t < k; t++) dev += Math.abs(ag.bestGK[t] - mean);
    } else {
      const m = pr.groupMean[a];
      for (let t = 0; t < k; t++) {
        const avg = ag.sizes[t] ? ag.sums[t * NA + a] / ag.sizes[t] : 0;
        dev += Math.abs(avg - m);
      }
    }
    total += w * dev;
  }
  return total / pr.weightSum;
}

/** Teams lacking X beyond what is unavoidable given how many X exist. */
function missingBeyondUnavoidable(perTeam: number[], available: number): number {
  const missing = perTeam.filter((c) => c === 0).length;
  const unavoidable = Math.max(0, perTeam.length - available);
  return Math.max(0, missing - unavoidable);
}

function sizeDeviation(pr: Problem, sizes: number[]): number {
  const sorted = [...sizes].sort((x, y) => y - x);
  return sorted.reduce((s, v, i) => s + Math.abs(v - pr.targetSizes[i]), 0);
}

/** Fast scalar cost used inside the search. */
export function cost(pr: Problem, asg: Assignment): number {
  const ag = aggregate(pr, asg);
  const o = pr.options;
  let c = balanceCost(pr, ag);
  c += o.sizePenalty * sizeDeviation(pr, ag.sizes);
  c += o.gkPenalty * missingBeyondUnavoidable(ag.gks, pr.gkCount);
  c += o.leaderPenalty * missingBeyondUnavoidable(ag.leaders, pr.leaderCount);
  for (const [a, b] of pr.together) if (asg[a] !== asg[b]) c += o.constraintPenalty;
  for (const [a, b] of pr.apart) if (asg[a] === asg[b]) c += o.constraintPenalty;
  return c;
}

/** Map a cost (rating points) to a 0–100 "fairness" score. */
export function scoreFromCost(c: number): number {
  return Math.round(100 * Math.exp(-c * 0.5));
}

/** Full, human-oriented evaluation of an assignment. */
export function evaluate(
  players: Player[],
  asg: Assignment,
  k: number,
  options: EngineOptions,
  constraints: Constraints = { together: [], apart: [] },
): Evaluation {
  const pr = buildProblem(players, k, options, constraints);
  const ag = aggregate(pr, asg);
  const o = options;
  const teams: TeamStats[] = Array.from({ length: k }, (_, t) => {
    const totals = {} as Attributes;
    let strength = 0;
    ATTR_KEYS.forEach((key, a) => {
      totals[key] = ag.sums[t * NA + a];
      strength += pr.weights[a] * ag.sums[t * NA + a];
    });
    return { size: ag.sizes[t], totals, strength, goalkeepers: ag.gks[t], leaders: ag.leaders[t] };
  });
  const byId = (i: number) => players[i].id;
  const together = pr.together.filter(([a, b]) => asg[a] !== asg[b]).map(([a, b]) => [byId(a), byId(b)] as Pair);
  const apart = pr.apart.filter(([a, b]) => asg[a] === asg[b]).map(([a, b]) => [byId(a), byId(b)] as Pair);
  const bal = balanceCost(pr, ag);
  const penalties = {
    size: o.sizePenalty * sizeDeviation(pr, ag.sizes),
    goalkeeper: o.gkPenalty * missingBeyondUnavoidable(ag.gks, pr.gkCount),
    leadership: o.leaderPenalty * missingBeyondUnavoidable(ag.leaders, pr.leaderCount),
    constraints: o.constraintPenalty * (together.length + apart.length),
  };
  const total = bal + penalties.size + penalties.goalkeeper + penalties.leadership + penalties.constraints;
  return {
    cost: total,
    balanceCost: bal,
    penalties,
    violations: { together, apart },
    teams,
    score: scoreFromCost(total),
  };
}

// Exposed for tests / UI.
export { GK_IDX, NA };
