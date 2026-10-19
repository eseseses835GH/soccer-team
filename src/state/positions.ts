import { POSITIONS, type Position } from '../engine';

/**
 * Where a player is strong. 🧤 שוער is the same thing as `canGK` (one control, one field);
 * the three field positions are `positions` and the split spreads them across teams.
 */
export interface PositionInfo {
  id: Position | 'gk';
  emoji: string;
  name: string;
  /** Words recognised by the roster import. */
  words: string[];
}

export const GK_INFO: PositionInfo = { id: 'gk', emoji: '🧤', name: 'שוער', words: ['שוער', 'gk', 'goalkeeper'] };

export const FIELD_POSITIONS: (PositionInfo & { id: Position })[] = [
  { id: 'def', emoji: '🛡️', name: 'הגנה', words: ['הגנה', 'מגן', 'בלם', 'def'] },
  { id: 'mid', emoji: '🔄', name: 'קישור', words: ['קישור', 'קשר', 'mid'] },
  { id: 'att', emoji: '⚡', name: 'התקפה', words: ['התקפה', 'חלוץ', 'כנף', 'att'] },
];

/** All four, in the order they're shown: keeper, then back to front. */
export const ALL_POSITIONS: PositionInfo[] = [GK_INFO, ...FIELD_POSITIONS];

/** Known ids only, no duplicates, in the canonical order (def, mid, att). */
export function sanitizePositions(raw: unknown): Position[] {
  if (!Array.isArray(raw)) return [];
  return POSITIONS.filter((p) => raw.includes(p));
}

export function togglePosition(list: Position[], id: Position): Position[] {
  return sanitizePositions(list.includes(id) ? list.filter((p) => p !== id) : [...list, id]);
}

/** Field positions named in free text (whole words). */
export function parsePositionWords(words: string[]): Position[] {
  return sanitizePositions(FIELD_POSITIONS.filter((p) => p.words.some((w) => words.includes(w))).map((p) => p.id));
}

/** Emojis for a player: 🧤 (if he's good in goal) then his field positions. */
export function positionEmojis(p: { canGK: boolean; positions?: Position[] }): PositionInfo[] {
  return ALL_POSITIONS.filter((x) => (x.id === 'gk' ? p.canGK : p.positions?.includes(x.id)));
}

/** The player with these positions; none = the field is left out (see sanitizePlayer). */
export function withPositions<T extends { positions?: Position[] }>(p: T, list: Position[]): T {
  const out = { ...p };
  const clean = sanitizePositions(list);
  if (clean.length) out.positions = clean;
  else delete out.positions;
  return out;
}
