// Players' votes and who may rate: pure, shared by the organizer app (sync/players.ts re-exports it)
// and the split-teams edge function (src/server), which must compute levels exactly like the app.
import type { Player } from './model';
import { applyCards } from './cards';
import { attrsAtLevel, ratedLevel, sanitizeVotes, type LevelVotes } from './votes';

export type MemberRole = 'organizer' | 'player';

/** Who rates in a group (v18): only players the organizer allowed, or every player who joined. */
export type RatingMode = 'organizers' | 'everyone';
export const parseRatingMode = (v: unknown): RatingMode => (v === 'everyone' ? 'everyone' : 'organizers');

/**
 * May this member rate (mirrors the server's private.can_rate_eff): players only; an organizer's
 * explicit switch (true/false) wins, otherwise the group's mode decides. Claiming who you are is
 * still needed to actually send votes.
 */
export const effectiveCanRate = (memberRole: MemberRole, override: boolean | null, mode: RatingMode) =>
  memberRole === 'player' && (override ?? mode === 'everyone');

/** A player's vote, as organizers read it (group_votes): only from players who may rate now. */
export interface VoteRow {
  rater: string;
  playerId: string;
  level: number;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const isLevel = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10;

export function parseVoteRows(rows: unknown): VoteRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(obj)
    .filter((r) => typeof r.rater === 'string' && typeof r.player_id === 'string' && isLevel(r.level))
    .map((r) => ({ rater: (r.rater as string).toLowerCase(), playerId: r.player_id as string, level: r.level as number }));
}

/**
 * One player's votes: the organizers' (from the doc, v9) plus the players' (rows), keyed by auth
 * user id, so each counts once in the average. If the same user is in both (a player who became
 * organizer), the doc wins. undefined = nobody voted.
 */
export function mergePlayerVotes(levelVotes: LevelVotes | undefined, rows: VoteRow[], playerId: string): LevelVotes | undefined {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.playerId === playerId) out[r.rater] = r.level;
  Object.assign(out, levelVotes ?? {});
  return sanitizeVotes(out);
}

/**
 * The level one player's votes give (v18): everyone's average once MIN_RATERS logins voted on him,
 * else the organizers' (doc) average; null = keep his level.
 */
export function levelFromVotes(levelVotes: LevelVotes | undefined, rows: VoteRow[], playerId: string): number | null {
  return ratedLevel(mergePlayerVotes(levelVotes, rows, playerId), levelVotes);
}

/**
 * A level tap in the edit sheet (and the quick rating after an import): logged out / local, the
 * level itself; in a synced group the organizer's vote, and the level is the average with everyone's
 * votes. Attributes are rebuilt from level + cards.
 */
export function playerAtLevel(p: Player, level: number, voter: string | null, rows: VoteRow[]): Player {
  if (!voter) return { ...p, attrs: applyCards(level, p.cards) };
  const levelVotes = { ...p.levelVotes, [voter]: level };
  return { ...p, levelVotes, attrs: applyCards(levelFromVotes(levelVotes, rows, p.id) ?? level, p.cards) };
}

/**
 * Organizer app: the roster with every voted player's level = levelFromVotes (everyone's average
 * from MIN_RATERS voters, else the organizers') (attributes rebuilt like a level change; hand-tuned sliders keep their tuning). Players'
 * votes are NOT written into `levelVotes` (that stays organizers only); only the level moves.
 * Returns the same array when nothing changes.
 */
export function applyPlayerVotes(players: Player[], rows: VoteRow[]): Player[] {
  let changed = false;
  const out = players.map((p) => {
    const avg = levelFromVotes(p.levelVotes, rows, p.id);
    if (avg === null || avg === p.attrs.overall) return p;
    changed = true;
    return { ...p, attrs: attrsAtLevel(p.attrs, p.cards, avg) };
  });
  return changed ? out : players;
}
