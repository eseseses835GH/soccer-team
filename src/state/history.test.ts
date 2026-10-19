import { describe, expect, it } from 'vitest';
import { addGoal, endMatch, loserOf, setLastScorer, startClock, startSession, type MatchState } from '../match/match';
import { buildEveningShareText } from '../share';
import {
  stampSides,
  HISTORY_MAX,
  allTimeStats,
  buildEvening,
  eveningId,
  eveningStats,
  hasEveningData,
  leaders,
  mergeHistory,
  sanitizeHistory,
  winPct,
  type EveningRecord,
} from './history';
import { makeBackup, parseBackup } from './io';
import { INITIAL_STATE, NEW_DAY_MS, defaultAttrs, sanitize, type AppState, type GameResult, type Player } from './model';
import { reducer } from './reducer';

const p = (id: string): Player => ({ id, name: `P${id}`, attrs: defaultAttrs(5), canGK: false, cards: [] });
const T0 = 1_800_000_000_000;
const MIN = 60_000;

function result(teams: string[][], subs: string[] = [], createdAt = T0): GameResult {
  const playerIds = teams.flat();
  const assignment = teams.flatMap((t, i) => t.map(() => i));
  return {
    playerIds,
    subIds: subs,
    teamSize: 2,
    numTeams: teams.length,
    sizes: teams.map((t) => t.length),
    assignment,
    generated: assignment,
    pool: [],
    shown: [],
    gkOrder: teams.map((t) => [...t]),
    createdAt,
  };
}

const TEAMS = [
  ['a', 'b'],
  ['c', 'd'],
  ['e', 'f'],
];
const players = ['a', 'b', 'c', 'd', 'e', 'f', 's'].map(p);

function baseState(): AppState {
  return {
    ...INITIAL_STATE,
    players,
    presentIds: players.map((x) => x.id),
    dayAt: T0,
    result: result(TEAMS, ['s']),
    match: startSession(3),
  };
}

/** Play one match through the reducer: `goals` = [team, scorer?][]; the clock runs `mins` minutes. */
function play(s: AppState, goals: [number, string?][], mins = 8): AppState {
  let now = s.dayAt + MIN;
  let m: MatchState = startClock(s.match!, now);
  for (const [team, by] of goals) {
    m = addGoal(m, team, (now += 10_000));
    if (by) m = setLastScorer(m, by);
  }
  now = m.clock.startedAt! + mins * MIN;
  const out = loserOf(m) ?? m.onPitch[0];
  return reducer(s, { type: 'setMatch', match: endMatch(m, out, now), now });
}

