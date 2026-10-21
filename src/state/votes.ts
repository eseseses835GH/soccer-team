// Level = the average of the organizers' ratings (DECISIONS → "Level = organizers' average (v9)").
// A player of a synced group may carry `levelVotes`: the 1–10 level each organizer (by auth user
// id) gave him. With votes, his level (`attrs.overall`) is their rounded mean.
import { ATTR_KEYS, type Attributes } from '../engine';
import { applyCards, type CardId } from './cards';

export type LevelVotes = Record<string, number>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** More organizers than this per group is unrealistic; it bounds a corrupt blob. */
const MAX_VOTES = 50;

/** Valid votes only (user ids are UUIDs, levels whole 1–10); undefined when none are left. */
export function sanitizeVotes(raw: unknown): LevelVotes | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: LevelVotes = {};
  let n = 0;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_VOTES) break;
    if (UUID.test(id) && typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10) {
      out[id.toLowerCase()] = v;
      n++;
    }
  }
  return n ? out : undefined;
}

/** Rounded mean, .5 up (6.5 → 7). null without votes. */
export function averageLevel(votes: LevelVotes | undefined): number | null {
  const vs = Object.values(votes ?? {});
  if (!vs.length) return null;
  return Math.min(10, Math.max(1, Math.floor(vs.reduce((a, b) => a + b, 0) / vs.length + 0.5)));
}

/** True when the sliders were moved away from what level + cards give. */
export const isTuned = (attrs: Attributes, cards: CardId[]) => {
  const base = applyCards(attrs.overall, cards);
  return ATTR_KEYS.some((k) => attrs[k] !== base[k]);
};

/**
 * The attributes at a new level: rebuilt from level + cards like a level change in the form,
 * unless they were tuned by hand; then only `overall` moves.
 */
export function attrsAtLevel(attrs: Attributes, cards: CardId[], level: number): Attributes {
  if (attrs.overall === level) return attrs;
  return isTuned(attrs, cards) ? { ...attrs, overall: level } : applyCards(level, cards);
}

/** Merge votes three-way per organizer: union by user id; for the same user, the side that changed wins. */
export function mergeVotes(base: LevelVotes | undefined, local: LevelVotes | undefined, remote: LevelVotes | undefined): LevelVotes | undefined {
  const b = base ?? {};
  const l = local ?? {};
  const r = remote ?? {};
  const out: LevelVotes = {};
  for (const id of new Set([...Object.keys(l), ...Object.keys(r)])) {
    const v = l[id] === b[id] ? (r[id] ?? l[id]) : (l[id] ?? r[id]);
    if (v !== undefined) out[id] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** One-line summary under the level in the edit sheet ('' = nothing to show). */
export function votesLine(votes: LevelVotes | undefined, me: string | null): string {
  const n = Object.keys(votes ?? {}).length;
  const mine = me ? votes?.[me] : undefined;
  if (n >= 2) return `ממוצע של ${n} מארגנים: ${averageLevel(votes)} · ${mine !== undefined ? `שלך: ${mine}` : 'עוד לא דירגת'}`;
  if (n === 1 && mine === undefined && me) return 'עוד לא דירגת';
  return '';
}
