// Tonight's settings a player running the evening may change (DECISIONS → "Runner evening settings").
// Only how matches run — never weights, players or the look. Shared by the phone and the
// split-teams function (bundled into core.js), so both clamp exactly the same way.
import { sanitizeSettings, type Settings } from './model';

export const EVENING_KEYS = ['matchMinutes', 'matchNoLimit', 'drawExtraMinutes', 'gkMode', 'gkSwitchGoals'] as const;
export type EveningKey = (typeof EVENING_KEYS)[number];
export type EveningRules = Pick<Settings, EveningKey>;

/** The ranges sanitizeSettings accepts (outside them it falls back to the default). */
const inRange = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/**
 * Overrides from the wire: known keys of the right type and inside the app's ranges only (anything
 * else is dropped, so the group's own value stays). null = not an object.
 */
export function parseEvening(raw: unknown): Partial<EveningRules> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: Partial<EveningRules> = {};
  if (inRange(r.matchMinutes, 1, 60)) out.matchMinutes = r.matchMinutes;
  if (typeof r.matchNoLimit === 'boolean') out.matchNoLimit = r.matchNoLimit;
  if (inRange(r.drawExtraMinutes, 0, 10)) out.drawExtraMinutes = r.drawExtraMinutes;
  if (r.gkMode === 'rotate' || r.gkMode === 'fixed') out.gkMode = r.gkMode;
  if (inRange(r.gkSwitchGoals, 1, 5)) out.gkSwitchGoals = r.gkSwitchGoals;
  return out;
}

/** `base` with tonight's overrides, through the app's own settings sanitizer (rounding). */
export function withEvening(base: Settings, o: Partial<EveningRules>): Settings {
  return sanitizeSettings({ ...base, ...(parseEvening(o) ?? {}) });
}

