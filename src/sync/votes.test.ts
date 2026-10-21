import { describe, expect, it } from 'vitest';
import { applyCards } from '../state/cards';
import { INITIAL_STATE, defaultAttrs, sanitizePlayer, type Player } from '../state/model';
import { averageLevel, mergeVotes, sanitizeVotes, votesLine } from '../state/votes';
import { docFromState, mergeDocs, sanitizeDoc, type SyncDoc } from './doc';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const p = (id: string, level = 5, extra: Partial<Player> = {}): Player => ({ id, name: id, attrs: defaultAttrs(level), canGK: false, cards: [], ...extra });
const doc = (players: Player[]): SyncDoc => docFromState({ ...INITIAL_STATE, players });
/** What an organizer's tap in the edit sheet does: their vote, level = average, attributes rebuilt. */
const vote = (pl: Player, uid: string, v: number): Player => {
  const levelVotes = { ...pl.levelVotes, [uid]: v };
  return { ...pl, levelVotes, attrs: applyCards(averageLevel(levelVotes)!, pl.cards) };
};
/** Through the server and back, like a real round. */
const merge = (base: SyncDoc, local: SyncDoc, remote: SyncDoc) => sanitizeDoc(JSON.parse(JSON.stringify(mergeDocs(base, local, remote))));

describe('votes helpers', () => {
  it('averages, rounding .5 up', () => {
    expect(averageLevel(undefined)).toBeNull();
    expect(averageLevel({ [A]: 6, [B]: 7 })).toBe(7);
    expect(averageLevel({ [A]: 6, [B]: 6, [C]: 7 })).toBe(6);
    expect(averageLevel({ [A]: 1, [B]: 10 })).toBe(6);
  });
  it('sanitizes: UUID ids, whole 1–10', () => {
    expect(sanitizeVotes({ [A]: 7, [B]: 11, [C]: 6.5, x: 5 })).toEqual({ [A]: 7 });
    expect(sanitizeVotes({ 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA': 3 })).toEqual({ 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': 3 });
    expect(sanitizeVotes({ [B]: '7' })).toBeUndefined();
    expect(sanitizeVotes([7])).toBeUndefined();
    expect(sanitizePlayer({ id: 'x', name: 'X', levelVotes: { [A]: 0 } })).not.toHaveProperty('levelVotes');
    expect(sanitizePlayer({ id: 'x', name: 'X', levelVotes: { [A]: 8 } })?.levelVotes).toEqual({ [A]: 8 });
  });
  it('merges per organizer: union, the side that changed wins', () => {
    expect(mergeVotes({ [A]: 5 }, { [A]: 5, [B]: 8 }, { [A]: 9 })).toEqual({ [A]: 9, [B]: 8 });
    expect(mergeVotes({ [A]: 5 }, { [A]: 6 }, { [A]: 5 })).toEqual({ [A]: 6 });
    expect(mergeVotes(undefined, undefined, undefined)).toBeUndefined();
  });
  it('the line under the level', () => {
    expect(votesLine(undefined, A)).toBe('');
    expect(votesLine({ [A]: 7 }, A)).toBe('');
    expect(votesLine({ [B]: 7 }, A)).toBe('עוד לא דירגת');
    expect(votesLine({ [B]: 7 }, null)).toBe('');
    expect(votesLine({ [A]: 7, [B]: 6, [C]: 4 }, A)).toBe('ממוצע של 3 מארגנים: 6 · שלך: 7');
    expect(votesLine({ [B]: 6, [C]: 5 }, A)).toBe('ממוצע של 2 מארגנים: 6 · עוד לא דירגת');
    expect(votesLine({ [A]: 7, [B]: 6, [C]: 4 }, A, 'מדרגים')).toBe('ממוצע של 3 מדרגים: 6 · שלך: 7');
  });
});

describe('sync: level votes', () => {
  it('two organizers rate the same player at once: both votes kept, level = average', () => {
    const base = doc([p('dani', 5)]);
    const mine = doc([vote(p('dani', 5), A, 8)]);
    const theirs = doc([vote(p('dani', 5), B, 5)]);
    for (const out of [merge(base, mine, theirs), merge(base, theirs, mine)]) {
      expect(out.players[0].levelVotes).toEqual({ [A]: 8, [B]: 5 });
      expect(out.players[0].attrs).toEqual(applyCards(7, [])); // 6.5 → 7
    }
  });

  it('cards follow the level: derived attributes rebuilt from the averaged level', () => {
    const start = p('dani', 5, { cards: ['cheetah'], attrs: applyCards(5, ['cheetah']) });
    const out = merge(doc([start]), doc([vote(start, A, 9)]), doc([vote(start, B, 3)]));
    expect(out.players[0].attrs).toEqual(applyCards(6, ['cheetah']));
  });

  it('hand-tuned sliders stay; only the level moves', () => {
    const tuned = { ...applyCards(5, []), shooting: 9 };
    const start = p('dani', 5, { attrs: tuned, levelVotes: { [A]: 5 } });
    const mine = { ...start, levelVotes: { [A]: 5, [C]: 5 }, name: 'דני' }; // other change on this phone
    const theirs = { ...start, levelVotes: { [A]: 9 }, attrs: { ...tuned, overall: 9 } };
    const out = merge(doc([start]), doc([mine]), doc([theirs]));
    expect(out.players[0].levelVotes).toEqual({ [A]: 9, [C]: 5 });
    expect(out.players[0].attrs).toEqual({ ...tuned, overall: 7 });
  });

  it('a vote on one side + a name change on the other: both kept', () => {
    const start = vote(p('dani', 5), A, 5);
    const renamed = { ...start, name: 'דני הקטן' };
    const voted = vote(start, B, 9);
    for (const out of [merge(doc([start]), doc([renamed]), doc([voted])), merge(doc([start]), doc([voted]), doc([renamed]))]) {
      expect(out.players[0].name).toBe('דני הקטן');
      expect(out.players[0].levelVotes).toEqual({ [A]: 5, [B]: 9 });
      expect(out.players[0].attrs.overall).toBe(7);
    }
  });

  it('a vote changed on one side + a name change on the other (first vote ever): both kept', () => {
    const start = p('dani', 4);
    const out = merge(doc([start]), doc([{ ...start, name: 'דני' }]), doc([vote(start, A, 8)]));
    expect(out.players[0]).toMatchObject({ name: 'דני', levelVotes: { [A]: 8 } });
    expect(out.players[0].attrs.overall).toBe(8);
  });

  it('the same organizer re-rates: the changed side wins', () => {
    const start = vote(vote(p('dani', 5), A, 4), B, 6);
    const out = merge(doc([start]), doc([{ ...start, canGK: true }]), doc([vote(start, A, 8)]));
    expect(out.players[0].levelVotes).toEqual({ [A]: 8, [B]: 6 });
    expect(out.players[0].attrs.overall).toBe(7);
    expect(out.players[0].canGK).toBe(true);
  });

  it('old players without votes: unchanged, and both-changed still means this phone wins', () => {
    const base = doc([p('a', 5), p('b', 6)]);
    const mine = doc([{ ...p('a', 7), name: 'A1' }, p('b', 6)]);
    const theirs = doc([{ ...p('a', 3), canGK: true }, p('b', 6)]);
    const out = merge(base, mine, theirs);
    expect(out.players[0]).toEqual({ ...p('a', 7), name: 'A1' });
    expect(out.players[1]).toEqual(p('b', 6));
    expect(out.players.some((x) => 'levelVotes' in x)).toBe(false);
  });
});
