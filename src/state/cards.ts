import { ATTR_KEYS, type AttrKey, type Attributes } from '../engine';

export type CardId = 'beast' | 'sniper' | 'magician' | 'noPass' | 'rock' | 'captain';

export interface Card {
  id: CardId;
  emoji: string;
  name: string;
  /** One line, shown under the card. */
  blurb: string;
  /** Change relative to the player's level. */
  delta: Partial<Record<AttrKey, number>>;
}

export const CARDS: Card[] = [
  { id: 'beast', emoji: '🦍', name: 'החיה', blurb: 'רץ 90 דקות ומגיע לכל כדור', delta: { stamina: 4, defense: 1, teamwork: 1 } },
  { id: 'sniper', emoji: '🎯', name: 'הצלף', blurb: 'פעם במשחק מוציא מספרת של החיים', delta: { shooting: 4, passing: -1 } },
  { id: 'magician', emoji: '🪄', name: 'הקוסם', blurb: 'עובר שלושה, מאבד ברביעי', delta: { dribbling: 4, passing: -2, teamwork: -2 } },
  { id: 'noPass', emoji: '🙅', name: 'לא מוסר', blurb: 'הכדור נכנס אליו ולא יוצא', delta: { passing: -3, teamwork: -3 } },
  { id: 'rock', emoji: '🧱', name: 'הסלע', blurb: 'מחזיק את ההגנה ומסדר מאחור', delta: { defense: 4, leadership: 2, dribbling: -1 } },
  { id: 'captain', emoji: '📣', name: 'הקפטן', blurb: 'צועק, מסדר ומרים את כולם', delta: { leadership: 4, teamwork: 1 } },
];

export const MAX_CARDS = 2;
const BY_ID = new Map(CARDS.map((c) => [c.id, c]));

export function cardById(id: string): Card | undefined {
  return BY_ID.get(id as CardId);
}

export function isCardId(id: unknown): id is CardId {
  return typeof id === 'string' && BY_ID.has(id as CardId);
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

/** Toggle a card, keeping at most MAX_CARDS (the oldest one drops out). */
export function toggleCard(cards: CardId[], id: CardId): CardId[] {
  if (cards.includes(id)) return cards.filter((c) => c !== id);
  return [...cards, id].slice(-MAX_CARDS);
}
