import { describe, expect, it } from 'vitest';
import { applyCards, toggleCard } from './cards';
import { lateJoin } from './late';
import { INITIAL_STATE, NEW_DAY_MS, defaultAttrs, sanitize, type AppState, type GameResult, type Player } from './model';
import { decodeBackup, encodeBackup, makeBackup, mergePlayers, parseRoster } from './io';
import { reducer } from './reducer';
import { orderBySize } from './split';

const p = (id: string, level = 5): Player => ({ id, name: id, attrs: defaultAttrs(level), canGK: false, cards: [] });
const NOW = 1_800_000_000_000;

function result(teams: string[][], teamSize: number, subs: string[] = []): GameResult {
  const playerIds = teams.flat();
  const assignment = teams.flatMap((t, i) => t.map(() => i));
  return {
    playerIds,
    subIds: subs,
    teamSize,
    numTeams: teams.length,
    sizes: teams.map((t) => t.length),
    assignment,
    generated: assignment,
    pool: [],
    shown: [],
    gkOrder: teams.map((t) => [...t]),
    createdAt: 0,
  };
}

describe('sanitize / migration', () => {
  it('returns defaults for garbage', () => {
    expect(sanitize(null)).toEqual(INITIAL_STATE);
    expect(sanitize('x')).toEqual(INITIAL_STATE);
  });
  it('migrates a v1 blob (coordination → passing, drops v1 result)', () => {
    const s = sanitize(
      {
        version: 1,
        players: [{ id: 'a', name: 'A', attrs: { overall: 99, coordination: 3, goalkeeping: 9 }, canGK: true }, { bad: true }],
        presentIds: ['a', 'zzz'],
        numTeams: 3,
        constraints: { together: [['a', 'zzz']], apart: [] },
        result: { playerIds: ['a'], assignment: [0] },
      },
      NOW,
    );
    expect(s.version).toBe(2);
    expect(s.players).toHaveLength(1);
    expect(s.players[0].attrs.overall).toBe(10);
    expect(s.players[0].attrs.passing).toBe(3);
    expect(s.players[0].cards).toEqual([]);
    expect(s.presentIds).toEqual(['a']);
    expect(s.teamSize).toBe(5);
    expect(s.constraints.together).toEqual([]);
    expect(s.result).toBeNull();
  });
  it('a new game day starts with empty attendance and keeps "last time"', () => {
    const s = sanitize({ version: 2, players: [p('a')], presentIds: ['a'], dayAt: NOW - NEW_DAY_MS - 1 }, NOW);
    expect(s.presentIds).toEqual([]);
    expect(s.lastPresentIds).toEqual(['a']);
    const same = sanitize({ version: 2, players: [p('a')], presentIds: ['a'], dayAt: NOW - 1000 }, NOW);
    expect(same.presentIds).toEqual(['a']);
  });
});

describe('cards', () => {
  it('start every attribute at the level and apply deltas, clamped', () => {
    const a = applyCards(8, ['beast', 'noPass']);
    expect(a.overall).toBe(8);
    expect(a.stamina).toBe(10);
    expect(a.passing).toBe(5);
    expect(a.teamwork).toBe(6);
    expect(applyCards(1, ['noPass']).passing).toBe(1);
  });
  it('at most three cards', () => {
    expect(toggleCard(['beast', 'rock', 'slow'], 'sniper')).toEqual(['rock', 'slow', 'sniper']);
    expect(toggleCard(['beast'], 'beast')).toEqual([]);
  });
});

describe('late arrivals', () => {
  it('join the short team outside; completing it is "filled"', () => {
    const r = result([['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h'], ['i', 'j']], 4);
    const one = lateJoin(r, 'x', 1);
    expect(one.outcome).toBe('waiting');
    expect(one.team).toBe(2);
    const two = lateJoin(one.result, 'y', 1);
    expect(two.outcome).toBe('filled');
    expect(two.result.gkOrder[2]).toEqual(['i', 'j', 'x', 'y']);
  });
  it('wait as subs when teams are full; enough subs become a new team', () => {
    let r = result([['a', 'b', 'c', 'd', 'e'], ['f', 'g', 'h', 'i', 'j']], 5);
    let j = lateJoin(r, 'x', 1);
    expect(j.outcome).toBe('bench');
    expect(j.result.subIds).toEqual(['x']);
    j = lateJoin(j.result, 'y', 1);
    expect(j.outcome).toBe('bench');
    j = lateJoin(j.result, 'z', 1);
    expect(j.outcome).toBe('newTeam');
    expect(j.result.numTeams).toBe(3);
    expect(j.result.subIds).toEqual([]);
    r = j.result;
    j = lateJoin(lateJoin(r, 'w', 1).result, 'v', 1);
    expect(j.outcome).toBe('filled');
  });
  it('fills a reduced split (4v4 when 5-a-side was chosen) evenly', () => {
    const r = result([['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']], 5);
    const j1 = lateJoin(r, 'x', 1);
    expect(j1.outcome).toBe('waiting');
    expect(lateJoin(j1.result, 'y', 1).outcome).toBe('filled');
  });
});

