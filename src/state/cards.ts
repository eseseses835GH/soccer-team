import { ATTR_KEYS, type AttrKey, type Attributes } from '../engine';

/**
 * Card ids are stored with every player, so they never change, even when a card's look does:
 * since v7 'beast' is 🦍 גורילה, 'sniper' is 🎯 מדויק, 'captain' is ⭐ כוכב and 'noDefense' is 🦥 עצלן.
 * The v3 🧱 'rock' is gone (defence is a position now); see migrateCards.
 */
export type CardId =
  // strengths
  | 'beast'
  | 'cheetah'
  | 'sniper'
  | 'magician'
  | 'brain'
  | 'captain'
  // weaknesses
  | 'donkey'
  | 'noDefense'
  | 'slow'
  | 'tired'
  | 'noPass'
  | 'scared'
  | 'beginner';

export type CardKind = 'strength' | 'weakness';

export interface Card {
  id: CardId;
  kind: CardKind;
  emoji: string;
  name: string;
  /** One line, shown when the card is picked. */
  blurb: string;
  /** Change relative to the player's level (never touches `overall`). */
  delta: Partial<Record<AttrKey, number>>;
  /** Short forms also recognised by the roster import. */
  aliases?: string[];
}

export const CARDS: Card[] = [
  { id: 'beast', kind: 'strength', emoji: '🦍', name: 'גורילה', blurb: 'גדול, חזק, ואף אחד לא עובר אותו בכתף', delta: { defense: 3, stamina: 2, shooting: 1, dribbling: -1 }, aliases: ['הגורילה', 'החיה'] },
  { id: 'cheetah', kind: 'strength', emoji: '🐆', name: "צ'יטה", blurb: 'עד שהסתובבת, הוא כבר ליד השער', delta: { stamina: 2, dribbling: 2, defense: 1 }, aliases: ['צ׳יטה', 'ציטה', 'מהיר'] },
  { id: 'sniper', kind: 'strength', emoji: '🎯', name: 'מדויק', blurb: 'מסירה לרגל, בעיטה לפינה', delta: { passing: 3, shooting: 3 }, aliases: ['מדוייק', 'המדויק', 'הצלף', 'צלף'] },
  { id: 'magician', kind: 'strength', emoji: '🪄', name: 'קוסם', blurb: 'הכדור דבוק לו לרגל, ועובר שניים-שלושה בקלות', delta: { dribbling: 4, shooting: 1 }, aliases: ['הקוסם'] },
  { id: 'brain', kind: 'strength', emoji: '🧠', name: 'מוח', blurb: 'רואה את כל המגרש ומחלק כדורים', delta: { passing: 4, teamwork: 2 }, aliases: ['המוח'] },
  { id: 'captain', kind: 'strength', emoji: '⭐', name: 'כוכב', blurb: 'מסדר, מעודד ומרים את כולם', delta: { leadership: 4, teamwork: 1 }, aliases: ['הכוכב', 'הקפטן', 'קפטן'] },

  { id: 'donkey', kind: 'weakness', emoji: '🫏', name: 'חמור', blurb: 'לב זהב, אבל ליד השער שלנו הכול יכול לקרות', delta: { defense: -2, teamwork: -2, passing: -1 }, aliases: ['החמור'] },
  { id: 'noDefense', kind: 'weakness', emoji: '🦥', name: 'עצלן', blurb: 'שומר כוחות להתקפה הבאה', delta: { defense: -4, stamina: -1, teamwork: -1 }, aliases: ['העצלן', 'לא חוזר להגנה', 'לא חוזר'] },
  { id: 'slow', kind: 'weakness', emoji: '🐢', name: 'איטי', blurb: 'מגיע לכל כדור. בסוף.', delta: { stamina: -2, dribbling: -2, defense: -1 } },
  { id: 'tired', kind: 'weakness', emoji: '😮‍💨', name: 'נגמר אחרי 5 דקות', blurb: 'מתחיל כמו טיל, ואז מחפש את הבקבוק', delta: { stamina: -4, defense: -1 }, aliases: ['נגמר'] },
  { id: 'noPass', kind: 'weakness', emoji: '🙅', name: 'לא מוסר', blurb: 'הכדור נכנס אליו ולא יוצא', delta: { passing: -3, teamwork: -3 } },
  { id: 'scared', kind: 'weakness', emoji: '🥶', name: 'מפחד מהכדור', blurb: 'הכדור מגיע, והוא כבר בצד השני', delta: { dribbling: -2, shooting: -2, defense: -2 }, aliases: ['מפחד'] },
  { id: 'beginner', kind: 'weakness', emoji: '🌱', name: 'מתחיל', blurb: 'עוד לומד איפה לעמוד, אבל בא עם המון מרץ', delta: { passing: -1, teamwork: -2, leadership: -2 } },
];

