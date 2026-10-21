// Players in a cloud group (DECISIONS → "Players, live evening, rating permission — server (v10)").
// A member is an 'organizer' (sees and edits everything) or a 'player' (read-only, never sees
// ratings). Players join with the group's one player link, claim who they are in the roster, and
// may be allowed to rate other players. Pure parsing/merging helpers are unit-tested; playersApi()
// wraps the RPCs.
import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeHistory, type EveningRecord } from '../state/history';
import type { Player } from '../state/model';
import type { Position } from '../engine';
import { sanitizePositions } from '../state/positions';
import { attrsAtLevel, averageLevel, sanitizeVotes, type LevelVotes } from '../state/votes';
import { fail } from './supabase';

export type MemberRole = 'organizer' | 'player';

/** A row of group_members_list(): organizers get everyone, a player only himself. */
export interface Member {
  userId: string;
  name: string;
  role: MemberRole;
  /** Roster id he said is him (null = not claimed yet). */
  playerId: string | null;
  canRate: boolean;
  joinedAt: string;
  isMe: boolean;
}

export interface PublicPlayer {
  id: string;
  name: string;
  positions?: Position[];
  canGK?: boolean;
}

/** What a player may see of a group (group_public_get). Never any rating. */
export interface PublicGroup {
  groupId: string;
  name: string;
  /** Positions and "good in goal" are shown to players (the organizer's "strong in"); never a rating. */
  players: PublicPlayer[];
  history: EveningRecord[];
  /** Roster ids already claimed by some login (grey them out in "who are you?"). */
  claimed: string[];
  me: { role: MemberRole; playerId: string | null; canRate: boolean };
  updatedAt: string;
}

/** A player's vote, as organizers read it (group_votes): only from players who may rate now. */
export interface VoteRow {
  rater: string;
  playerId: string;
  level: number;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const role = (v: unknown): MemberRole => (v === 'organizer' ? 'organizer' : 'player');
const isLevel = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10;

export function parseMembers(rows: unknown): Member[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(obj)
    .filter((r) => typeof r.user_id === 'string')
    .map((r) => ({
      userId: r.user_id as string,
      name: str(r.display_name).trim().slice(0, 40) || (r.role === 'organizer' ? 'מארגן/ת' : 'שחקן/ית'),
      role: role(r.role),
      playerId: typeof r.player_id === 'string' && r.player_id ? r.player_id : null,
      canRate: r.can_rate === true,
      joinedAt: str(r.joined_at),
      isMe: r.is_me === true,
    }));
}

/** group_public_get() → PublicGroup; null when the group has no public copy (or garbage). */
export function parsePublic(raw: unknown): PublicGroup | null {
  const r = obj(raw);
  if (typeof r.groupId !== 'string') return null;
  const me = obj(r.me);
  const players = (Array.isArray(r.players) ? r.players : [])
    .map(obj)
    .filter((p) => typeof p.id === 'string' && typeof p.name === 'string' && (p.name as string).trim())
    .map((p) => {
      const positions = sanitizePositions(p.positions);
      return { id: p.id as string, name: p.name as string, ...(positions.length ? { positions } : {}), ...(p.canGK === true ? { canGK: true } : {}) };
    });
  return {
    groupId: r.groupId,
    name: str(r.name),
    players,
    history: sanitizeHistory(r.history),
    claimed: (Array.isArray(r.claimed) ? r.claimed : []).filter((x): x is string => typeof x === 'string'),
    me: { role: role(me.role), playerId: typeof me.playerId === 'string' ? me.playerId : null, canRate: me.canRate === true },
    updatedAt: str(r.updatedAt),
  };
}

/** my_votes() / submit_votes() → { playerId: level }. */
export function parseMyVotes(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(raw))) if (isLevel(v)) out[k] = v;
  return out;
}

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
 * Organizer app: the roster with every voted player's level = average of organizers' and players'
 * votes (attributes rebuilt like a level change; hand-tuned sliders keep their tuning). Players'
 * votes are NOT written into `levelVotes` (that stays organizers only); only the level moves.
 * Returns the same array when nothing changes.
 */
