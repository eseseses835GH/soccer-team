import type { Player } from '../engine';

// [name, overall, stamina, coordination, teamwork, leadership, shooting, dribbling, goalkeeping, canGK]
type Row = [string, number, number, number, number, number, number, number, number, boolean];

const ROWS: Row[] = [
  ['אבי', 8, 7, 8, 7, 8, 8, 7, 4, false],
  ['בני', 6, 8, 6, 7, 5, 5, 6, 3, false],
  ['גל', 7, 6, 7, 8, 6, 6, 7, 5, false],
  ['דני', 5, 5, 5, 6, 4, 4, 5, 8, true],
  ['הדר', 9, 8, 9, 7, 7, 9, 9, 3, false],
  ['יוסי', 4, 4, 5, 6, 3, 4, 3, 6, true],
  ['כפיר', 6, 7, 6, 5, 4, 7, 6, 4, false],
  ['ליאור', 7, 9, 6, 8, 9, 5, 6, 4, false],
  ['מתן', 3, 5, 4, 5, 2, 3, 3, 4, false],
  ['נועם', 8, 6, 8, 6, 5, 8, 9, 2, false],
  ['עומר', 5, 6, 5, 7, 6, 5, 4, 7, true],
  ['רון', 6, 6, 7, 6, 5, 6, 6, 5, false],
  ['שי', 4, 7, 4, 7, 4, 3, 4, 3, false],
  ['תומר', 7, 7, 7, 6, 7, 7, 6, 5, false],
];

export function sampleSquad(): Player[] {
  return ROWS.map(([name, overall, stamina, coordination, teamwork, leadership, shooting, dribbling, goalkeeping, canGK], i) => ({
    id: `sample-${i + 1}`,
    name,
    attrs: { overall, stamina, coordination, teamwork, leadership, shooting, dribbling, goalkeeping },
    canGK,
  }));
}

/** By default, 10 of the 14 "showed up" so the demo is a 5v5. */
export const SAMPLE_PRESENT = ['sample-1', 'sample-2', 'sample-3', 'sample-4', 'sample-5', 'sample-7', 'sample-8', 'sample-10', 'sample-11', 'sample-12'];
