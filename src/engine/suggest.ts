import { buildProblem, cost, type Problem } from './cost';
import type { Assignment, Constraints, EngineOptions, Player } from './types';

export interface SwapSuggestion {
  swaps: [number, number][];
  assignment: Assignment;
  before: number;
  after: number;
}

function swapCost(pr: Problem, asg: Assignment, i: number, j: number): number {
  const t = asg[i];
  asg[i] = asg[j];
  asg[j] = t;
  const c = cost(pr, asg);
  asg[j] = asg[i];
  asg[i] = t;
  return c;
}

/**
 * Up to `maxSwaps` best-improvement swaps from the current split. Used when a
 * late arrival completes a team: fix the balance with a couple of changes
 * instead of reshuffling everyone. Returns null if nothing improves by `minGain`.
 */
export function suggestSwaps(
  players: Player[],
  assignment: Assignment,
  k: number,
  options: EngineOptions,
  constraints: Constraints,
  sizes?: number[],
  { maxSwaps = 2, minGain = 0.03 } = {},
): SwapSuggestion | null {
  const pr = buildProblem(players, k, options, constraints, sizes);
  const asg = [...assignment];
  const before = cost(pr, asg);
  let cur = before;
  const swaps: [number, number][] = [];
  for (let s = 0; s < maxSwaps; s++) {
    let best: [number, number] | null = null;
    let bestCost = cur - minGain;
    for (let i = 0; i < asg.length; i++)
      for (let j = i + 1; j < asg.length; j++) {
        if (asg[i] === asg[j]) continue;
        const c = swapCost(pr, asg, i, j);
        if (c < bestCost) {
          bestCost = c;
          best = [i, j];
        }
      }
    if (!best) break;
    const [i, j] = best;
    [asg[i], asg[j]] = [asg[j], asg[i]];
    cur = bestCost;
    swaps.push(best);
  }
  return swaps.length ? { swaps, assignment: asg, before, after: cur } : null;
}

/**
 * One swap that weakens `team` (it keeps winning) while keeping the overall
 * balance as good as possible. Null if no swap weakens it.
 */
export function suggestWeakeningSwap(
  players: Player[],
  assignment: Assignment,
  k: number,
  team: number,
  options: EngineOptions,
  constraints: Constraints,
  sizes?: number[],
): SwapSuggestion | null {
  const pr = buildProblem(players, k, options, constraints, sizes);
  const asg = [...assignment];
  const before = cost(pr, asg);
  const na = pr.weights.length;
  const strength = (i: number) => {
    let s = 0;
    for (let a = 0; a < na; a++) s += pr.weights[a] * pr.vals[i * na + a];
    return s;
  };
  let best: [number, number] | null = null;
  let bestCost = Infinity;
  for (let i = 0; i < asg.length; i++) {
    if (asg[i] !== team) continue;
    for (let j = 0; j < asg.length; j++) {
      if (asg[j] === team || strength(j) >= strength(i)) continue;
      const c = swapCost(pr, asg, i, j);
      if (c < bestCost) {
        bestCost = c;
        best = [i, j];
      }
    }
  }
  if (!best) return null;
  const [i, j] = best;
  [asg[i], asg[j]] = [asg[j], asg[i]];
  return { swaps: [best], assignment: asg, before, after: bestCost };
}
