// Guests ("אורח", DECISIONS → v23): someone who plays with us tonight but isn't a regular. He plays
// like anyone else; `occasional` only decides where he is listed and that nobody rates him. Pure.
import { applyCards } from './cards';
import type { EveningRecord } from './history';
import type { Player } from './model';

export const isGuest = (p: { occasional?: boolean }) => p.occasional === true;

/** Check-in ("מי הגיע"): the regulars, and a guest only when he's already here tonight. */
export function checkInList<T extends { id: string; occasional?: boolean }>(players: T[], presentIds: Iterable<string>): T[] {
  const here = new Set(presentIds);
  return players.filter((p) => !isGuest(p) || here.has(p.id));
}

/** Ids without the guests ("כמו בפעם הקודמת" brings back only the regulars). */
export function withoutGuests(ids: string[], players: { id: string; occasional?: boolean }[]): string[] {
  const guests = new Set(players.filter(isGuest).map((p) => p.id));
  return ids.filter((id) => !guests.has(id));
}

/**
 * Guests in the order to offer them: who played the most evenings first, a tie goes to the more
 * recent last evening, then A–Z. Those who come rarely sink to the bottom.
 */
export function byPlayed<T extends { id: string; name: string }>(guests: T[], history: Pick<EveningRecord, 'players' | 'endedAt'>[]): T[] {
  const n = new Map<string, number>();
  const last = new Map<string, number>();
  for (const h of history) {
    for (const id of new Set(h.players.map((p) => p.id))) {
      n.set(id, (n.get(id) ?? 0) + 1);
      last.set(id, Math.max(last.get(id) ?? 0, h.endedAt));
    }
  }
  return [...guests].sort((a, b) => (n.get(b.id) ?? 0) - (n.get(a.id) ?? 0) || (last.get(b.id) ?? 0) - (last.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'he'));
}

/** Players to pick from: regulars A–Z, then the guests by how much they played (byPlayed). */
export function pickOrder<T extends { id: string; name: string; occasional?: boolean }>(players: T[], history: Pick<EveningRecord, 'players' | 'endedAt'>[]): T[] {
  const { regulars, guests } = splitRoster(players, history);
  return [...regulars, ...guests];
}

/** The players screen: regulars A–Z in the main list, guests (byPlayed) in the folded "מזדמנים". */
export function splitRoster<T extends { id: string; name: string; occasional?: boolean }>(
  players: T[],
  history: Pick<EveningRecord, 'players' | 'endedAt'>[] = [],
): { regulars: T[]; guests: T[] } {
  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return { regulars: sorted.filter((p) => !isGuest(p)), guests: byPlayed(sorted.filter(isGuest), history) };
}

/** A new guest at `level` (5 when a player adds him: his phone has no ratings). */
export function newGuest(id: string, name: string, level = 5, voter?: string | null): Player {
  return {
    id,
    name: name.replace(/\s+/g, ' ').trim().slice(0, 24),
    attrs: applyCards(level, []),
    canGK: false,
    cards: [],
    occasional: true,
    ...(voter ? { levelVotes: { [voter]: level } } : {}),
  };
}

/** "להפוך לקבוע" / "לאשר כקבוע": the same player, no longer a guest. */
export function makeRegular(p: Player): Player {
  const { occasional: _, pendingRegular: __, ...rest } = p;
  return rest;
}

/** Added by a player as "קבוע בקבוצה": a guest until an organizer approves ("ממתין לאישור"). */
export const pendingRegulars = <T extends { pendingRegular?: boolean; occasional?: boolean }>(players: T[]): T[] =>
  players.filter((p) => p.pendingRegular === true && isGuest(p));

/** "להשאיר אורח": no longer waiting, still a guest. */
export function keepGuest(p: Player): Player {
  const { pendingRegular: _, ...rest } = p;
  return rest;
}
