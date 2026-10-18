import { ATTR_KEYS, type AttrKey, type Attributes } from '../engine';

/**
 * Card ids are stored with every player, so they must never change.
 * The six v2 ids (beast, sniper, magician, noPass, rock, captain) keep their exact deltas.
 */
export type CardId =
  // strengths
  | 'beast'
  | 'sniper'
  | 'magician'
  | 'brain'
  | 'rock'
  | 'captain'
  // weaknesses
  | 'slow'
  | 'tired'
  | 'noDefense'
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
  { id: 'beast', kind: 'strength', emoji: '🦍', name: 'החיה', blurb: 'רץ 90 דקות ומגיע לכל כדור', delta: { stamina: 4, defense: 1, teamwork: 1 } },
  { id: 'sniper', kind: 'strength', emoji: '🎯', name: 'הצלף', blurb: 'פעם במשחק מוציא מספרת של החיים', delta: { shooting: 4, passing: -1 } },
  { id: 'magician', kind: 'strength', emoji: '🪄', name: 'הקוסם', blurb: 'עובר שלושה, מאבד ברביעי', delta: { dribbling: 4, passing: -2, teamwork: -2 } },
  { id: 'brain', kind: 'strength', emoji: '🧠', name: 'המוח', blurb: 'רואה את כל המגרש ומחלק כדורים', delta: { passing: 4, teamwork: 2 } },
  { id: 'rock', kind: 'strength', emoji: '🧱', name: 'הסלע', blurb: 'מחזיק את ההגנה ומסדר מאחור', delta: { defense: 4, leadership: 2, dribbling: -1 } },
  { id: 'captain', kind: 'strength', emoji: '📣', name: 'הקפטן', blurb: 'צועק, מסדר ומרים את כולם', delta: { leadership: 4, teamwork: 1 } },

  { id: 'slow', kind: 'weakness', emoji: '🐢', name: 'איטי', blurb: 'מגיע לכל כדור. בסוף.', delta: { stamina: -2, dribbling: -2, defense: -1 } },
  { id: 'tired', kind: 'weakness', emoji: '😮‍💨', name: 'נגמר אחרי 5 דקות', blurb: 'מתחיל כמו טיל, ואז מחפש את הבקבוק', delta: { stamina: -4, defense: -1 }, aliases: ['נגמר'] },
  { id: 'noDefense', kind: 'weakness', emoji: '🏖️', name: 'לא חוזר להגנה', blurb: 'מחכה למעלה לכדור הבא', delta: { defense: -4, teamwork: -1 }, aliases: ['לא חוזר'] },
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
  ['beast', 'tired'],
  ['brain', 'noPass'],
  ['rock', 'noDefense'],
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
  const attrs = {} as Attributes;
  for (const k of ATTR_KEYS) {
    let v = level;
    if (k !== 'overall') for (const c of cards) v += BY_ID.get(c)?.delta[k] ?? 0;
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
