import { MAX_TEAMS, createRng, shuffle } from '../engine';
import type { GameResult } from './model';

export type LateOutcome =
  /** Joined the short team outside, which is still short. */
  | 'waiting'
  /** Completed a team to full size: worth suggesting a swap or two. */
  | 'filled'
  /** No room: waits as a substitute. */
  | 'bench'
  /** Substitutes outside are now enough to form a (short) team. */
  | 'newTeam';

export interface LateJoin {
  result: GameResult;
  outcome: LateOutcome;
  team: number | null;
}

/**
 * A late arrival never reshuffles everyone. They join the smallest team that
 * isn't full yet (the short one waiting outside), otherwise they wait as a
 * substitute; once the substitutes are close to a full team (missing ≤ 2,
 * same rule as the initial format), they become a new team.
 */
export function lateJoin(r: GameResult, id: string, seed: number): LateJoin {
  if (r.playerIds.includes(id) || r.subIds.includes(id)) return { result: r, outcome: 'bench', team: null };
  const counts = new Array<number>(r.numTeams).fill(0);
  r.assignment.forEach((t) => counts[t]++);
  const base = { ...r, pool: [], shown: [] as number[][] };

  let target = -1;
  for (let t = r.numTeams - 1; t >= 0; t--) {
    if (counts[t] < r.teamSize && (target < 0 || counts[t] < counts[target])) target = t;
  }
  if (target >= 0) {
    const assignment = [...r.assignment, target];
    const gkOrder = r.gkOrder.map((l, t) => (t === target ? [...l, id] : l));
    counts[target]++;
    // "Filled" = no team is short any more: that's when a swap or two is worth checking.
    const filled = counts.every((c) => c >= r.teamSize);
    return {
      result: { ...base, playerIds: [...r.playerIds, id], assignment, generated: assignment, gkOrder },
      outcome: filled ? 'filled' : 'waiting',
      team: target,
    };
  }

  const subIds = [...r.subIds, id];
  const threshold = Math.max(2, r.teamSize - 2);
  if (subIds.length >= threshold && r.numTeams < MAX_TEAMS) {
    const t = r.numTeams;
    const assignment = [...r.assignment, ...subIds.map(() => t)];
    const gkOrder = [...r.gkOrder, shuffle(createRng(seed), [...subIds])];
    return {
      result: {
        ...base,
        playerIds: [...r.playerIds, ...subIds],
        subIds: [],
        numTeams: t + 1,
        sizes: [...r.sizes, subIds.length],
        assignment,
        generated: assignment,
        gkOrder,
      },
      outcome: subIds.length === r.teamSize ? 'filled' : 'newTeam',
      team: t,
    };
  }
  return { result: { ...base, subIds }, outcome: 'bench', team: null };
}
