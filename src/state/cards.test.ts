import { describe, expect, it } from 'vitest';
import { ATTR_KEYS } from '../engine';
import { CARDS, MAX_CARDS, STRENGTHS, WEAKNESSES, applyCards, opposite, sanitizeCards, toggleCard } from './cards';
import { parseCardNames, parseRoster } from './io';
import { sanitize } from './model';

describe('card set', () => {
  it('is balanced between strengths and weaknesses', () => {
    expect(STRENGTHS.length).toBe(WEAKNESSES.length);
    expect(STRENGTHS.length + WEAKNESSES.length).toBe(CARDS.length);
  });
  it('has unique ids and names, valid deltas, never touching the level', () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    expect(new Set(CARDS.map((c) => c.name)).size).toBe(CARDS.length);
    for (const c of CARDS) {
      expect(c.delta.overall).toBeUndefined();
      for (const k of Object.keys(c.delta)) expect(ATTR_KEYS).toContain(k);
      const sum = Object.values(c.delta).reduce((a, b) => a + (b ?? 0), 0);
      // A weakness always lowers the player; a strength never does (the magician is net zero: flashy, loses the ball).
      if (c.kind === 'strength') expect(sum).toBeGreaterThanOrEqual(0);
      else expect(sum).toBeLessThan(0);
    }
  });
  it('keeps the v2 deltas of the original six ids', () => {
    expect(applyCards(5, ['beast'])).toMatchObject({ stamina: 9, defense: 6, teamwork: 6 });
    expect(applyCards(5, ['sniper'])).toMatchObject({ shooting: 9, passing: 4 });
    expect(applyCards(5, ['magician'])).toMatchObject({ dribbling: 9, passing: 3, teamwork: 3 });
    expect(applyCards(5, ['noPass'])).toMatchObject({ passing: 2, teamwork: 2 });
    expect(applyCards(5, ['rock'])).toMatchObject({ defense: 9, leadership: 7, dribbling: 4 });
    expect(applyCards(5, ['captain'])).toMatchObject({ leadership: 9, teamwork: 6 });
  });
  it('weakness cards lower attributes, clamped at 1, and leave the level alone', () => {
    const a = applyCards(2, ['tired', 'scared', 'slow']);
    expect(a.overall).toBe(2);
    expect(a.stamina).toBe(1);
    expect(a.defense).toBe(1);
    expect(a.passing).toBe(2);
  });
});

describe('toggleCard', () => {
  it('drops the opposite card', () => {
    expect(opposite('beast')).toBe('tired');
    expect(toggleCard(['beast', 'sniper'], 'tired')).toEqual(['sniper', 'tired']);
    expect(toggleCard(['noPass'], 'brain')).toEqual(['brain']);
  });
  it(`keeps at most ${MAX_CARDS}`, () => {
    expect(toggleCard(['sniper', 'magician', 'slow'], 'beginner')).toEqual(['magician', 'slow', 'beginner']);
  });
});

describe('stored cards (migration)', () => {
  it('old v2 players keep their cards and ratings', () => {
    const attrs = applyCards(7, ['beast', 'noPass']);
    const s = sanitize({ version: 2, players: [{ id: 'a', name: 'אבי', attrs, canGK: false, cards: ['beast', 'noPass'] }] });
    expect(s.players[0].cards).toEqual(['beast', 'noPass']);
    expect(s.players[0].attrs).toEqual(attrs);
  });
  it('drops unknown ids and duplicates, resolves opposites, caps the count', () => {
    expect(sanitizeCards(['beast', 'ghost', 'beast', 7])).toEqual(['beast']);
    expect(sanitizeCards(['beast', 'tired'])).toEqual(['tired']);
    expect(sanitizeCards(['sniper', 'magician', 'brain', 'slow'])).toEqual(['magician', 'brain', 'slow']);
    expect(sanitizeCards('beast')).toEqual([]);
  });
});

describe('importing card names', () => {
  it('recognises the new names and short aliases, in order', () => {
    expect(parseCardNames('הקוסם לא חוזר להגנה')).toEqual(['magician', 'noDefense']);
    expect(parseCardNames('נגמר אחרי 5 דקות, מפחד מהכדור')).toEqual(['tired', 'scared']);
    expect(parseCardNames('נגמר מפחד')).toEqual(['tired', 'scared']);
    expect(parseCardNames('איטי מתחיל המוח')).toEqual(['slow', 'beginner', 'brain']);
  });
  it('parses a roster with weakness cards (CSV and free text)', () => {
    const { players } = parseRoster('שם,רמה,שוער,כרטיסיות\nדני,5,שוער,איטי\nגיל,3,,מתחיל; מפחד מהכדור\nרון 4 נגמר אחרי 5 דקות\n');
    expect(players.map((x) => x.cards)).toEqual([['slow'], ['beginner', 'scared'], ['tired']]);
    expect(players[0].canGK).toBe(true);
    expect(players[2].attrs.overall).toBe(4);
    expect(players[2].attrs.stamina).toBe(1);
  });
});
