/** What a player's card shows, from what this phone has (pure: no React, no network). */
import type { Position } from '../engine';
import { nightOf, sideIds, type EveningRecord } from '../state/history';
import { matchWinner } from '../match/match';
import { cardScore, type CardStyle as SavedStyle } from '../photos/style';
import type { CardStat } from './PlayerCard';
import { sanitizeStyle, type CardPosition, type CardStyle } from './style';

export interface CardData {
  id: string;
  name: string;
  photo?: string;
  position?: CardPosition;
  score?: number;
  style: CardStyle;
  stats: CardStat[];
}

/** His first field position; only "good in goal" → keeper. */
export const positionOf = (p: { positions?: Position[]; canGK?: boolean }): CardPosition | undefined => p.positions?.[0] ?? (p.canGK ? 'gk' : undefined);

/** Evenings (a shuffle's parts count once), wins and goals from the group's history. */
export function playerTotals(history: EveningRecord[], id: string): { evenings: number; wins: number; goals: number } {
  const nights = new Set<string>();
  let wins = 0;
  let goals = 0;
  for (const rec of history) {
    if (!rec.players.some((p) => p.id === id)) continue;
    nights.add(nightOf(rec.id));
    for (const mt of rec.matches) {
      for (const g of mt.goals) if (g.by === id) goals++;
      const w = matchWinner(mt);
      if (w === null) continue;
      if (sideIds(rec, mt, w === mt.a ? 0 : 1).includes(id)) wins++;
    }
  }
  return { evenings: nights.size, wins, goals };
}

/** Up to 3 stats, only the ones that aren't zero. */
export function cardStats(history: EveningRecord[], id: string): CardStat[] {
  const t = playerTotals(history, id);
  return [
    { label: 'שערים', value: t.goals },
    { label: 'ניצחונות', value: t.wins },
    { label: 'ערבים', value: t.evenings },
  ].filter((s) => s.value > 0);
}

interface RosterPlayer {
  id: string;
  name: string;
  positions?: Position[];
  canGK?: boolean;
  photo?: string;
  card?: SavedStyle;
  /** Organizer phones only. */
  attrs?: { overall: number };
}

/**
 * The card of `id`. Organizer phones: the score from his level. Players' phones (`pub` given): the
 * score the public copy carries, never anything else of the level.
 */
export function cardData(
  id: string,
  roster: RosterPlayer[],
  history: EveningRecord[],
  pub: { players: (RosterPlayer & { score?: number })[] } | null,
): CardData | null {
  const r = roster.find((p) => p.id === id);
  const pp = pub?.players.find((p) => p.id === id);
  const p = pp ?? r;
  if (!p) return null;
  const score = pub ? pp?.score : r?.attrs ? cardScore(r.attrs.overall) : undefined;
  const photo = r?.photo ?? pp?.photo;
  const card = r?.card ?? pp?.card;
  return {
    id,
    name: p.name,
    ...(photo ? { photo } : {}),
    position: positionOf(p),
    ...(score !== undefined ? { score } : {}),
    style: sanitizeStyle(card),
    stats: cardStats(history, id),
  };
}
