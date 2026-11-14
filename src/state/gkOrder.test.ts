import { describe, expect, it } from 'vitest';
import { createRng } from '../engine';
import { keeperAt, rotation, startSession, swapKeepers } from '../match/match';
import { liveFromState } from '../sync/live';
import { parsePublic } from '../sync/players';
import { keepKeeper, subIn } from './leave';
import { DEFAULT_SETTINGS, INITIAL_STATE, defaultAttrs, noGKIds, sanitizePlayer, withNoGK, type AppState, type GameResult, type Player } from './model';
import { reducer } from './reducer';
import { keeperOrder } from './split';

const p = (id: string, extra: Partial<Player> = {}): Player => ({ id, name: id, attrs: defaultAttrs(5), canGK: false, cards: [], ...extra });

function result(teams: string[][], subs: string[] = []): GameResult {
  const playerIds = teams.flat();
  const assignment = teams.flatMap((t, i) => t.map(() => i));
  return {
    playerIds,
    subIds: subs,
    teamSize: Math.max(...teams.map((t) => t.length)),
    numTeams: teams.length,
    sizes: teams.map((t) => t.length),
    assignment,
    generated: assignment,
    pool: [],
    shown: [],
    gkOrder: teams.map((t) => [...t]),
    createdAt: 1,
  };
}

describe('keeper rotation skips "לא בשער"', () => {
  const out = new Set(['b']);
  it('rotation leaves them out, or keeps everyone if nobody is left', () => {
    expect(rotation(['a', 'b', 'c'], out)).toEqual(['a', 'c']);
    expect(rotation(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(rotation(['b'], out)).toEqual(['b']);
  });
  it('keeperAt: now and next, every N goals conceded', () => {
    expect(keeperAt(['a', 'b', 'c'], 0, 1, true, out)).toEqual({ now: 'a', next: 'c' });
    expect(keeperAt(['a', 'b', 'c'], 1, 1, true, out)).toEqual({ now: 'c', next: 'a' });
    expect(keeperAt(['a', 'b', 'c'], 2, 1, true, out)).toEqual({ now: 'a', next: 'c' });
    expect(keeperAt(['a', 'b', 'c'], 3, 2, true, out)).toEqual({ now: 'c', next: 'a' });
  });
  it('fixed keeper: the first one who goes in goal stays, no next', () => {
    expect(keeperAt(['b', 'a', 'c'], 5, 1, false, out)).toEqual({ now: 'a', next: null });
    expect(keeperAt([], 0, 1, true)).toEqual({ now: null, next: null });
  });
});

describe('keeper order editing', () => {
  it('swapKeepers swaps two players and nothing else', () => {
    expect(swapKeepers(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['c', 'b', 'a', 'd']);
    expect(swapKeepers(['a', 'b'], 'a', 'x')).toEqual(['a', 'b']);
  });
  it('reducer swapKeepers writes result.gkOrder for that team only', () => {
    const s: AppState = { ...INITIAL_STATE, players: ['a', 'b', 'c', 'd'].map((id) => p(id)), result: result([['a', 'b'], ['c', 'd']]) };
    const next = reducer(s, { type: 'swapKeepers', team: 1, a: 'c', b: 'd' });
    expect(next.result!.gkOrder).toEqual([['a', 'b'], ['d', 'c']]);
    // An old result without an order for that team: built from the team first.
    const bare = reducer({ ...s, result: { ...s.result!, gkOrder: [] } }, { type: 'swapKeepers', team: 0, a: 'a', b: 'b' });
    expect(bare.result!.gkOrder).toEqual([['b', 'a'], []]);
  });
});

describe('keeper order generation', () => {
  it('"לא בשער" players go last; the shuffle is the same as without them', () => {
    const plain = ['a', 'b', 'c', 'd', 'e'].map((id) => p(id));
    const marked = plain.map((x) => (x.id === 'a' || x.id === 'c' ? p(x.id, { noGK: true }) : x));
    const base = keeperOrder(plain, 'rotate', createRng(7));
    const got = keeperOrder(marked, 'rotate', createRng(7));
    expect(got.slice(0, 3)).toEqual(base.filter((id) => id !== 'a' && id !== 'c'));
    expect(new Set(got.slice(3))).toEqual(new Set(['a', 'c']));
  });
  it('fixed mode: declared keepers first, "לא בשער" last', () => {
    const got = keeperOrder([p('a', { noGK: true }), p('b'), p('c', { canGK: true })], 'fixed', createRng(3));
    expect(got[0]).toBe('c');
    expect(got[2]).toBe('a');
  });
});

describe('roster changes keep the keeper, skipping "לא בשער"', () => {
  it('a sub who is "לא בשער" joins after the rotation; the keeper in goal stays', () => {
    const out = new Set(['x']);
    const next = keepKeeper(['a', 'b', 'c'], ['a', 'b', 'c', 'x'], 1, 1, true, out);
    expect(keeperAt(next, 1, 1, true, out).now).toBe('b');
    expect(next.at(-1)).toBe('x');
  });
  it('subIn passes "לא בשער" on', () => {
    const r = result([['a', 'b', 'n'], ['c', 'd', 'e']], ['s']);
    const m = { ...startSession(2), conceded: [1, 0] };
    const out = new Set(['n']);
    const r2 = subIn(r, m, 's', 0, { rotate: true, every: 1, noGK: out });
    expect(keeperAt(r2.gkOrder[0], 1, 1, true, out).now).toBe('b');
  });
});

describe('the field survives', () => {
  it('sanitizePlayer keeps noGK only when true', () => {
    expect(sanitizePlayer({ id: 'a', name: 'A', noGK: true })?.noGK).toBe(true);
    expect('noGK' in sanitizePlayer({ id: 'a', name: 'A', noGK: false })!).toBe(false);
    expect('noGK' in sanitizePlayer({ id: 'a', name: 'A' })!).toBe(false);
  });
  it('withNoGK marks (dropping 🧤) and unmarks', () => {
    const on = withNoGK(p('a', { canGK: true }), true);
    expect(on).toMatchObject({ noGK: true, canGK: false });
    expect('noGK' in withNoGK(on, false)).toBe(false);
    expect([...noGKIds([on, p('b')])]).toEqual(['a']);
  });
  it('the public roster keeps it; the live snapshot skips such a keeper', () => {
    const pub = parsePublic({ groupId: 'g', name: 'G', me: {}, players: [{ id: 'a', name: 'A', noGK: true }, { id: 'b', name: 'B' }], history: [] });
    expect(pub?.players.map((x) => x.noGK)).toEqual([true, undefined]);
    const live = liveFromState({
      result: result([['a', 'b'], ['c', 'd']]),
      match: null,
      players: [p('a', { noGK: true }), p('b'), p('c'), p('d')],
      settings: DEFAULT_SETTINGS,
      now: 1,
    });
    expect(live?.teams.map((t) => t.keeper)).toEqual(['b', 'c']);
  });
});
