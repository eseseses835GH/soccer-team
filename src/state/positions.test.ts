import { describe, expect, it } from 'vitest';
import { createRng } from '../engine';
import { ROSTER_TEMPLATE, parseBackup, parseRoster } from './io';
import { defaultAttrs, sanitize, sanitizePlayer, type Player } from './model';
import { positionEmojis, sanitizePositions, togglePosition } from './positions';
import { sampleSquad } from './sample';
import { keeperOrder } from './split';

const pl = (id: string, canGK = false): Player => ({ id, name: id, attrs: defaultAttrs(5), canGK, positions: [], cards: [] });

describe('positions on a player', () => {
  it('drops unknown values and duplicates, keeps a fixed order', () => {
    expect(sanitizePositions(['att', 'def', 'att', 'gk', 'striker', 7])).toEqual(['def', 'att']);
    expect(sanitizePositions('def')).toEqual([]);
    expect(togglePosition(['att'], 'def')).toEqual(['def', 'att']);
    expect(togglePosition(['def', 'att'], 'def')).toEqual(['att']);
  });

  it('old players (no positions) migrate to none; keeper stays canGK', () => {
    const p = sanitizePlayer({ id: 'a', name: 'A', attrs: { overall: 7 }, canGK: true, cards: [] })!;
    expect(p.positions ?? []).toEqual([]);
    expect(p).not.toHaveProperty('positions'); // unchanged shape: no sync churn
    expect(sanitizePlayer({ ...p, positions: [] })).toEqual(p);
    expect(p.canGK).toBe(true);
    const s = sanitize({ version: 2, players: [{ id: 'b', name: 'B', attrs: { overall: 6 }, canGK: false, cards: [], positions: ['mid', 'nope'] }] });
    expect(s.players[0].positions).toEqual(['mid']);
  });

  it('emojis: keeper first, then back to front', () => {
    expect(positionEmojis({ canGK: true, positions: ['att', 'def'] }).map((x) => x.emoji)).toEqual(['🧤', '🛡️', '⚡']);
    expect(positionEmojis({ canGK: false })).toEqual([]);
  });

  it('travel in the backup', () => {
    const b = parseBackup({ app: 'kochot', players: [{ id: 'a', name: 'A', attrs: { overall: 5 }, canGK: false, cards: [], positions: ['def'] }] })!;
    expect(b.players[0].positions).toEqual(['def']);
  });
});

describe('roster import with positions', () => {
  it('reads position words (and synonyms) in free text and CSV', () => {
    const { players } = parseRoster('אבי 8 הגנה קישור\nדני, 6, שוער, חלוץ, החיה\nנועם 7 בלם כנף\nיוסי 5 קשר\nגיל, 5, , לא חוזר להגנה');
    const byName = Object.fromEntries(players.map((p) => [p.name, p]));
    expect(byName['אבי'].positions).toEqual(['def', 'mid']);
    expect(byName['דני'].positions).toEqual(['att']);
    expect(byName['דני'].canGK).toBe(true);
    expect(byName['דני'].cards).toEqual(['beast']);
    expect(byName['נועם'].positions).toEqual(['def', 'att']);
    expect(byName['יוסי'].positions).toEqual(['mid']);
    // "לא חוזר להגנה" is a card, not the defence position.
    expect(byName['גיל'].positions ?? []).toEqual([]);
    expect(byName['גיל'].cards).toEqual(['noDefense']);
  });

  it('the downloadable template parses as documented', () => {
    const { players, skipped } = parseRoster(ROSTER_TEMPLATE);
    expect(skipped).toEqual([]);
    expect(players.map((p) => [p.name, p.canGK, p.positions ?? []])).toEqual([
      ['אבי', false, ['mid']],
      ['דני', true, ['def']],
      ['נועם', false, ['att']],
      ['ליאור', false, ['def', 'mid']],
      ['גיל', false, []],
    ]);
  });
});

describe('keeper order', () => {
  it('rotating keepers: someone good in goal starts, everyone still takes a turn', () => {
    const team = [pl('a'), pl('b'), pl('k', true), pl('c')];
    for (let seed = 1; seed < 20; seed++) {
      const order = keeperOrder(team, 'rotate', createRng(seed));
      expect(order[0]).toBe('k');
      expect([...order].sort()).toEqual(['a', 'b', 'c', 'k']);
    }
  });

  it('rotating keepers without a keeper stays random', () => {
    const team = [pl('a'), pl('b'), pl('c'), pl('d')];
    const firsts = new Set(Array.from({ length: 30 }, (_, s) => keeperOrder(team, 'rotate', createRng(s))[0]));
    expect(firsts.size).toBeGreaterThan(1);
  });
});

describe('sample squad', () => {
  it('has positions to show the spread', () => {
    expect(sampleSquad().filter((p) => p.positions?.length).length).toBeGreaterThan(8);
  });
});