export function applyPlayerVotes(players: Player[], rows: VoteRow[]): Player[] {
  let changed = false;
  const out = players.map((p) => {
    const avg = averageLevel(mergePlayerVotes(p.levelVotes, rows, p.id));
    if (avg === null || avg === p.attrs.overall) return p;
    changed = true;
    return { ...p, attrs: attrsAtLevel(p.attrs, p.cards, avg) };
  });
  return changed ? out : players;
}

/** Roster players a rater may rate: everyone but himself. */
export const rateable = (players: { id: string; name: string }[], me: string | null) => players.filter((p) => p.id !== me);

export function playersApi(sb: SupabaseClient) {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) fail(error);
    return data as unknown;
  };
  return {
    /** Organizers: the group's one player link (made on first call, then the same until revoked). */
    async createPlayerInvite(groupId: string): Promise<string> {
      return (await rpc('create_player_invite', { p_group_id: groupId })) as string;
    },
    /** Organizers: the live player link, or null (without creating one). Revoke with remoteApi.revokeInvite. */
    async playerInvite(groupId: string): Promise<string | null> {
      const { data, error } = await sb
        .from('group_invites')
        .select('token')
        .eq('group_id', groupId)
        .eq('role', 'player')
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) fail(error);
      const row = Array.isArray(data) ? (data[0] as { token?: unknown } | undefined) : undefined;
      return typeof row?.token === 'string' ? row.token : null;
    },
    /** "This is me". SyncError 'taken' if someone else has him (or you already claimed another). */
    async claimPlayer(groupId: string, playerId: string): Promise<void> {
      await rpc('claim_player', { p_group_id: groupId, p_player_id: playerId });
    },
    /** Organizers: undo a wrong claim. */
    async unclaimPlayer(groupId: string, userId: string): Promise<void> {
      await rpc('unclaim_player', { p_group_id: groupId, p_user_id: userId });
    },
    /** Organizers: allow a player to rate, or not (taking it away deletes his votes). */
    async setCanRate(groupId: string, userId: string, can: boolean): Promise<void> {
      await rpc('set_can_rate', { p_group_id: groupId, p_user_id: userId, p_can: can });
    },
    /** Organizers: remove a player member (his votes go with him). */
    async removePlayer(groupId: string, userId: string): Promise<void> {
      await rpc('remove_player', { p_group_id: groupId, p_user_id: userId });
    },
    async listMembers(groupId: string): Promise<Member[]> {
      return parseMembers(await rpc('group_members_list', { p_group_id: groupId }));
    },
    /** Any member: roster names, history, who is claimed, and my own membership. */
    async getPublic(groupId: string): Promise<PublicGroup | null> {
      return parsePublic(await rpc('group_public_get', { p_group_id: groupId }));
    },
    async myVotes(groupId: string): Promise<Record<string, number>> {
      return parseMyVotes(await rpc('my_votes', { p_group_id: groupId }));
    },
    /** Players who may rate: { playerId: 1–10, or null to take a vote back }. Returns all my votes. */
    async submitVotes(groupId: string, votes: Record<string, number | null>): Promise<Record<string, number>> {
      return parseMyVotes(await rpc('submit_votes', { p_group_id: groupId, p_votes: votes }));
    },
    /** Organizers: players' votes that count (see mergePlayerVotes / applyPlayerVotes). */
    async groupVotes(groupId: string): Promise<VoteRow[]> {
      return parseVoteRows(await rpc('group_votes', { p_group_id: groupId }));
    },
    /** Called when the group's public copy changes (roster/history edits). Returns unsubscribe. */
    subscribePublic(groupId: string, onChange: () => void): () => void {
      const ch = sb
        .channel(`public-${groupId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'group_public', filter: `group_id=eq.${groupId}` }, () => onChange())
        .subscribe();
      return () => void sb.removeChannel(ch);
    },
  };
}
