// Pure organizer-side helpers (v10), unit-tested: the "שחקנים שהתחברו" list and folding players'
// votes into the roster.
import { eveningId } from '../state/history';
import type { AppState } from '../state/model';
import { applyPlayerVotes, type Member, type VoteRow } from './players';

/** Fold players' votes into the roster; the very same state when no level changes (so no sync loop). */
export function withPlayerVotes(s: AppState, rows: VoteRow[]): AppState {
  const players = applyPlayerVotes(s.players, rows);
  return players === s.players ? s : { ...s, players };
}

export interface PlayerMemberRow {
  userId: string;
  name: string;
  /** Roster name he claimed; null = hasn't picked yet (or picked someone since deleted). */
  claimed: string | null;
  /** He has a claim to undo (even if that roster player was deleted). */
  canUnclaim: boolean;
  canRate: boolean;
}

/** Player members only (organizers have their own list), oldest first. Empty → the section is hidden. */
export function playerMemberRows(members: Member[], roster: { id: string; name: string }[]): PlayerMemberRow[] {
  return members
    .filter((m) => m.role === 'player')
    .sort((a, b) => (Date.parse(a.joinedAt) || 0) - (Date.parse(b.joinedAt) || 0))
    .map((m) => ({
      userId: m.userId,
      name: m.name,
      claimed: (m.playerId && roster.find((p) => p.id === m.playerId)?.name) || null,
      canUnclaim: !!m.playerId,
      canRate: m.canRate,
    }));
}

/**
 * "סיום הערב" keeps the teams on screen but the evening is over, so nothing is live: no match, and
 * either this evening is in the history or it was ended without anything to save (`endedId`, the
 * eveningId this phone remembered when it saw the match go away with the same teams).
 */
export function eveningEnded(s: Pick<AppState, 'result' | 'match' | 'history'>, endedId: string | null): boolean {
  if (!s.result || s.match) return false;
  const id = eveningId(s.result);
  return id === endedId || s.history.some((h) => h.id === id);
}

/** The match went away while the teams stayed: only "סיום הערב" does that. */
export const justEnded = (prev: Pick<AppState, 'result' | 'match'>, next: Pick<AppState, 'result' | 'match'>) =>
  !!prev.match && !next.match && !!next.result && prev.result === next.result;