describe('evening record', () => {
  it('stamps who played in each match, even after a swap', () => {
    let s = baseState();
    s = play(s, [[0, 'a'], [0, 'b']]); // red beat blue 2:0; blue out, yellow in
    expect(s.match!.history[0].sides).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    s = reducer(s, { type: 'swap', i: 0, j: 4 }); // a ↔ e
    s = play(s, [[2, 'a']]); // yellow (now with a) beats red
    expect(s.match!.history[1].sides).toEqual([
      ['e', 'b'],
      ['a', 'f'],
    ]);
    expect(s.match!.history[1].ms).toBe(8 * MIN);
  });

  it('builds a compact record and stats', () => {
    let s = baseState();
    s = play(s, [[0, 'a'], [0, 'a'], [0, 'b'], [1]]); // red 3:1 blue
    s = play(s, [[0, 'a'], [2, 'e']]); // red 1:1 yellow → draw, red (on longer) leaves
    s = play(s, [[1, 'c']]); // yellow vs blue: blue 1:0
    const rec = buildEvening({ match: s.match!, result: s.result!, players, bibs: ['red', 'blue', 'yellow'], now: s.dayAt })!;
    expect(rec.id).toBe(eveningId(s.result!));
    expect(rec.teams.map((t) => t.bib)).toEqual(['red', 'blue', 'yellow']);
    expect(rec.players.map((x) => x.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 's']);
    expect(rec.matches).toHaveLength(3);
    expect(JSON.parse(JSON.stringify(rec))).toEqual(rec);

    const st = eveningStats(rec);
    expect(st.matches).toBe(3);
    expect(st.goals).toBe(7);
    expect(st.minutes).toBe(24);
    expect(st.table.map((r) => [r.team, r.won, r.drawn, r.lost])).toEqual([
      [0, 1, 1, 0],
      [1, 1, 0, 1],
      [2, 0, 1, 1],
    ]);
    expect(leaders(st.scorers)).toEqual([{ id: 'a', name: 'Pa', n: 3 }]);
    expect(st.biggestWin).toEqual({ index: 0, margin: 2 });
    expect(st.mostGoals).toEqual({ index: 0, total: 4 });
    expect(st.streak).toBeNull();
    expect(st.playerWins.find((x) => x.id === 'a')).toMatchObject({ n: 1, played: 2 });
  });

  it('finds the longest winning streak and hides scorer stats when none were recorded', () => {
    let s: AppState = { ...baseState(), result: result(TEAMS.slice(0, 2)), match: startSession(2) };
    for (let i = 0; i < 3; i++) s = play(s, [[0]]);
    s = play(s, [[1]]);
    const st = eveningStats(buildEvening({ match: s.match!, result: s.result!, players, bibs: ['red', 'blue'], now: s.dayAt })!);
    expect(st.streak).toEqual({ team: 0, wins: 3 });
    expect(st.scorers).toEqual([]);
    expect(leaders(st.playerWins).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('counts the match on the pitch only if something happened in it', () => {
    const s = baseState();
    expect(hasEveningData(s.match, T0)).toBe(false);
    expect(buildEvening({ match: s.match!, result: s.result!, players, bibs: [], now: T0 })).toBeNull();
    const m = addGoal(s.match!, 1, T0 + 5);
    const rec = buildEvening({ match: m, result: s.result!, players, bibs: [], now: T0 + 10 })!;
    expect(rec.matches).toEqual([{ a: 0, b: 1, goalsA: 0, goalsB: 1, goals: [{ team: 1 }], sides: [['a', 'b'], ['c', 'd']], ms: 0, endedAt: T0 + 5 }]);
    expect(rec.teams[0].bib).toBe('');
  });
});

describe('saving evenings', () => {
  it('"end the evening" saves it under the given id and closes the session', () => {
    let s = play(baseState(), [[0, 'a']]);
    const id = eveningId(s.result!);
    s = reducer(s, { type: 'endEvening', id, now: T0 + 60 * MIN });
    expect(s.match).toBeNull();
    expect(s.result).not.toBeNull();
    expect(s.history.map((h) => h.id)).toEqual([id]);
    // Same teams, a second session later that night: merged into the same evening.
    s = reducer(s, { type: 'setMatch', match: startSession(3), now: T0 + 61 * MIN });
    s = play(s, [[1, 'c']]);
    s = reducer(s, { type: 'endEvening', id, now: T0 + 90 * MIN });
    expect(s.history).toHaveLength(1);
    expect(s.history[0].matches).toHaveLength(2);
  });

  it('a re-split or a deleted player keeps what was played', () => {
    let s = play(baseState(), [[0, 'a']]);
    s = reducer(s, { type: 'setResult', ...result(TEAMS), now: T0 + 99 });
    expect(s.history).toHaveLength(1);
    let t = play(baseState(), [[0, 'a']]);
    t = reducer(t, { type: 'deletePlayer', id: 'a' });
    expect(t.match).toBeNull();
    expect(t.history[0].players.find((x) => x.id === 'a')?.name).toBe('Pa');
  });

  it('deleting several players at once archives the evening once and cleans everything', () => {
    let s = play(baseState(), [[0, 'a']]);
    s = reducer(s, { type: 'addConstraint', kind: 'together', pair: ['a', 'c'] });
    s = reducer(s, { type: 'addConstraint', kind: 'apart', pair: ['b', 'd'] });
    s = reducer(s, { type: 'addConstraint', kind: 'apart', pair: ['c', 'e'] });
    s = { ...s, lastPresentIds: ['a', 'b', 'c'] };
    s = reducer(s, { type: 'deletePlayers', ids: ['a', 'b'] });
    expect(s.players.map((x) => x.id)).toEqual(['c', 'd', 'e', 'f', 's']);
    expect(s.presentIds).toEqual(['c', 'd', 'e', 'f', 's']);
    expect(s.lastPresentIds).toEqual(['c']);
    expect(s.constraints).toEqual({ together: [], apart: [['c', 'e']] });
    expect(s.result).toBeNull();
    expect(s.match).toBeNull();
    expect(s.history).toHaveLength(1);
    expect(s.history[0].matches).toHaveLength(1);
    expect(s.history[0].players.find((x) => x.id === 'a')?.name).toBe('Pa');
  });

  it("deleting only players outside today's teams keeps the teams and the match", () => {
    let s = play(baseState(), [[0, 'a']]);
    s = { ...s, players: [...s.players, p('x'), p('y')] };
    const before = s;
    s = reducer(s, { type: 'deletePlayers', ids: ['x', 'y'] });
    expect(s.players).toHaveLength(7);
    expect(s.result).toBe(before.result);
    expect(s.match).toBe(before.match);
    expect(s.history).toEqual([]);
    // Unknown ids change nothing.
    expect(reducer(s, { type: 'deletePlayers', ids: ['nobody'] })).toBe(s);
  });

  it('deleting a sub cancels the teams too', () => {
    const s = reducer(baseState(), { type: 'deletePlayers', ids: ['s'] });
    expect(s.result).toBeNull();
    expect(s.history).toEqual([]); // nothing was played yet
  });

  it('nothing is saved for a session without matches; wiping clears the history', () => {
    let s = reducer(baseState(), { type: 'endEvening', id: 'x', now: T0 });
    expect(s.history).toEqual([]);
    s = play(baseState(), [[0]]);
    s = reducer(s, { type: 'endEvening', id: 'x', now: T0 });
    expect(reducer(s, { type: 'clearAll' }).history).toEqual([]);
  });

  it('the 12-hour new-day reset saves the evening before clearing it', () => {
    const s = play(baseState(), [[0, 'a'], [0, 'b']]);
    const stored = JSON.parse(JSON.stringify(s));
    const loaded = sanitize(stored, s.dayAt + NEW_DAY_MS + 1);
    expect(loaded.match).toBeNull();
    expect(loaded.result).toBeNull();
    expect(loaded.history).toHaveLength(1);
    expect(eveningStats(loaded.history[0]).goals).toBe(2);
    // Loading again doesn't duplicate it.
    expect(sanitize(JSON.parse(JSON.stringify(loaded)), s.dayAt + NEW_DAY_MS + 2).history).toHaveLength(1);
  });
});

describe('history storage', () => {
  const rec = (id: string, startedAt: number, endedAt = startedAt): EveningRecord => ({
    id,
    v: 1,
    startedAt,
    endedAt,
    teamSize: 5,
    players: [
      { id: 'a', name: 'אבי' },
      { id: 'c', name: 'כרמל' },
    ],
    teams: [
      { bib: 'red', ids: ['a'] },
      { bib: 'blue', ids: ['c'] },
    ],
    subIds: [],
    matches: [{ a: 0, b: 1, goalsA: 1, goalsB: 0, goals: [{ team: 0, by: 'a' }], endedAt }],
  });

  it('sanitizes garbage and old data without throwing', () => {
    expect(sanitizeHistory(undefined)).toEqual([]);
    expect(sanitizeHistory({ x: 1 })).toEqual([]);
    const out = sanitizeHistory([
      null,
      'x',
      { id: 'no-matches', teams: [], matches: [] },
      { id: 'bad-team', teams: [{ bib: 'red', ids: ['a'] }], matches: [{ a: 0, b: 3 }] },
      { id: 'partial', teams: [{ ids: ['a', 5] }, {}], matches: [{ a: 0, b: 1, goals: [{ team: 1, by: 7 }, { team: 9 }] }], players: [{ id: 'a' }] },
      rec('ok', 2),
    ]);
    expect(out.map((r) => r.id)).toEqual(['ok', 'partial']);
    const partial = out[1];
    expect(partial.teams).toEqual([
      { bib: '', ids: ['a'] },
      { bib: '', ids: [] },
    ]);
    expect(partial.matches[0]).toMatchObject({ goalsA: 0, goalsB: 1, goals: [{ team: 1 }] });
    expect(partial.players).toEqual([]);
    expect(() => eveningStats(partial)).not.toThrow();
  });

  it('merges by id without duplicates, newest first, bounded', () => {
    const a = rec('a', 10);
    const b = rec('b', 20);
    const later = { ...rec('a', 10, 30), matches: [...a.matches, { ...a.matches[0], endedAt: 30 }] };
    const merged = mergeHistory([a, b], [later, b]);
    expect(merged.map((r) => r.id)).toEqual(['b', 'a']);
    expect(merged[1].matches).toHaveLength(2);
    expect(mergeHistory(merged, merged)).toEqual(merged);
    const many = Array.from({ length: HISTORY_MAX + 5 }, (_, i) => rec(`r${i}`, i));
    const kept = sanitizeHistory(many);
    expect(kept).toHaveLength(HISTORY_MAX);
    expect(kept[0].id).toBe(`r${HISTORY_MAX + 4}`);
  });

  it('all-time stats match players by id, then by name', () => {
    const other = { ...rec('o', 5), players: [{ id: 'zz', name: 'אבי' }, { id: 'c', name: 'כרמל' }], teams: [{ bib: 'red', ids: ['zz'] }, { bib: 'blue', ids: ['c'] }] };
    other.matches = [{ a: 0, b: 1, goalsA: 2, goalsB: 0, goals: [{ team: 0, by: 'zz' }, { team: 0, by: 'zz' }], endedAt: 5 }];
    const t = allTimeStats([rec('x', 1), other], [{ id: 'a', name: 'אבי' }]);
    expect(t).toMatchObject({ evenings: 2, matches: 2, goals: 3 });
    const avi = t.rows.find((r) => r.key === 'a')!;
    expect(avi).toMatchObject({ name: 'אבי', evenings: 2, played: 2, won: 2, goals: 3 });
    expect(winPct(avi)).toBeNull();
    expect(winPct(avi, 2)).toBe(100);
    expect(t.rows.find((r) => r.key === 'name:כרמל')).toMatchObject({ played: 2, won: 0 });
  });

  it('travels in the backup file, and survives a JSON round trip', () => {
    const h = [rec('a', 1)];
    const b = makeBackup([p('a')], { together: [], apart: [] }, INITIAL_STATE.settings, 5, h);
    expect(parseBackup(JSON.parse(JSON.stringify(b)))!.history).toEqual(h);
    expect(makeBackup([p('a')], { together: [], apart: [] }, INITIAL_STATE.settings, 5)).not.toHaveProperty('history');
    const s = reducer(INITIAL_STATE, { type: 'mergeHistory', records: h });
    expect(sanitize(JSON.parse(JSON.stringify(s))).history).toEqual(h);
    expect(reducer(s, { type: 'deleteEvening', id: 'a' }).history).toEqual([]);
  });
});

describe('evening share text', () => {
  it('has the totals, the winner, the table and highlights', () => {
    const text = buildEveningShareText({
      date: new Date(2026, 9, 15),
      matches: 6,
      goals: 14,
      minutes: 48,
      champion: '🔴 האדומים',
      table: ['🔴 אדומים: 4 נ׳', '🔵 כחולים: 1 נ׳'],
      highlights: ['👑 מלך השערים: אבי (4)'],
    });
    expect(text).toContain('6 משחקים · 14 שערים · 48 דקות');
    expect(text).toContain('🏆 🔴 האדומים לקחו את הערב');
    expect(text).toContain('1. 🔴 אדומים: 4 נ׳');
    expect(text).toContain('👑 מלך השערים: אבי (4)');
  });
});

describe('borrowers in per-player wins', () => {
  it('a player borrowed from the losing team counts on the side he played for', () => {
    const r = {
      playerIds: ['a1', 'a2', 'b1', 'b2', 'c1'],
      subIds: [],
      teamSize: 2,
      numTeams: 3,
      sizes: [2, 2, 1],
      assignment: [0, 0, 1, 1, 2],
      generated: [0, 0, 1, 1, 2],
      pool: [],
      shown: [],
      gkOrder: [],
      createdAt: 1,
    };
    const m = {
      history: [{ a: 0, b: 2, goalsA: 0, goalsB: 1, out: 0, goals: [], endedAt: 5, borrow: { team: 2, from: 1, ids: ['b1'] } }],
    } as unknown as Parameters<typeof stampSides>[0];
    const out = stampSides(m, 0, r);
    expect(out.history[0].sides).toEqual([['a1', 'a2'], ['c1', 'b1']]);
  });
});
