// "כושר אחרון" (v37): the after-game review nudges a player's level a little. The server keeps
// `form` on the roster player (private.player_form, after every review_evening); this file reads it
// and mirrors the formula for tests. DECISIONS → "v37: after-game review".
import { ATTR_KEYS } from '../engine';
import type { Player } from './model';

/** Each evening's mean counts this much (one evening moves a player at most 0.3). */
export const FORM_STEP = 0.3;
/** Older evenings fade: the k-th newest counts 0.85^k. */
export const FORM_FADE = 0.85;
export const FORM_MAX = 1.5;
/** An evening counts for a player once this many reviewers said something about him. */
export const MIN_REVIEWS = 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** 2 decimals, half away from zero (as Postgres numeric round; the tiny nudge undoes float error like 0.555 → 0.5549…). */
const round2 = (v: number) => (Math.sign(v) * Math.round(Math.abs(v) * 100 + 1e-9)) / 100 || 0;

/** A stored form value: finite, clamped to ±1.5, 2 decimals; undefined for none (or 0). */
export function sanitizeForm(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const f = round2(clamp(v, -FORM_MAX, FORM_MAX));
  return f === 0 ? undefined : f;
}

/** One evening's votes on one player (-1 / 0 / +1; "לא יודע" is no vote): their mean, or null with too few. */
export function eveningMean(votes: number[]): number | null {
  const vs = votes.filter((v) => v === -1 || v === 0 || v === 1);
  return vs.length >= MIN_REVIEWS ? vs.reduce((a: number, b) => a + b, 0) / vs.length : null;
}

/** Form from his evenings' means, newest first (evenings without a mean are left out). */
export function formOf(meansNewestFirst: number[]): number {
  const f = meansNewestFirst.reduce((s, m, k) => s + FORM_STEP * m * FORM_FADE ** k, 0);
  return round2(clamp(f, -FORM_MAX, FORM_MAX));
}

/** The level used to split teams (and for the card score): rated level + form, 1–10. */
export const effectiveLevel = (p: { attrs: { overall: number }; form?: number }) => clamp(p.attrs.overall + (p.form ?? 0), 1, 10);

/** The player as the split sees him: every attribute moved by his form (1–10). Same object without form. */
export function withForm<T extends Player>(p: T): T {
  if (!p.form) return p;
  const attrs = { ...p.attrs };
  for (const k of ATTR_KEYS) attrs[k] = clamp(p.attrs[k] + p.form, 1, 10);
  return { ...p, attrs };
}

/** "+0.3" / "-0.2" for the organizer's edit sheet; '' when it's too small to mention. */
export const formText = (form: number | undefined) => (form === undefined || Math.abs(form) < 0.05 ? '' : `${form > 0 ? '+' : '-'}${Math.abs(form).toFixed(1)}`);
