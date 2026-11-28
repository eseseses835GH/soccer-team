import type { Borrow, MatchState } from '../match/match';
import { stampSides, teamMembers } from './history';
import type { GameResult } from './model';

/**
 * "עוברים אליהם": the players borrowed from the losing team move into the short team for the rest
 * of the evening (the usual choice at the pitch). They go last in its keeper rotation; the lender
 * becomes the short team and borrows in turn when it comes on. Matches already played keep who
 * played in their `sides` (stamped first, as when someone leaves), so this reads like a swap in the
 * history. The reducer then keeps whoever is in goal in goal (`holdKeepers`).
 */
export function moveBorrowers(r: GameResult, m: MatchState | null, b: Borrow): { result: GameResult; match: MatchState | null } {
  const from = new Set(teamMembers(r, b.from));
  const ids = [...new Set(b.ids)].filter((id) => from.has(id));
  if (!ids.length || b.team === b.from || b.team < 0 || b.team >= r.numTeams) return { result: r, match: m };
  const moving = new Set(ids);
  const gkOrder = Array.from({ length: r.numTeams }, (_, t) =>
    t === b.team ? [...teamMembers(r, t), ...ids] : t === b.from ? teamMembers(r, t).filter((id) => !moving.has(id)) : (r.gkOrder[t] ?? []),
  );
  const move = (asg: number[]) => asg.map((t, i) => (moving.has(r.playerIds[i]) ? b.team : t));
  const result: GameResult = { ...r, assignment: move(r.assignment), generated: move(r.generated), gkOrder, pool: [], shown: [] };
  // They're in the team now, not borrowed for this match.
  const match = m ? { ...stampSides(m, 0, r), borrow: null } : null;
  return { result, match };
}
