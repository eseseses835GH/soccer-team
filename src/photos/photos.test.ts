import { describe, expect, it } from 'vitest';
import { cardScore, newPhotoVersion, photoPath, sanitizeCard, sanitizePhoto } from './style';
import { sanitizePlayer, type Player } from '../state/model';
import { mergeDocs, sanitizeDoc, type SyncDoc } from '../sync/doc';
import { parsePublic } from '../sync/players';
import { publicToState } from '../sync/playerGroup';
import { INITIAL_STATE } from '../state/model';

const P = (id: string, extra: Partial<Player> = {}): Player =>
  sanitizePlayer({ id, name: id.toUpperCase(), attrs: { overall: 5 }, canGK: false, cards: [], ...extra })!;
const doc = (players: Player[]): SyncDoc => sanitizeDoc({ v: 1, players });

describe('photo / card sanitize', () => {
  it('keeps a valid version only', () => {
    expect(sanitizePhoto('lz3k9a')).toBe('lz3k9a');
    expect(sanitizePhoto('')).toBeUndefined();
    expect(sanitizePhoto('ABC')).toBeUndefined();
    expect(sanitizePhoto('a/b')).toBeUndefined();
    expect(sanitizePhoto('x'.repeat(21))).toBeUndefined();
    expect(sanitizePhoto(12)).toBeUndefined();
    expect(newPhotoVersion(1_700_000_000_000)).toMatch(/^[0-9a-z]{1,20}$/);
  });

  it('keeps known card keys of the right type', () => {
    expect(sanitizeCard({ shirt: 'red', pattern: 'stripes', number: 10, level: 9 })).toEqual({ shirt: 'red', pattern: 'stripes', number: 10 });
    expect(sanitizeCard({ shirt: 'x'.repeat(21), number: 0 })).toBeUndefined();
    expect(sanitizeCard({ number: 100 })).toBeUndefined();
    expect(sanitizeCard({ number: 7.5 })).toBeUndefined();
    expect(sanitizeCard({ number: '7' })).toBeUndefined();
    expect(sanitizeCard({ shirt: '<b>' })).toBeUndefined();
    expect(sanitizeCard([1])).toBeUndefined();
    expect(sanitizeCard(null)).toBeUndefined();
  });

  it('player sanitize keeps photo and card, drops bad ones', () => {
    const p = sanitizePlayer({ id: 'a', name: 'A', photo: 'abc1', card: { shirt: 'blue', number: 7 } })!;
    expect(p.photo).toBe('abc1');
    expect(p.card).toEqual({ shirt: 'blue', number: 7 });
    const q = sanitizePlayer({ id: 'a', name: 'A', photo: 5, card: { number: 'x' } })!;
    expect('photo' in q || 'card' in q).toBe(false);
  });

  it('card score maps level 1–10 to 70–99', () => {
    expect(cardScore(1)).toBe(70);
    expect(cardScore(10)).toBe(99);
    expect(cardScore(5)).toBe(83);
    expect(cardScore(6.5)).toBe(88);
    expect(cardScore(0)).toBe(70);
    expect(cardScore(12)).toBe(99);
    expect(cardScore(NaN)).toBe(70);
  });

  it('path', () => {
    expect(photoPath('g', 'p1')).toBe('g/p1.webp');
  });
});

describe('photo / card in organizer merges', () => {
  it('a photo set on the server survives a local edit of the same player', () => {
    const base = doc([P('a')]);
    const local = doc([P('a', { name: 'Avi' })]);
    const remote = doc([P('a', { photo: 'v2', card: { number: 9 } })]);
    const m = mergeDocs(base, local, remote).players[0];
    expect(m.name).toBe('Avi');
    expect(m.photo).toBe('v2');
    expect(m.card).toEqual({ number: 9 });
  });

  it('with level votes too', () => {
    const base = doc([P('a', { levelVotes: { u1: 5 } })]);
    const local = doc([P('a', { levelVotes: { u1: 7 } })]);
    const remote = doc([P('a', { levelVotes: { u1: 5, u2: 6 }, photo: 'v3' })]);
    expect(mergeDocs(base, local, remote).players[0].photo).toBe('v3');
  });

  it('an organizer phone that lost the fields never wipes them', () => {
    const base = doc([P('a', { photo: 'v1' })]);
    const local = doc([P('a', { name: 'Avi' })]); // an edit on a copy without photo
    const remote = doc([P('a', { photo: 'v1' })]);
    expect(mergeDocs(base, local, remote).players[0].photo).toBe('v1');
  });

  it('a removal on the server is taken', () => {
    const base = doc([P('a', { photo: 'v1' })]);
    const local = doc([P('a', { photo: 'v1', name: 'Avi' })]);
    const remote = doc([P('a', { name: 'A2' })]);
    expect(mergeDocs(base, local, remote).players[0].photo).toBeUndefined();
  });

  it('untouched locally: the server copy comes in; untouched remotely: nothing changes', () => {
    const base = doc([P('a'), P('b', { photo: 'v1' })]);
    const local = doc([P('a'), P('b', { photo: 'v1', canGK: true })]);
    const remote = doc([P('a', { photo: 'v9' }), P('b', { photo: 'v1' })]);
    const m = mergeDocs(base, local, remote).players;
    expect(m[0].photo).toBe('v9');
    expect(m[1].photo).toBe('v1');
    expect(m[1].canGK).toBe(true);
  });

  it('a doc round trip keeps them', () => {
    const d = doc([P('a', { photo: 'v1', card: { shirt: 'red' } })]);
    expect(sanitizeDoc(JSON.parse(JSON.stringify(d))).players[0]).toMatchObject({ photo: 'v1', card: { shirt: 'red' } });
  });
});

describe('public copy', () => {
  it('parses photo, card and score; drops bad values', () => {
    const pub = parsePublic({
      groupId: 'g',
      players: [
        { id: 'a', name: 'A', photo: 'v1', card: { shirt: 'red', number: 10 }, score: 83 },
        { id: 'b', name: 'B', photo: 'BAD', card: 'x', score: 50 },
      ],
      me: {},
    })!;
    expect(pub.players[0]).toEqual({ id: 'a', name: 'A', photo: 'v1', card: { shirt: 'red', number: 10 }, score: 83 });
    expect(pub.players[1]).toEqual({ id: 'b', name: 'B' });
    const st = publicToState(INITIAL_STATE, pub);
    expect(st.players[0].photo).toBe('v1');
    expect(st.players[0].card).toEqual({ shirt: 'red', number: 10 });
  });
});
