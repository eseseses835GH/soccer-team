// After-game review (v37): for 48 hours after an evening, everyone who played says how the others
// played THAT evening (-1 / 0 / +1, or nothing). The server folds it into each player's `form`
// (state/form.ts). Pure "who reviews what" + the two RPCs. DECISIONS → "v37: after-game review".
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EveningRecord } from '../state/history';
import { loadJSON, saveJSON } from '../state/storage';
import { fail } from './supabase';

/** How long after an evening ends it can be reviewed (the server checks the same). */
export const REVIEW_WINDOW_MS = 48 * 3600e3;
/** A clock a little ahead on the phone that saved the evening is fine. */
const CLOCK_SLACK_MS = 10 * 60e3;
/** At most this many votes per call (the server's cap). */
export const MAX_REVIEW_VOTES = 60;

export type ReviewValue = -1 | 0 | 1;
export type Review = Record<string, ReviewValue>;

/** Everyone who was there: the record's players, teams and bench. */
export function eveningPlayerIds(rec: EveningRecord): string[] {
  return [...new Set([...rec.players.map((p) => p.id), ...rec.teams.flatMap((t) => t.ids), ...rec.subIds])];
}

/** True when `me` played that evening and it ended less than 48 hours before `now`. */
export function canReview(rec: EveningRecord, me: string | null, now: number): boolean {
  if (!me || !eveningPlayerIds(rec).includes(me)) return false;
  return rec.endedAt > now - REVIEW_WINDOW_MS && rec.endedAt <= now + CLOCK_SLACK_MS;
}

/** The evening to offer: the newest one he can review that this phone didn't put off; null = none. */
export function reviewable(history: EveningRecord[], me: string | null, now: number, off: (id: string) => boolean = () => false): EveningRecord | null {
  const ok = history.filter((h) => canReview(h, me, now) && !off(h.id) && reviewList(h, me).length > 0);
  return ok.sort((a, b) => b.endedAt - a.endedAt)[0] ?? null;
}

/** Who he reviews: everyone who played but himself, with the name at the time (or the roster's). */
export function reviewList(rec: EveningRecord, me: string | null, roster: { id: string; name: string }[] = []): { id: string; name: string }[] {
  const names = new Map([...roster.map((p) => [p.id, p.name] as const), ...rec.players.map((p) => [p.id, p.name] as const)]);
  return eveningPlayerIds(rec)
    .filter((id) => id !== me && names.has(id))
    .map((id) => ({ id, name: names.get(id)! }));
}

/** What review_evening gets: the votes given (a missing player = "לא יודע"). */
export function reviewPayload(review: Review, allowed: string[]): { player_id: string; value: ReviewValue }[] {
  return allowed.filter((id) => review[id] !== undefined).map((id) => ({ player_id: id, value: review[id] })).slice(0, MAX_REVIEW_VOTES);
}

/** my_review() / review_evening() → { playerId: -1 | 0 | 1 }. */
export function parseReview(raw: unknown): Review {
  const out: Review = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (v === -1 || v === 0 || v === 1) out[k] = v;
  return out;
}

// ---------- this phone: put off ("אחר כך") / sent ----------

const key = (gid: string, eid: string) => `kochot:review:${gid}:${eid}`;
export type ReviewMark = 'later' | 'sent';
export const reviewMark = (gid: string, eid: string): ReviewMark | null => {
  const v = loadJSON<unknown>(key(gid, eid));
  return v === 'later' || v === 'sent' ? v : null;
};
export const markReview = (gid: string, eid: string, m: ReviewMark) => saveJSON(key(gid, eid), m);

// ---------- server ----------

export function reviewsApi(sb: SupabaseClient) {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) fail(error);
    return data as unknown;
  };
  return {
    /** My votes for that evening. */
    async myReview(groupId: string, eveningId: string): Promise<Review> {
      return parseReview(await rpc('my_review', { p_group_id: groupId, p_evening_id: eveningId }));
    },
    /** Replaces my votes for that evening. Returns what is stored. 'denied' = not allowed (or the 48 hours passed). */
    async reviewEvening(groupId: string, eveningId: string, votes: { player_id: string; value: ReviewValue }[]): Promise<Review> {
      return parseReview(await rpc('review_evening', { p_group_id: groupId, p_evening_id: eveningId, p_votes: votes }));
    },
  };
}
