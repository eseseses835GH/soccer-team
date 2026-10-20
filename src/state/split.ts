import { createRng, shuffle, type Assignment, type Constraints, type Rng } from '../engine';
import type { GkMode, Player } from './model';

/** Relabel teams so team 0 is the largest (ties keep first-appearance order): full teams start, a short team waits. */
export function orderBySize(asg: Assignment, k: number): Assignment {
  const counts = new Array<number>(k).fill(0);
  const first = new Array<number>(k).fill(Infinity);
  asg.forEach((t, i) => {
    counts[t]++;
    first[t] = Math.min(first[t], i);
  });
  const order = Array.from({ length: k }, (_, t) => t).sort((a, b) => counts[b] - counts[a] || first[a] - first[b]);
  const map = new Array<number>(k);
  order.forEach((t, newLabel) => (map[t] = newLabel));
  return asg.map((t) => map[t]);
}

/**
 * Pick substitutes at random, preferring players without keep-together/apart
 * rules (so the rules still apply on the teams).
 */
export function pickSubs(present: Player[], count: number, constraints: Constraints, rng: Rng): string[] {
  if (count <= 0) return [];
  const constrained = new Set([...constraints.together, ...constraints.apart].flat());
  const free = shuffle(rng, present.filter((p) => !constrained.has(p.id)).map((p) => p.id));
  const rest = shuffle(rng, present.filter((p) => constrained.has(p.id)).map((p) => p.id));
  return [...free, ...rest].slice(0, count);
}

/**
 * Keeper order for one team: random. In "fixed" mode declared keepers go first. When keepers
 * rotate, the order is plain random: 🧤 means "good in goal", not "wants to stand in goal" (v7).
 */
export function keeperOrder(members: Player[], mode: GkMode, rng: Rng): string[] {
  const ids = shuffle(rng, members.map((p) => p.id));
  if (mode !== 'fixed') return ids;
  const gk = new Set(members.filter((p) => p.canGK).map((p) => p.id));
  return [...ids.filter((id) => gk.has(id)), ...ids.filter((id) => !gk.has(id))];
}

export function keeperOrders(playerIds: string[], asg: Assignment, k: number, byId: Map<string, Player>, mode: GkMode, seed: number): string[][] {
  const rng = createRng(seed);
  return Array.from({ length: k }, (_, t) => {
    const members = playerIds.filter((_, i) => asg[i] === t).map((id) => byId.get(id)!).filter(Boolean);
    return keeperOrder(members, mode, rng);
  });
}
