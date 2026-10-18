import { buildProblem, cost, scoreFromCost } from './cost';
import type { Constraints, EngineOptions, Player } from './types';

/**
 * Borrowing from the losing team: a short team comes on and "borrows" players
 * from the team that just lost, for one match. Which of them should come over?
 * The one(s) that make the next match as even as possible: the short team plus
 * borrowers against the team that stayed, compared with the engine's balance
 * notion (weighted gap between per-player attribute averages, in rating points).
 */

export interface BorrowPick {
  /** Indices into `donors`, ascending. */
  picks: number[];
  /** Rating-point gap of the next match (+ rule penalties). Lower is better. */
  cost: number;
  /** 0–100, same scale as the teams screen. */
  score: number;
}

export interface BorrowInput {
  /** The short team's own players. */
  short: Player[];
  /** The team that just lost (borrowers come from here). */
  donors: Player[];
  /** The team the short team will face. */
  opponent: Player[];
  /** How many players to borrow. */
  need: number;
  options: EngineOptions;
  constraints: Constraints;
}

/**
 * Cost of one particular choice of borrowers. Only balance and pair rules
 * count: the goalkeeper and leader rules are about the split, not one match,
 * and would otherwise outweigh "as even as possible".
 */
export function borrowCost(input: BorrowInput, picks: number[]): number {
  const { short, donors, opponent, options, constraints } = input;
  const chosen = picks.map((i) => donors[i]);
  const lineup = [...short, ...chosen];
  const players = [...lineup, ...opponent];
  const asg = players.map((_, i) => (i < lineup.length ? 0 : 1));
  const sizes = [lineup.length, opponent.length].sort((a, b) => b - a);
  const opts: EngineOptions = { ...options, gkPenalty: 0, leaderPenalty: 0 };
  let c = cost(buildProblem(players, 2, opts, { together: [], apart: [] }, sizes), asg);
  // Pair rules: keep-apart inside the new lineup; keep-together split by borrowing one of a pair.
  const inLineup = new Set(lineup.map((p) => p.id));
  const borrowed = new Set(chosen.map((p) => p.id));
  const leftBehind = new Set(donors.filter((p) => !borrowed.has(p.id)).map((p) => p.id));
  for (const [x, y] of constraints.apart) if (inLineup.has(x) && inLineup.has(y) && (borrowed.has(x) || borrowed.has(y))) c += options.constraintPenalty;
  for (const [x, y] of constraints.together)
    if ((borrowed.has(x) && leftBehind.has(y)) || (borrowed.has(y) && leftBehind.has(x))) c += options.constraintPenalty;
  return c;
}

/** All index combinations of size `r` from 0..n-1, in lexicographic order. */
function* combinations(n: number, r: number): Generator<number[]> {
  if (r <= 0 || r > n) return;
  const idx = Array.from({ length: r }, (_, i) => i);
  while (true) {
    yield [...idx];
    let i = r - 1;
    while (i >= 0 && idx[i] === n - r + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < r; j++) idx[j] = idx[j - 1] + 1;
  }
}

/**
 * The best borrowers: tries every combination (a team has ≤ 11 players and
 * ≤ 2 are borrowed, so at most 55). Ties keep the earliest combination in donor
 * order, so the suggestion is deterministic. Null if nobody needs borrowing.
 */
export function suggestBorrowers(input: BorrowInput): BorrowPick | null {
  const need = Math.min(input.need, input.donors.length);
  if (need <= 0) return null;
  let best: BorrowPick | null = null;
  for (const picks of combinations(input.donors.length, need)) {
    const c = borrowCost(input, picks);
    if (!best || c < best.cost - 1e-9) best = { picks, cost: c, score: scoreFromCost(c) };
  }
  return best;
}
