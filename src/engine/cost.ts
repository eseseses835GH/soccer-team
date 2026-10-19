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
  POSITIONS,
} from './types';
import { teamSizes } from './sizes';

const NA = ATTR_KEYS.length;
const NP = POSITIONS.length;

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
  /** n * NP: each player adds 1/len(positions) to each of his positions. */
  pos: Float64Array;
  /** Per position: total over all players. */
  posTotal: Float64Array;
  /** Per position: deviation no split of whole players can avoid (subtracted, so odd counts don't drag the score down). */
  posFloor: Float64Array;
  /** Anyone has a position and the rule is on (otherwise the term is skipped entirely). */
  usePos: boolean;
  options: EngineOptions;
}

export function buildProblem(
  players: Player[],
  k: number,
  options: EngineOptions,
  constraints: Constraints = { together: [], apart: [] },
  sizes?: number[],
): Problem {
  const n = players.length;
  if (sizes && (sizes.length !== k || sizes.reduce((a, b) => a + b, 0) !== n)) {
    throw new Error('sizes must have k entries summing to the number of players');
  }
  const vals = new Float64Array(n * NA);
  const canGK = new Uint8Array(n);
  const isLeader = new Uint8Array(n);
  const groupMean = new Float64Array(NA);
  const pos = new Float64Array(n * NP);
  const posTotal = new Float64Array(NP);
  players.forEach((p, i) => {
    ATTR_KEYS.forEach((key, a) => {
      const v = clampRating(p.attrs[key]);
      vals[i * NA + a] = v;
      groupMean[a] += v / Math.max(1, n);
    });
    canGK[i] = p.canGK ? 1 : 0;
    isLeader[i] = clampRating(p.attrs.leadership) >= options.leadershipThreshold ? 1 : 0;
    const own = POSITIONS.map((_, q) => q).filter((q) => p.positions?.includes(POSITIONS[q]));
    for (const q of own) {
      pos[i * NP + q] = 1 / own.length;
      posTotal[q] += 1 / own.length;
    }
  });
  const targetSizes = sizes ? [...sizes].sort((a, b) => b - a) : teamSizes(n, k);
  const posFloor = new Float64Array(NP);
  for (let q = 0; q < NP; q++) posFloor[q] = unavoidableSpread(posTotal[q], targetSizes, n);
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
    targetSizes,
    groupMean,
    pos,
    posTotal,
    posFloor,
    usePos: options.positionWeight > 0 && posTotal.some((v) => v > 0),
    options,
  };
}

/**
 * Σ_t |count_t − share_t| for one position that no split of whole players can avoid: round each
 * share down or up, giving the "ups" to the teams with the largest remainders. Exact when everyone
 * has one position. Players with several positions (½, ⅓) can sometimes do better; the spread is
 * then clamped at 0, i.e. anything at least as even as the best whole-player split is free.
 */
function unavoidableSpread(total: number, sizes: number[], n: number): number {
  if (total <= 0 || n === 0) return 0;
  const shares = sizes.map((s) => (total * s) / n);
  const floors = shares.map((s) => Math.floor(s + 1e-9));
  const fracs = shares.map((s, t) => s - floors[t]).sort((a, b) => b - a);
  const ups = Math.round(total) - floors.reduce((a, b) => a + b, 0);
  return fracs.reduce((sum, f, i) => sum + (i < ups ? 1 - f : f), 0);
}

function clampRating(v: number | undefined): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return 5;
  return Math.min(10, Math.max(1, v));
}

interface Aggregates {
  sizes: number[];
  sums: Float64Array; // k * NA
  gks: number[];
  leaders: number[];
  /** k * NP, only filled when the position rule is on. */
  pos: Float64Array;
}

function aggregate(pr: Problem, asg: Assignment): Aggregates {
  const { k, n, vals } = pr;
  const sizes = new Array<number>(k).fill(0);
  const gks = new Array<number>(k).fill(0);
  const leaders = new Array<number>(k).fill(0);
  const sums = new Float64Array(k * NA);
  const pos = new Float64Array(pr.usePos ? k * NP : 0);
  for (let i = 0; i < n; i++) {
    const t = asg[i];
    sizes[t]++;
    gks[t] += pr.canGK[i];
    leaders[t] += pr.isLeader[i];
    const row = i * NA;
    const off = t * NA;
    for (let a = 0; a < NA; a++) sums[off + a] += vals[row + a];
    if (pr.usePos) for (let q = 0; q < NP; q++) pos[t * NP + q] += pr.pos[i * NP + q];
  }
  return { sizes, sums, gks, leaders, pos };
}

/**
 * Position spread, in players: for each position, how far each team's count is from its fair
 * share (total × team size / players), summed, minus what no split can avoid. A player with
 * several positions counts as 1/len in each. 3 defenders in 5 v 5: 3/0 is 1.5 + 1.5 off, 2/1 is
 * the unavoidable 0.5 + 0.5, so 3/0 → 2 and 2/1 → 0.
 */
function positionSpread(pr: Problem, ag: Aggregates): number {
  if (!pr.usePos) return 0;
  let total = 0;
  for (let q = 0; q < NP; q++) {
    const all = pr.posTotal[q];
    if (all === 0) continue;
    let dev = 0;
    for (let t = 0; t < pr.k; t++) dev += Math.abs(ag.pos[t * NP + q] - (all * ag.sizes[t]) / pr.n);
    const extra = dev - pr.posFloor[q];
    if (extra > 1e-9) total += extra;
  }
  return total;
}

/**
 * Balance part of the cost, in "rating points": for every attribute, the mean
 * absolute deviation of each team's per-player average from the group average,
 * summed over teams, weighted, and divided by the total weight.
 *
 * Comparing per-player averages (rather than raw sums) keeps odd splits
 * (6 vs 5) meaningful: it equals padding the short team with one "average"
 * phantom player — which is exactly the pickup rule "the short team borrows
 * one from the losing team". For two teams this is exactly the weighted gap between the teams.
 */
function balanceCost(pr: Problem, ag: Aggregates): number {
  const { k, weights } = pr;
  let total = 0;
  for (let a = 0; a < NA; a++) {
    const w = weights[a];
    if (w === 0) continue;
    let dev = 0;
    const m = pr.groupMean[a];
    for (let t = 0; t < k; t++) {
      const avg = ag.sizes[t] ? ag.sums[t * NA + a] / ag.sizes[t] : 0;
      dev += Math.abs(avg - m);
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
  if (o.gkPenalty) c += o.gkPenalty * missingBeyondUnavoidable(ag.gks, pr.gkCount);
  c += o.leaderPenalty * missingBeyondUnavoidable(ag.leaders, pr.leaderCount);
  for (const [a, b] of pr.together) if (asg[a] !== asg[b]) c += o.constraintPenalty;
  for (const [a, b] of pr.apart) if (asg[a] === asg[b]) c += o.constraintPenalty;
  if (pr.usePos) c += o.positionWeight * positionSpread(pr, ag);
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
  sizes?: number[],
): Evaluation {
  const pr = buildProblem(players, k, options, constraints, sizes);
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
    positions: pr.usePos ? o.positionWeight * positionSpread(pr, ag) : 0,
  };
  const total = bal + penalties.size + penalties.goalkeeper + penalties.leadership + penalties.constraints + penalties.positions;
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
export { NA };
