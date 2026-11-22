// Pure helpers for player photos and cards (no network): shared by the model, sync and the UI.

export interface CardStyle {
  shirt?: string;
  pattern?: string;
  number?: number;
}

export const photoPath = (groupId: string, playerId: string) => `${groupId}/${playerId}.webp`;

const VERSION_RE = /^[0-9a-z]{1,20}$/;
const STYLE_RE = /^[A-Za-z0-9#_-]{1,20}$/;

/** A photo version as the server keeps it, or undefined. */
export const sanitizePhoto = (v: unknown): string | undefined => (typeof v === 'string' && VERSION_RE.test(v) ? v : undefined);

/** The card style, known keys of the right type only (as private.clean_card); undefined when nothing is left. */
export function sanitizeCard(raw: unknown): CardStyle | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: CardStyle = {};
  if (typeof r.shirt === 'string' && STYLE_RE.test(r.shirt)) out.shirt = r.shirt;
  if (typeof r.pattern === 'string' && STYLE_RE.test(r.pattern)) out.pattern = r.pattern;
  if (typeof r.number === 'number' && Number.isInteger(r.number) && r.number >= 1 && r.number <= 99) out.number = r.number;
  return Object.keys(out).length ? out : undefined;
}

/** The card score (70–99) from a 1–10 level, as the server's public copy computes it. */
export function cardScore(overall: number): number {
  const lv = Math.min(10, Math.max(1, Number.isFinite(overall) ? overall : 1));
  return Math.round(70 + ((lv - 1) * 29) / 9);
}

/** A new version string: base-36 time (short, sortable). */
export const newPhotoVersion = (now = Date.now()) => Math.floor(now).toString(36);

