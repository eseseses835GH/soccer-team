import { describe, expect, it } from 'vitest';
import { ATTR_KEYS } from '../engine';
import { CARDS, MAX_CARDS, STRENGTHS, WEAKNESSES, applyCards, migrateCards, opposite, sanitizeCards, toggleCard, type Card } from './cards';
import { parseCardNames, parseRoster } from './io';
import { sanitize } from './model';

const sum = (c: Card) => Object.values(c.delta).reduce((a, b) => a + (b ?? 0), 0);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('card set', () => {
  it('has the v7 animals and symbols', () => {
    expect(STRENGTHS.map((c) => c.emoji + c.name)).toEqual(['🦍גורילה', "🐆צ'יטה", '🎯מדויק', '🪄קוסם', '🧠מוח', '⭐כוכב']);
    expect(WEAKNESSES.map((c) => c.emoji + c.name)).toEqual(['🫏חמור', '🦥עצלן', '🐢איטי', '😮‍💨נגמר אחרי 5 דקות', '🙅לא מוסר', '🥶מפחד מהכדור', '🌱מתחיל']);
    expect(STRENGTHS.length + WEAKNESSES.length).toBe(CARDS.length);
  });
  it('has unique ids, names and emojis, valid deltas, never touching the level', () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    expect(new Set(CARDS.map((c) => c.name)).size).toBe(CARDS.length);
    expect(new Set(CARDS.map((c) => c.emoji)).size).toBe(CARDS.length);
    for (const c of CARDS) {
      expect(c.delta.overall).toBeUndefined();
      expect(c.blurb.length).toBeGreaterThan(5);
      for (const [k, v] of Object.entries(c.delta)) {
        expect(ATTR_KEYS).toContain(k);
        expect(Math.abs(v ?? 0)).toBeLessThanOrEqual(4);
      }
      // A weakness always lowers the player; a strength never does (the magician is net zero: flashy, loses the ball).
      if (c.kind === 'strength') expect(sum(c)).toBeGreaterThanOrEqual(0);
      else expect(sum(c)).toBeLessThan(0);
    }
  });
  it('is balanced: a strength lifts about as much as a weakness lowers', () => {
    const up = STRENGTHS.map(sum).filter((s) => s > 0);
    const down = WEAKNESSES.map((c) => -sum(c));
    for (const s of [...up, ...down]) {
      expect(s).toBeGreaterThanOrEqual(5);
      expect(s).toBeLessThanOrEqual(6);
    }
    expect(Math.abs(mean(up) - mean(down))).toBeLessThan(0.25);
  });
  it('v7 deltas', () => {
    expect(applyCards(5, ['beast'])).toMatchObject({ defense: 8, stamina: 7, shooting: 6, dribbling: 4, passing: 5 });
    expect(applyCards(5, ['cheetah'])).toMatchObject({ stamina: 7, dribbling: 7, defense: 6 });
    expect(applyCards(5, ['sniper'])).toMatchObject({ passing: 8, shooting: 8 });
    expect(applyCards(5, ['captain'])).toMatchObject({ leadership: 9, teamwork: 6 });
    expect(applyCards(5, ['donkey'])).toMatchObject({ defense: 3, teamwork: 3, passing: 4 });
    expect(applyCards(5, ['noDefense'])).toMatchObject({ defense: 1, stamina: 4, teamwork: 4 });
    // Unchanged since v3.
    expect(applyCards(5, ['magician'])).toMatchObject({ dribbling: 9, passing: 3, teamwork: 3 });
    expect(applyCards(5, ['noPass'])).toMatchObject({ passing: 2, teamwork: 2 });
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
    expect(opposite('cheetah')).toBe('slow');
    expect(opposite('beast')).toBe('scared');
    expect(opposite('sniper')).toBe('donkey');
    expect(opposite('captain')).toBe('beginner');
    expect(opposite('noDefense')).toBeUndefined();
    expect(toggleCard(['cheetah', 'sniper'], 'slow')).toEqual(['sniper', 'slow']);
    expect(toggleCard(['noPass'], 'brain')).toEqual(['brain']);
    // A fast player can still run out of breath.
    expect(toggleCard(['cheetah'], 'tired')).toEqual(['cheetah', 'tired']);
  });
  it(`keeps at most ${MAX_CARDS}`, () => {
    expect(toggleCard(['sniper', 'magician', 'slow'], 'beginner')).toEqual(['magician', 'slow', 'beginner']);
  });
});

