// Pure helpers for player photos and cards (no network): shared by the model, sync and the UI.

export interface CardStyle {
  shirt?: string;
  pattern?: string;
  number?: number;
}

export const photoPath = (groupId: string, playerId: string) => `${groupId}/${playerId}.webp`;
/** The card cutout (transparent; WebP, or PNG where the browser can't write WebP — the name stays). */
export const cutoutPath = (groupId: string, playerId: string) => `${groupId}/${playerId}-cut.webp`;

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

/** What saving / removing a card changed (`photo`: new version, null = removed, absent = kept). */
export interface PhotoChange {
  photo?: string | null;
  /** null = none. */
  card?: CardStyle | null;
}

/** A player with the change applied (the roster copy on this phone). */
export function withPhotoChange<T extends { photo?: string; card?: CardStyle }>(p: T, c: PhotoChange): T {
  const { photo, card, ...rest } = p;
  const nextPhoto = c.photo === undefined ? photo : (c.photo ?? undefined);
  const nextCard = c.card === undefined ? card : (c.card ?? undefined);
  return { ...rest, ...(nextPhoto ? { photo: nextPhoto } : {}), ...(nextCard ? { card: nextCard } : {}) } as T;
}
