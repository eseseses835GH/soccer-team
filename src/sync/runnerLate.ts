// "מישהו הגיע?" / "מישהו עזב?" on a player runner's phone (DECISIONS → "Late and left for a player
// runner (v15)"). That phone has the roster's names and positions but no ratings (everyone is level
// 5 there), so nothing here ranks players: arrivals go to the smallest team, a sub after a leave is
// picked by hand. Pure: no React.
import { nowTarget } from '../state/late';
import type { Leave } from '../state/leave';
import type { GameResult, Player } from '../state/model';

/** Who can arrive: roster players not here tonight (by name), and the bench (subs, in bench order). */
export function arrivalChoices(players: Player[], r: GameResult): { roster: Player[]; bench: Player[] } {
  const byId = new Map(players.map((p) => [p.id, p]));
  const tonight = new Set([...r.playerIds, ...r.subIds]);
  return {
    roster: players.filter((p) => !tonight.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, 'he')),
    bench: r.subIds.map((id) => byId.get(id)).filter((p): p is Player => !!p),
  };
}

/** Where a sub goes "in now": the smallest team (never a new one; the bench stays the bench otherwise). */
export function benchTarget(r: GameResult): number {
  const t = nowTarget(r);
  if (t < r.numTeams) return t;
  const counts = new Array<number>(r.numTeams).fill(0);
  r.assignment.forEach((x) => counts[x]++);
  let best = r.numTeams - 1;
  for (let x = r.numTeams - 1; x >= 0; x--) if (counts[x] < counts[best]) best = x;
  return best;
}

/** After someone left a team that is now short: the subs to offer (bench order, none ranked). */
export function subsAfterLeave(l: Leave): string[] {
  if (l.outcome !== 'short' || l.team === null) return [];
  const t = l.team;
  const n = l.result.assignment.filter((x) => x === t).length;
  return n < l.result.teamSize ? [...l.result.subIds] : [];
}
