import type { Position } from '../engine';
import { applyCards, type CardId } from './cards';
import type { Player } from './model';

// [name, level, cards, good in goal, field positions]
type Row = [string, number, CardId[], boolean, Position[]];

const ROWS: Row[] = [
  ['אבי', 8, ['captain'], false, ['mid']],
  ['בני', 6, ['beast'], false, ['def', 'mid']],
  ['גל', 7, ['cheetah'], false, ['att']],
  ['דני', 5, ['beast'], true, ['def']],
  ['הדר', 9, ['magician', 'noDefense'], false, ['att']],
  ['יוסי', 4, [], true, []],
  ['כפיר', 6, ['sniper'], false, ['att']],
  ['ליאור', 7, ['beast', 'captain'], false, ['def']],
  ['מתן', 3, ['noPass'], false, []],
  ['נועם', 8, ['sniper', 'cheetah'], false, ['att']],
  ['עומר', 5, ['donkey'], true, ['def']],
  ['רון', 6, ['brain'], false, ['mid']],
  ['שי', 4, ['slow'], false, ['def']],
  ['תומר', 7, ['noPass'], false, ['mid', 'att']],
];

export function sampleSquad(): Player[] {
  return ROWS.map(([name, level, cards, canGK, positions], i) => ({
    id: `sample-${i + 1}`,
    name,
    attrs: applyCards(level, cards),
    canGK,
    positions,
    cards,
  }));
}

/** 14 "showed up" in the demo so it shows the 5 · 5 · 4 waiting-team case. */
export const SAMPLE_PRESENT = ROWS.map((_, i) => `sample-${i + 1}`);