describe('reducer', () => {
  it('deleting a player cleans attendance, constraints and results', () => {
    let s = reducer(INITIAL_STATE, { type: 'addPlayer', player: p('a'), present: true });
    s = reducer(s, { type: 'addPlayer', player: p('b'), present: true });
    s = reducer(s, { type: 'addConstraint', kind: 'together', pair: ['a', 'b'] });
    s = { ...s, result: result([['a'], ['b']], 5) } as AppState;
    s = reducer(s, { type: 'deletePlayer', id: 'a' });
    expect(s.presentIds).toEqual(['b']);
    expect(s.constraints.together).toEqual([]);
    expect(s.result).toBeNull();
  });
  it('a pair cannot be both together and apart', () => {
    let s = reducer(INITIAL_STATE, { type: 'addConstraint', kind: 'together', pair: ['a', 'b'] });
    s = reducer(s, { type: 'addConstraint', kind: 'apart', pair: ['b', 'a'] });
    expect(s.constraints).toEqual({ together: [], apart: [['b', 'a']] });
  });
  it('swap keeps keeper slots; reset restores', () => {
    let s: AppState = { ...INITIAL_STATE, result: result([['a', 'b'], ['c', 'd']], 2) };
    s = reducer(s, { type: 'swap', i: 0, j: 2 });
    expect(s.result!.assignment).toEqual([1, 0, 0, 1]);
    expect(s.result!.gkOrder).toEqual([['c', 'b'], ['a', 'd']]);
    s = reducer(s, { type: 'resetSwaps' });
    expect(s.result!.assignment).toEqual([0, 0, 1, 1]);
    expect(s.result!.gkOrder.map((l) => [...l].sort())).toEqual([['a', 'b'], ['c', 'd']]);
  });
  it('swapping a sub in', () => {
    let s: AppState = { ...INITIAL_STATE, result: result([['a', 'b'], ['c', 'd']], 2, ['x']) };
    s = reducer(s, { type: 'swapSub', subId: 'x', i: 1 });
    expect(s.result!.playerIds).toEqual(['a', 'x', 'c', 'd']);
    expect(s.result!.subIds).toEqual(['b']);
    expect(s.result!.gkOrder[0]).toEqual(['a', 'x']);
  });
  it('loading the sample squad keeps own players', () => {
    let s = reducer(INITIAL_STATE, { type: 'addPlayer', player: p('mine'), present: true });
    s = reducer(s, { type: 'loadSample', now: 1 });
    s = reducer(s, { type: 'loadSample', now: 1 });
    expect(s.players.filter((x) => x.id === 'mine')).toHaveLength(1);
    expect(s.players).toHaveLength(15);
    expect(s.presentIds).toContain('mine');
  });
});

describe('roster import', () => {
  it('parses free text and CSV', () => {
    const { players, skipped } = parseRoster(
      '﻿שם,רמה,שוער,כרטיסיות\nאבי,8,,הקפטן\nדני הקטן 6 שוער החיה\nיוסי\nגל; 7; ; לא מוסר\nאבי 3\nרון 14\n',
      [],
    );
    expect(players.map((x) => x.name)).toEqual(['אבי', 'דני הקטן', 'יוסי', 'גל']);
    expect(players[0].attrs.overall).toBe(8);
    expect(players[0].cards).toEqual(['captain']);
    expect(players[1].canGK).toBe(true);
    expect(players[1].cards).toEqual(['beast']);
    expect(players[2].attrs.overall).toBe(5);
    expect(players[3].cards).toEqual(['noPass']);
    expect(skipped.map((x) => x.reason)).toEqual(['השם כבר קיים', 'רמה חייבת להיות 1–10']);
  });
  it('skips names already in the roster', () => {
    expect(parseRoster('אבי 5', ['אבי']).players).toEqual([]);
  });
  it('merges by id or name', () => {
    const m = mergePlayers([p('a'), { ...p('b'), name: 'Bob' }], [{ ...p('zzz', 9), name: 'Bob' }, p('c')]);
    expect(m.added).toBe(1);
    expect(m.updated).toBe(1);
    expect(m.players.find((x) => x.name === 'Bob')!.attrs.overall).toBe(9);
    expect(m.players.find((x) => x.name === 'Bob')!.id).toBe('b');
  });
  it('backup link round-trips', async () => {
    const b = makeBackup([{ ...p('a', 7), name: 'אבי', cards: ['rock'] }], { together: [], apart: [] }, INITIAL_STATE.settings, 5);
    const enc = await encodeBackup(b);
    expect(enc).toMatch(/^[zj]\./);
    expect(await decodeBackup(enc)).toEqual(b);
    expect(await decodeBackup('z.garbage')).toBeNull();
  });
});

describe('orderBySize', () => {
  it('puts the short team last', () => {
    expect(orderBySize([0, 1, 1, 2, 2, 0, 1, 2], 3)).toEqual([2, 0, 0, 1, 1, 2, 0, 1]);
  });
});

describe('look (theme and accent)', () => {
  it('defaults to following the phone, green; bad values fall back', () => {
    const s = sanitize({ version: 2, players: [], settings: { theme: 'neon', accent: 'gold' } });
    expect(s.settings.theme).toBe('auto');
    expect(s.settings.accent).toBe('green');
    const t = sanitize({ version: 2, players: [], settings: { theme: 'light', accent: 'blue' } });
    expect(t.settings).toMatchObject({ theme: 'light', accent: 'blue' });
  });

  it("an imported backup keeps this phone's look", () => {
    const mine: AppState = { ...INITIAL_STATE, settings: { ...INITIAL_STATE.settings, theme: 'light', accent: 'pink' } };
    const theirs = { ...INITIAL_STATE.settings, theme: 'dark' as const, accent: 'blue' as const, matchMinutes: 12 };
    const next = reducer(mine, { type: 'importPlayers', players: [p('a')], settings: theirs });
    expect(next.settings).toMatchObject({ theme: 'light', accent: 'pink', matchMinutes: 12 });
  });
});
