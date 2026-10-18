import { applyCards, type CardId } from './cards';
import type { Player } from './model';

// [name, level, cards, can play in goal]
type Row = [string, number, CardId[], boolean];

const ROWS: Row[] = [
  ['אבי', 8, ['captain'], false],
  ['בני', 6, ['beast'], false],
  ['גל', 7, [], false],
  ['דני', 5, ['rock'], true],
  ['הדר', 9, ['magician'], false],
  ['יוסי', 4, [], true],
  ['כפיר', 6, ['sniper'], false],
  ['ליאור', 7, ['beast', 'captain'], false],
  ['מתן', 3, ['noPass'], false],
  ['נועם', 8, ['sniper'], false],
  ['עומר', 5, ['rock'], true],
  ['רון', 6, [], false],
  ['שי', 4, ['beast'], false],
  ['תומר', 7, ['noPass'], false],
];

export function sampleSquad(): Player[] {
  return ROWS.map(([name, level, cards, canGK], i) => ({
    id: `sample-${i + 1}`,
    name,
    attrs: applyCards(level, cards),
    canGK,
    cards,
  }));
}

/** 14 "showed up" in the demo so it shows the 5 · 5 · 4 waiting-team case. */
export const SAMPLE_PRESENT = ROWS.map((_, i) => `sample-${i + 1}`);
