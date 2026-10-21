// A player's view of a group (DECISIONS → "Players and live evening — player side (v10)").
// Pure helpers; the React side is PlayerGroupProvider.tsx. A player group lives in the groups
// index with `role: 'player'` and never runs the organizer sync (sync/engine): its roster names
// and history come from group_public, the evening from group_live.
import { sanitizePlayer, type AppState, type Player } from '../state/model';
import type { KV } from '../state/groups';
import type { LiveData, LiveRow } from './live';
import { parsePublic, rateable, type PublicGroup } from './players';

/** A live row older than this is yesterday's evening that nobody ended: show nothing. */
export const LIVE_STALE_MS = 12 * 60 * 60 * 1000;

export const publicKey = (id: string) => `kochot:public:${id}`;

/** True when the organizer sync must not touch this group. */
export const isPlayerGroup = (meta: { role?: string } | undefined) => meta?.role === 'player';

/** The organizer sync (sync/engine) runs only for synced groups this phone organizes. */
export const runsOrganizerSync = (meta: { synced: boolean; role?: string } | undefined) => !!meta?.synced && !isPlayerGroup(meta);

/**
 * What opening an invite does on this phone, from join_group's role and the group as this phone
 * knows it: a player group (new, or replacing a group this phone had as organizer: its ratings
 * aren't his any more), switching to a known one, or the organizer path (`fresh` = take the
 * server's copy with nothing local, also when a player group became an organizer group).
 */
export function joinPlan(known: { role?: string } | undefined, role: 'organizer' | 'player'): 'player-new' | 'player-open' | 'organizer-fresh' | 'organizer-open' {
  if (role === 'player') return known && isPlayerGroup(known) ? 'player-open' : 'player-new';
  return known && !isPlayerGroup(known) ? 'organizer-open' : 'organizer-fresh';
}

export function loadPublic(kv: KV, id: string): PublicGroup | null {
  return parsePublic(kv.get(publicKey(id)));
}

/**
 * The public copy as this phone's state for the group, so the history screens work as they are.
 * Players get names only (default level, never shown); no teams or match (the evening is live).
 */
export function publicToState(prev: AppState, pub: PublicGroup): AppState {
  return {
    ...prev,
    players: pub.players.map((p) => sanitizePlayer({ id: p.id, name: p.name, positions: p.positions, canGK: p.canGK })).filter((p): p is Player => !!p),
    presentIds: [],
    lastPresentIds: [],
    result: null,
    match: null,
    constraints: { together: [], apart: [] },
    history: pub.history,
  };
}

/** The evening to show, or null: nothing published, the evening ended, or it's older than 12 h. */
export function liveNow(row: LiveRow | null, now: number): LiveData | null {
  if (!row) return null;
  const t = Date.parse(row.updatedAt);
  const at = Number.isFinite(t) ? t : row.data.at;
  if (!at || now - at > LIVE_STALE_MS) return null;
  return row.data;
}

/** "Who are you?": free names first (A–Z), then the taken ones (shown greyed). */
export function claimChoices(pub: PublicGroup): { id: string; name: string; taken: boolean }[] {
  const taken = new Set(pub.claimed.filter((id) => id !== pub.me.playerId));
  return pub.players
    .map((p) => ({ ...p, taken: taken.has(p.id) }))
    .sort((a, b) => Number(a.taken) - Number(b.taken) || a.name.localeCompare(b.name, 'he'));
}

/** Whom I rate, in a stable order (A–Z), never myself. */
export function surveyList(pub: PublicGroup): { id: string; name: string }[] {
  return [...rateable(pub.players, pub.me.playerId)].sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

/** Where the survey opens: the first one I haven't rated (resume), or the start when all are done. */
export function surveyStart(list: { id: string }[], votes: Record<string, number>): number {
  const i = list.findIndex((p) => votes[p.id] === undefined);
  return i < 0 ? 0 : i;
}

/** What the home card offers: nothing, "pick yourself first", rate, or update. */
export function rateCard(pub: PublicGroup | null, votes: Record<string, number>): 'none' | 'claim' | 'rate' | 'update' {
  if (!pub?.me.canRate || pub.me.role !== 'player') return 'none';
  if (!pub.me.playerId) return 'claim';
  if (!surveyList(pub).length) return 'none';
  return Object.keys(votes).length ? 'update' : 'rate';
}

/** Names on a live evening (tonight's list first, then the roster, then '?'). */
export function liveName(data: LiveData, roster: { id: string; name: string }[], id: string): string {
  return data.players.find((p) => p.id === id)?.name ?? roster.find((p) => p.id === id)?.name ?? '?';
}

/** "4:07". */
export function clockText(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