describe('stored cards (migration)', () => {
  // v3–v6 ratings of a level-7 player with the old 🦍 החיה (stamina +4, defence +1, teamwork +1) and 🙅 לא מוסר.
  const oldBeastNoPass = { overall: 7, stamina: 10, passing: 4, dribbling: 7, shooting: 7, defense: 8, teamwork: 5, leadership: 7 };

  it('keeps ids; untouched old ratings follow the new deltas', () => {
    const s = sanitize({ version: 2, players: [{ id: 'a', name: 'אבי', attrs: oldBeastNoPass, canGK: false, cards: ['beast', 'noPass'] }] });
    expect(s.players[0].cards).toEqual(['beast', 'noPass']);
    expect(s.players[0].attrs).toEqual(applyCards(7, ['beast', 'noPass']));
    expect(s.players[0].positions).toBeUndefined();
  });
  it('is stable: a migrated (or new) player loads unchanged', () => {
    const p = { id: 'a', name: 'אבי', attrs: applyCards(7, ['beast', 'noPass']), canGK: false, cards: ['beast', 'noPass'] };
    expect(sanitize({ players: [p] }).players[0]).toEqual(p);
    const twice = sanitize(sanitize({ players: [{ ...p, attrs: oldBeastNoPass }] }));
    expect(twice.players[0]).toEqual(p);
  });
  it('never touches hand-tuned ratings', () => {
    const tuned = { ...oldBeastNoPass, shooting: 9 };
    const s = sanitize({ players: [{ id: 'a', name: 'אבי', attrs: tuned, canGK: false, cards: ['beast', 'noPass'] }] });
    expect(s.players[0].attrs).toEqual(tuned);
  });
  it('old sniper and "doesn\'t track back" (now 🎯 מדויק, 🦥 עצלן) move to the new deltas', () => {
    const was = { overall: 6, stamina: 6, passing: 5, dribbling: 6, shooting: 10, defense: 2, teamwork: 5, leadership: 6 };
    expect(migrateCards(['sniper', 'noDefense'], was).attrs).toEqual(applyCards(6, ['sniper', 'noDefense']));
  });
  it('the dropped 🧱 rock becomes the 🛡️ defence position', () => {
    // Old 🧱 הסלע (defence +4, leadership +2, dribbling −1) + 🐢 איטי at level 5.
    const was = { overall: 5, stamina: 3, passing: 5, dribbling: 2, shooting: 5, defense: 8, teamwork: 5, leadership: 7 };
    const s = sanitize({ players: [{ id: 'a', name: 'דני', attrs: was, canGK: true, cards: ['rock', 'slow'], positions: ['att'] }] });
    expect(s.players[0].cards).toEqual(['slow']);
    expect(s.players[0].positions).toEqual(['def', 'att']);
    expect(s.players[0].attrs).toEqual(applyCards(5, ['slow']));
    expect(s.players[0].canGK).toBe(true);
    // Hand-tuned: the card goes, the ratings stay.
    const tuned = { ...was, shooting: 8 };
    expect(migrateCards(['rock', 'slow'], tuned)).toEqual({ cards: ['slow'], attrs: tuned, addDef: true });
  });
  it('unchanged cards need no migration', () => {
    const odd = { overall: 5, stamina: 2, passing: 9, dribbling: 5, shooting: 5, defense: 5, teamwork: 5, leadership: 5 };
    expect(migrateCards(['magician', 'tired'], odd)).toEqual({ cards: ['magician', 'tired'], attrs: odd, addDef: false });
  });
  it('drops unknown ids and duplicates, resolves opposites, caps the count', () => {
    expect(sanitizeCards(['beast', 'ghost', 'beast', 7])).toEqual(['beast']);
    expect(sanitizeCards(['cheetah', 'slow'])).toEqual(['slow']);
    expect(sanitizeCards(['sniper', 'magician', 'brain', 'slow'])).toEqual(['magician', 'brain', 'slow']);
    expect(sanitizeCards('beast')).toEqual([]);
  });
});

describe('importing card names', () => {
  it('recognises the names and short aliases, in order', () => {
    expect(parseCardNames('קוסם עצלן')).toEqual(['magician', 'noDefense']);
    expect(parseCardNames("צ'יטה, מדויק")).toEqual(['cheetah', 'sniper']);
    expect(parseCardNames('צ׳יטה כוכב')).toEqual(['cheetah', 'captain']);
    expect(parseCardNames('נגמר אחרי 5 דקות, מפחד מהכדור')).toEqual(['tired', 'scared']);
    expect(parseCardNames('נגמר מפחד')).toEqual(['tired', 'scared']);
    expect(parseCardNames('איטי מתחיל מוח')).toEqual(['slow', 'beginner', 'brain']);
    expect(parseCardNames('גורילה חמור')).toEqual(['beast', 'donkey']);
    // Opposites resolve as if tapped in order.
    expect(parseCardNames('מדויק חמור')).toEqual(['donkey']);
  });
  it('still reads the old names', () => {
    expect(parseCardNames('הקוסם לא חוזר להגנה')).toEqual(['magician', 'noDefense']);
    expect(parseCardNames('החיה הצלף הקפטן')).toEqual(['beast', 'sniper', 'captain']);
    expect(parseCardNames('המוח לא חוזר')).toEqual(['brain', 'noDefense']);
    expect(parseCardNames('הסלע')).toEqual([]);
  });
  it('parses a roster with weakness cards (CSV and free text)', () => {
    const { players } = parseRoster('שם,רמה,שוער,כרטיסיות\nדני,5,שוער,איטי\nגיל,3,,מתחיל; מפחד מהכדור\nרון 4 נגמר אחרי 5 דקות\n');
    expect(players.map((x) => x.cards)).toEqual([['slow'], ['beginner', 'scared'], ['tired']]);
    expect(players[0].canGK).toBe(true);
    expect(players[2].attrs.overall).toBe(4);
    expect(players[2].attrs.stamina).toBe(1);
  });
});
