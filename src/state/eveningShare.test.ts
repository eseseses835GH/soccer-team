import { describe, expect, it } from 'vitest';
import { eveningShareText } from './eveningShare';
import { bestLineup, rosterChanged, teamsChanged, type EveningMatch, type EveningRecord } from './history';

const T0 = new Date(2026, 9, 15, 20).getTime();
const NAMES: Record<string, string> = { a: 'אבי', b: 'בני', c: 'גדי', d: 'דני', e: 'הדר', f: 'ורד' };
const players = Object.entries(NAMES).map(([id, name]) => ({ id, name }));

/** "a>b 2-0 by x" style matches: [a, b, goalsA, goalsB, scorers]. */
const mt = (a: number, b: number, ga: number, gb: number, by: string[] = [], at = T0, sides?: [string[], string[]]): EveningMatch => ({
  a,
  b,
  goalsA: ga,
  goalsB: gb,
  goals: by.map((x, i) => ({ team: i < ga ? a : b, by: x })),
  endedAt: at,
  ...(sides ? { sides } : {}),
});

const rec = (id: string, teams: string[][], matches: EveningMatch[], startedAt = T0): EveningRecord => ({
  id,
  v: 1,
  startedAt,
  endedAt: startedAt + 1,
  teamSize: 2,
  players,
  teams: teams.map((ids, t) => ({ bib: ['red', 'blue', 'yellow'][t], ids })),
  subIds: [],
  matches,
});

const lines = (s: string) => s.replace(/‏/g, '').split('\n');

describe('evening share text', () => {
  it('same teams all night: the clear winner, each team with its players, the highlights', () => {
    const r = rec('ev-1', [['a', 'b'], ['c', 'd']], [mt(0, 1, 2, 0, ['a', 'a']), mt(0, 1, 1, 0, ['b'])]);
    expect(lines(eveningShareText([r], r, ['👑 מלך השערים: אבי (2)']))).toEqual([
      expect.stringMatching(/^⚽ סיכום הערב – /),
      '🏆 🔴 האדומים לקחו את הערב',
      '🔴 אדומים: 2 נ׳ · 0 ת׳ · 0 ה׳',
      'אבי, בני',
      '🔵 כחולים: 0 נ׳ · 0 ת׳ · 2 ה׳',
      'גדי, דני',
      '👑 מלך השערים: אבי (2)',
    ]);
  });

  it('no champion line when nobody clearly won', () => {
    const r = rec('ev-1', [['a', 'b'], ['c', 'd']], [mt(0, 1, 1, 1)]);
    expect(eveningShareText([r], r, [])).not.toContain('🏆');
  });

  it('after a shuffle: both parts, the best lineup took the evening, the night\'s top scorer', () => {
    const p1 = rec('ev-1', [['a', 'b'], ['c', 'd']], [mt(0, 1, 1, 0, ['a']), mt(0, 1, 0, 1, ['c'])]);
    const p2 = rec('ev-1~ev-2', [['a', 'c'], ['b', 'd']], [mt(0, 1, 2, 0, ['a', 'c']), mt(0, 1, 1, 0, ['a'])], T0 + 60_000);
    expect(lines(eveningShareText([p1, p2], p2, ['🔥 ignored']))).toEqual([
      expect.stringMatching(/^⚽ סיכום הערב – /),
      '🏆 ההרכב שלקח את הערב: 🔴 אבי, גדי (2 נ׳ · 0 ת׳ · 0 ה׳)',
      '🔴 אדומים: 1 נ׳ · 0 ת׳ · 1 ה׳',
      'אבי, בני',
      '🔵 כחולים: 1 נ׳ · 0 ת׳ · 1 ה׳',
      'גדי, דני',
      '🔀 אחרי שאפל',
      '🔴 אדומים: 2 נ׳ · 0 ת׳ · 0 ה׳',
      'אבי, גדי',
      '🔵 כחולים: 0 נ׳ · 0 ת׳ · 2 ה׳',
      'בני, דני',
      '👑 מלך השערים: אבי (3)',
    ]);
  });

  it('after a shuffle with no lineup ahead: no champion line', () => {
    const p1 = rec('ev-1', [['a', 'b'], ['c', 'd']], [mt(0, 1, 1, 0)]);
    const p2 = rec('ev-1~ev-2', [['a', 'c'], ['b', 'd']], [mt(0, 1, 1, 0)], T0 + 60_000);
    expect(bestLineup([p1, p2])).toBeNull();
    expect(eveningShareText([p1, p2], p1, [])).not.toContain('🏆');
  });
});

describe('teams changed', () => {
  it('a latecomer or a swap changes a roster; a borrowed player does not', () => {
    const teams = [['a', 'b'], ['c', 'd'], ['e']];
    const borrowed = rec('ev-1', teams, [mt(0, 2, 1, 0, [], T0, [['a', 'b'], ['e', 'c']])]);
    expect(rosterChanged(borrowed)).toBe(false);
    expect(teamsChanged([borrowed])).toBe(false);
    const late = rec('ev-1', [['a', 'b', 'f'], ['c', 'd']], [mt(0, 1, 1, 0, [], T0, [['a', 'b'], ['c', 'd']])]);
    expect(rosterChanged(late)).toBe(true);
    const left = rec('ev-1', [['a'], ['c', 'd']], [mt(0, 1, 1, 0, [], T0, [['a', 'f'], ['c', 'd']])]);
    expect(rosterChanged(left)).toBe(true);
    expect(teamsChanged([rec('ev-1~ev-2', teams, [mt(0, 1, 1, 0)])])).toBe(true);
  });
});