export const STRENGTHS = CARDS.filter((c) => c.kind === 'strength');
export const WEAKNESSES = CARDS.filter((c) => c.kind === 'weakness');

/**
 * Three: enough for "two strengths and a weakness" (or the other way round),
 * still few enough that a profile stays readable and the deltas stay bounded.
 */
export const MAX_CARDS = 3;

/** Cards that say the opposite of each other; picking one drops the other. */
const OPPOSITES: [CardId, CardId][] = [
  ['beast', 'scared'],
  ['cheetah', 'slow'],
  ['sniper', 'donkey'],
  ['brain', 'noPass'],
  ['captain', 'beginner'],
];

const BY_ID = new Map(CARDS.map((c) => [c.id, c]));

export function cardById(id: string): Card | undefined {
  return BY_ID.get(id as CardId);
}

export function isCardId(id: unknown): id is CardId {
  return typeof id === 'string' && BY_ID.has(id as CardId);
}

export function opposite(id: CardId): CardId | undefined {
  for (const [a, b] of OPPOSITES) {
    if (a === id) return b;
    if (b === id) return a;
  }
  return undefined;
}

/** Every attribute starts at the player's level; cards push some up or down. */
export function applyCards(level: number, cards: CardId[]): Attributes {
  return applyDeltas(level, cards.map((c) => BY_ID.get(c)?.delta ?? {}));
}

function applyDeltas(level: number, deltas: Card['delta'][]): Attributes {
  const attrs = {} as Attributes;
  for (const k of ATTR_KEYS) {
    let v = level;
    if (k !== 'overall') for (const d of deltas) v += d[k] ?? 0;
    attrs[k] = Math.min(10, Math.max(1, Math.round(v)));
  }
  return attrs;
}

/** Toggle a card: its opposite drops out, and at most MAX_CARDS stay (the oldest drops out). */
export function toggleCard(cards: CardId[], id: CardId): CardId[] {
  if (cards.includes(id)) return cards.filter((c) => c !== id);
  const opp = opposite(id);
  return [...cards.filter((c) => c !== opp), id].slice(-MAX_CARDS);
}

/** Clean a stored or imported card list: known ids, no duplicates or opposites, at most MAX_CARDS. */
export function sanitizeCards(raw: unknown): CardId[] {
  if (!Array.isArray(raw)) return [];
  let out: CardId[] = [];
  for (const id of raw) if (isCardId(id) && !out.includes(id)) out = toggleCard(out, id);
  return out;
}

/** Earlier deltas of cards whose effect changed since (v7, and the magician in v13), and of the dropped 🧱 'rock'. */
const LEGACY_DELTAS: Record<string, Card['delta']> = {
  beast: { stamina: 4, defense: 1, teamwork: 1 },
  sniper: { shooting: 4, passing: -1 },
  noDefense: { defense: -4, teamwork: -1 },
  rock: { defense: 4, leadership: 2, dribbling: -1 },
  // v3–v13: the magician also lost the ball (passing/teamwork −2); the user said it's a pure strength.
  magician: { dribbling: 4, passing: -2, teamwork: -2 },
};

/**
 * A stored player's cards, from any version. Ids stay as they are; 🧱 'rock' is dropped and
 * becomes the 🛡️ position (`addDef`). If the ratings are exactly what level + cards gave with
 * the old deltas (nobody tuned them by hand), they're recomputed with today's deltas, so the
 * card means what it says now. Hand-tuned ratings are never touched.
 */
export function migrateCards(raw: unknown, attrs: Attributes): { cards: CardId[]; attrs: Attributes; addDef: boolean } {
  const cards = sanitizeCards(raw);
  const list = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  const addDef = list.includes('rock');
  if (!list.some((id) => id in LEGACY_DELTAS)) return { cards, attrs, addDef };
  const old = [...new Set(list)].map((id) => LEGACY_DELTAS[id] ?? cardById(id)?.delta ?? {});
  const was = applyDeltas(attrs.overall, old);
  const untouched = ATTR_KEYS.every((k) => was[k] === attrs[k]);
  return { cards, attrs: untouched ? applyCards(attrs.overall, cards) : attrs, addDef };
}
