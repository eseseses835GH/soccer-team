// How teams are made from tonight's attendance. Pure and shared: the organizer's app runs it with the
// search in a web worker (ui/split.ts), the split-teams edge function runs it on the server for a
// player's phone, which never gets anyone's level (DECISIONS → "Players start an evening (v20)").
import { ATTR_KEYS, createRng, planFormat, type Assignment, type Constraints, type FormatPlan, type Weights } from '../engine';
import { engineOptions, type Player, type Settings } from './model';
import { keeperOrders, orderBySize, pickSubs } from './split';

export interface SplitSource {
  players: Player[];
  presentIds: string[];
  teamSize: number;
  settings: Settings;
  constraints: Constraints;
}

export interface SplitPrep {
  plan: FormatPlan;
  subIds: string[];
  onTeams: Player[];
  /** What the search gets (worker or inline). */
  req: { players: Player[]; k: number; options: ReturnType<typeof engineOptions>; constraints: Constraints; seed: number; sizes: number[] };
}

export interface SplitTeams {
  playerIds: string[];
  subIds: string[];
  sizes: number[];
  teamSize: number;
  assignment: Assignment;
  gkOrder: string[][];
}

/** Who plays and who sits out (random subs, seeded); null when there aren't enough players. */
export function prepareSplit(src: SplitSource, seed: number): SplitPrep | null {
  const present = new Set(src.presentIds);
  const players = src.players.filter((p) => present.has(p.id));
  const plan = planFormat(players.length, src.teamSize);
  if (!plan) return null;
  const subIds = pickSubs(players, plan.subs, src.constraints, createRng(seed));
  const sub = new Set(subIds);
  const onTeams = players.filter((p) => !sub.has(p.id));
  return {
    plan,
    subIds,
    onTeams,
    req: { players: onTeams, k: plan.sizes.length, options: engineOptions(src.settings), constraints: src.constraints, seed, sizes: plan.sizes },
  };
}

/** The teams of an assignment the search found: full teams first, keeper order per team (seed + 1). */
export function finishSplit(src: SplitSource, prep: SplitPrep, asg: Assignment, seed: number): SplitTeams {
  const k = prep.plan.sizes.length;
  const assignment = orderBySize(asg, k);
  const playerIds = prep.onTeams.map((p) => p.id);
  const byId = new Map(src.players.map((p) => [p.id, p]));
  return {
    playerIds,
    subIds: prep.subIds,
    sizes: prep.plan.sizes,
    teamSize: src.teamSize,
    assignment,
    gkOrder: keeperOrders(playerIds, assignment, k, byId, src.settings.gkMode, seed + 1),
  };
}

/** A player's strength as one number: his attributes weighted like the balance (a weighted level, 1–10). */
export function playerStrength(p: Player, w: Weights): number {
  let sum = 0;
  let ws = 0;
  for (const k of ATTR_KEYS) {
    sum += w[k] * p.attrs[k];
    ws += w[k];
  }
  return ws > 0 ? sum / ws : p.attrs.overall;
}

/**
 * One number per team: the sum of its players' weighted levels, rounded ("40 מול 39"). The only
 * strength a player's phone ever sees — never anyone's own number.
 */
export function teamTotals(playerIds: string[], assignment: Assignment, k: number, players: Player[], w: Weights): number[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const sums = new Array<number>(k).fill(0);
  playerIds.forEach((id, i) => {
    const p = byId.get(id);
    if (p && assignment[i] >= 0 && assignment[i] < k) sums[assignment[i]] += playerStrength(p, w);
  });
  return sums.map((s) => Math.round(s));
}
