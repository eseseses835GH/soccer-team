import { describe, expect, it } from 'vitest';
import { byPlayed, checkInList, makeRegular, newGuest, pickOrder, splitRoster, withoutGuests } from './guests';
import { INITIAL_STATE, defaultAttrs, sanitize, sanitizePlayer, type Player } from './model';
import { makeBackup, parseBackup } from './io';
import { docFromState, mergeDocs, sanitizeDoc } from '../sync/doc';
import { parsePublic, rateable } from '../sync/players';
import { publicToState, rateCard, surveyList, withGuest } from '../sync/playerGroup';
import { arrivalChoices } from '../sync/runnerLate';
import { DEFAULT_SETTINGS, type GameResult } from './model';

const p = (id: string, occasional = false): Player => ({ id, name: id, attrs: defaultAttrs(5), canGK: false, cards: [], ...(occasional ? { occasional: true as const } : {}) });
const ev = (endedAt: number, ids: string[]) => ({ endedAt, players: ids.map((id) => ({ id, name: id })) });

describe('guests: lists', () => {
  const roster = [p('dan'), p('avi'), p('g1', true), p('g2', true)];

  it('check-in shows regulars, and a guest only when he is here tonight', () => {
    expect(checkInList(roster, []).map((x) => x.id)).toEqual(['dan', 'avi']);
    expect(checkInList(roster, ['g2']).map((x) => x.id)).toEqual(['dan', 'avi', 'g2']);
  });

  it('"same as last time" brings back only the regulars', () => {
    expect(withoutGuests(['dan', 'g1', 'avi'], roster)).toEqual(['dan', 'avi']);
  });

  it('players screen: regulars A–Z, guests apart', () => {
    const { regulars, guests } = splitRoster(roster);
    expect(regulars.map((x) => x.id)).toEqual(['avi', 'dan']);
    expect(guests.map((x) => x.id)).toEqual(['g1', 'g2']);
  });

  it('guests by how much they played: most evenings first, ties by the latest evening, then A–Z', () => {
    const gs = [p('a', true), p('b', true), p('c', true), p('d', true)];
    const history = [ev(30, ['b', 'c']), ev(20, ['c']), ev(10, ['a', 'b'])];
    // c: 2 (last 30), b: 2 (last 30) → A–Z; a: 1; d: never.
    expect(byPlayed(gs, history).map((x) => x.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(byPlayed(gs, [ev(5, ['a', 'd']), ev(9, ['d', 'b']), ev(1, ['a'])]).map((x) => x.id)).toEqual(['d', 'a', 'b', 'c']); // both 2, d played last
    expect(byPlayed(gs, [ev(5, ['a']), ev(9, ['d'])]).map((x) => x.id)).toEqual(['d', 'a', 'b', 'c']);
    expect(splitRoster(gs, history).guests.map((x) => x.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('pickers ("מישהו הגיע?"): regulars A–Z, then guests in the same order', () => {
    const all = [p('zed'), p('amy'), p('g1', true), p('g2', true)];
    expect(pickOrder(all, [ev(1, ['g2'])]).map((x) => x.id)).toEqual(['amy', 'zed', 'g2', 'g1']);
    const r: GameResult = { playerIds: ['amy'], subIds: [], teamSize: 1, numTeams: 1, sizes: [1], assignment: [0], generated: [0], pool: [], shown: [], gkOrder: [['amy']], createdAt: 1 };
    expect(arrivalChoices(all, r, [ev(1, ['g2'])]).roster.map((x) => x.id)).toEqual(['zed', 'g2', 'g1']);
  });

  it('a new guest: level as given (5 by default), not a keeper, flagged; "להפוך לקבוע" drops the flag', () => {
    const g = newGuest('x', '  יוסי   כהן ');
    expect(g).toMatchObject({ id: 'x', name: 'יוסי כהן', canGK: false, cards: [], occasional: true });
    expect(g.attrs.overall).toBe(5);
    expect(newGuest('y', 'a', 7, 'u1')).toMatchObject({ attrs: { overall: 7 }, levelVotes: { u1: 7 } });
    const r = makeRegular(g);
    expect('occasional' in r).toBe(false);
    expect(r.name).toBe('יוסי כהן');
  });
});

describe('guests: the flag survives loading, backups and sync', () => {
  it('sanitizePlayer keeps occasional: true and drops anything else', () => {
    expect(sanitizePlayer({ ...p('g'), occasional: true })?.occasional).toBe(true);
    expect('occasional' in sanitizePlayer({ ...p('g'), occasional: 'yes' })!).toBe(false);
    expect('occasional' in sanitizePlayer(p('r'))!).toBe(false);
  });

  it('saved state, backups and the synced doc keep it', () => {
    const players = [p('r'), p('g', true)];
    expect(sanitize({ ...INITIAL_STATE, players }).players[1].occasional).toBe(true);
    expect(parseBackup(JSON.parse(JSON.stringify(makeBackup(players, { together: [], apart: [] }, DEFAULT_SETTINGS))))!.players[1].occasional).toBe(true);
    const doc = docFromState({ ...INITIAL_STATE, players });
    expect(sanitizeDoc(JSON.parse(JSON.stringify(doc))).players[1].occasional).toBe(true);
  });

  it('a guest added on the server is kept by the merge, with his flag', () => {
    const base = docFromState({ ...INITIAL_STATE, players: [p('r')] });
    const remote = { ...base, players: [...base.players, p('g', true)] };
    const local = { ...base, players: [...base.players, p('mine')] };
    const merged = mergeDocs(base, local, remote);
    expect(merged.players.map((x) => x.id)).toEqual(['r', 'mine', 'g']);
    expect(merged.players.find((x) => x.id === 'g')?.occasional).toBe(true);
  });
});

describe('guests: players phones (public copy) and rating', () => {
  const pub = parsePublic({
    groupId: 'g',
    name: 'x',
    players: [{ id: 'me', name: 'me' }, { id: 'a', name: 'a' }, { id: 'gg', name: 'gg', occasional: true }, { id: 'bad', name: 'bad', occasional: 1 }],
    history: [],
    claimed: ['me'],
    me: { role: 'player', playerId: 'me', canRate: true },
  })!;

  it('parsePublic keeps the flag (true only), publicToState carries it', () => {
    expect(pub.players.find((x) => x.id === 'gg')?.occasional).toBe(true);
    expect('occasional' in pub.players.find((x) => x.id === 'bad')!).toBe(false);
    expect(publicToState(INITIAL_STATE, pub).players.find((x) => x.id === 'gg')?.occasional).toBe(true);
  });

  it('nobody rates a guest: not in the survey, not counted on the home card', () => {
    expect(rateable(pub.players, 'me').map((x) => x.id)).toEqual(['a', 'bad']);
    expect(surveyList(pub).map((x) => x.id)).toEqual(['a', 'bad']);
    const onlyGuests = { ...pub, players: [{ id: 'me', name: 'me' }, { id: 'gg', name: 'gg', occasional: true as const }] };
    expect(rateCard(onlyGuests, {})).toBe('none');
  });

  it('withGuest: the public copy has him (as a guest) right away', () => {
    const next = withGuest(pub, 'new', 'New');
    expect(next.players.at(-1)).toEqual({ id: 'new', name: 'New', occasional: true });
    expect(withGuest(next, 'new', 'New')).toBe(next);
  });
});
