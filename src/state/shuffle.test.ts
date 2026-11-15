import { describe, expect, it } from 'vitest';
import { createRng, keyOf, search } from '../engine';
import { addGoal, endMatch, endOnPenalties, startClock, startSession, type MatchState } from '../match/match';
import { liveFromState, sanitizeLive } from '../sync/live';
import { liveToState } from '../sync/control';
import { afterShuffle, allTimeStats, buildEvening, eveningId, eveningStats, nightOf } from './history';
import { DEFAULT_SETTINGS, INITIAL_STATE, defaultAttrs, engineOptions, sanitize, type AppState, type GameResult, type Player } from './model';
import { reducer } from './reducer';
import { avoidAssignment, currentTeams, pickShuffle, shuffleSuggestion, winStreak } from './shuffle';
import { finishSplit, prepareSplit } from './splitCore';

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const p = (id: string, lvl = 5): Player => ({ id, name: `P${id}`, attrs: defaultAttrs(lvl), canGK: false, cards: [] });

function result(teams: string[][], subs: string[] = [], createdAt = T0): GameResult {
  const assignment = teams.flatMap((t, i) => t.map(() => i));
  return { playerIds: teams.flat(), subIds: subs, teamSize: 2, numTeams: teams.length, sizes: teams.map((t) => t.length), assignment, generated: assignment, pool: [], shown: [], gkOrder: teams.map((t) => [...t]), createdAt };
}

/** A match won by `win` (1–0), the other team on the pitch leaves. */
function play(m: MatchState, win: number, at: number): MatchState {
  const [a, b] = m.onPitch;
  return endMatch(addGoal(startClock(m, at), win, at + MIN), win === a ? b : a, at + 2 * MIN);
}

const TEAMS = [
  ['a', 'b'],
  ['c', 'd'],
  ['e', 'f'],
];
const roster = ['a', 'b', 'c', 'd', 'e', 'f', 's'].map((id) => p(id));

function state(): AppState {
  return { ...INITIAL_STATE, players: roster, presentIds: roster.map((x) => x.id), dayAt: T0, result: result(TEAMS, ['s']), match: startSession(3) };
}

const shuffleTo = (teams: string[][], subs: string[], now: number) => ({
  type: 'shuffle' as const,
  ...{ playerIds: teams.flat(), subIds: subs, sizes: teams.map((t) => t.length), teamSize: 2, assignment: teams.flatMap((t, i) => t.map(() => i)), gkOrder: teams },
  pool: [],
  now,
});

describe('winStreak', () => {
  it('2 wins in a row by the team that won last; a draw or a loss breaks it', () => {
    let m = startSession(3);
    expect(winStreak(m.history)).toBeNull();
    m = play(m, 0, T0); // 0 beats 1, 2 comes in
    expect(winStreak(m.history)).toBeNull();
    m = play(m, 0, T0 + 10 * MIN); // 0 beats 2
    expect(winStreak(m.history)).toEqual({ team: 0, wins: 2, from: 0 });
    m = play(m, 0, T0 + 20 * MIN);
    expect(winStreak(m.history)).toEqual({ team: 0, wins: 3, from: 0 });
    m = play(m, m.onPitch[0] === 0 ? m.onPitch[1] : m.onPitch[0], T0 + 30 * MIN); // 0 loses
    expect(winStreak(m.history)).toBeNull();
    // A level match is no win.
    const d = endMatch(startClock(m, T0), m.onPitch[0], T0 + MIN);
    expect(winStreak(d.history)).toBeNull();
  });

  it('a win on penalties counts', () => {
    let m = play(startSession(2), 1, T0);
    m = endOnPenalties(startClock(m, T0), 1, T0 + 10 * MIN);
    expect(winStreak(m.history)).toEqual({ team: 1, wins: 2, from: 0 });
  });
});

describe('shuffleSuggestion', () => {
  it('at 2 wins in a row, then every 2 more (4, 6) of the same streak; a new streak counts afresh', () => {
    let m = startSession(2);
    const at: (number | null)[] = [];
    for (let i = 0; i < 6; i++) {
      m = play(m, 0, T0 + i * 10 * MIN);
      at.push(shuffleSuggestion(m.history)?.wins ?? null);
    }
    expect(at).toEqual([null, 2, null, 4, null, 6]);
    m = play(m, 1, T0 + 70 * MIN); // team 1 ends it
    expect(shuffleSuggestion(m.history)).toBeNull();
    m = play(m, 1, T0 + 80 * MIN);
    expect(shuffleSuggestion(m.history)).toEqual({ team: 1, wins: 2, from: 6 });
  });
});

describe('avoiding the current teams', () => {
  it('the current teams as an assignment over the new split order; other players → null', () => {
    const r = result(TEAMS, ['s']);
    expect(currentTeams(r)).toEqual(TEAMS);
    expect(avoidAssignment(['f', 'a', 'c', 'b', 'e', 'd'], TEAMS)).toEqual([2, 0, 1, 0, 2, 1]);
    expect(avoidAssignment(['s', 'a', 'c', 'b', 'e', 'd'], TEAMS)).toBeNull();
    expect(avoidAssignment(['a', 'b'], TEAMS)).toBeNull();
  });

  it('pickShuffle never returns the current teams when the pool has another near-optimal split', () => {
    const players = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, i) => p(id, 3 + (i % 5)));
    const res = search(players, 2, engineOptions(DEFAULT_SETTINGS), { together: [], apart: [] }, { seed: 7, sizes: [4, 4] });
    const away = res.best.assignment;
    for (let s = 1; s < 20; s++) {
      const asg = pickShuffle(res.pool, res.best.assignment, away, createRng(s));
      expect(keyOf(asg)).not.toBe(keyOf(away));
    }
    // Already different: the best split as is.
    expect(pickShuffle(res.pool, res.best.assignment, null, createRng(1))).toBe(res.best.assignment);
  });

  it('a whole split from tonight\'s players avoids the current teams', () => {
    const players = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => p(id, 2 + i));
    const src = { players, presentIds: players.map((x) => x.id), teamSize: 3, settings: DEFAULT_SETTINGS, constraints: { together: [], apart: [] } };
    const prep = prepareSplit(src, 3)!;
    const res = search(prep.req.players, prep.req.k, prep.req.options, prep.req.constraints, { seed: 3, sizes: prep.req.sizes });
    const first = finishSplit(src, prep, res.best.assignment, 3);
    const cur = result([0, 1].map((t) => first.playerIds.filter((_, i) => first.assignment[i] === t)));
    const away = avoidAssignment(prep.onTeams.map((x) => x.id), currentTeams(cur));
    const next = finishSplit(src, prep, pickShuffle(res.pool, res.best.assignment, away, createRng(5)), 3);
    expect(keyOf(next.assignment)).not.toBe(keyOf(first.assignment));
  });
});

describe('the shuffle transition', () => {
  it('saves what was played with the old teams, starts a new session with the new teams on the same night', () => {
    let s = state();
    s = reducer(s, { type: 'setMatch', match: play(s.match!, 0, T0), now: T0 });
    s = reducer(s, { type: 'setMatch', match: play(s.match!, 0, T0 + 10 * MIN), now: T0 });
    const firstId = eveningId(s.result!);
    const NEW = [
      ['a', 'c'],
      ['b', 'e'],
      ['d', 's'],
    ];
    s = reducer(s, shuffleTo(NEW, ['f'], T0 + 30 * MIN));

    // The first part: its own record, old teams, both matches, per-player wins by who played.
    expect(s.history).toHaveLength(1);
    const first = s.history[0];
    expect(first.id).toBe(firstId);
    expect(first.teams.map((t) => t.ids)).toEqual(TEAMS);
    expect(first.subIds).toEqual(['s']);
    expect(first.matches).toHaveLength(2);
    expect(eveningStats(first).table[0]).toMatchObject({ team: 0, won: 2 });
    expect(eveningStats(first).playerWins.find((x) => x.id === 'a')?.n).toBe(2);

    // The new teams: a fresh session (keepers from the new order), same attendance, same night.
    expect(s.result?.playerIds).toEqual(NEW.flat());
    expect(s.result?.subIds).toEqual(['f']);
    expect(s.result?.gkOrder).toEqual(NEW);
    expect(s.result?.night).toBe(firstId);
    expect(s.match).toEqual(startSession(3));
    expect(s.presentIds).toEqual(state().presentIds);

    // Play on and end the evening: the second record joins the night.
    s = reducer(s, { type: 'setMatch', match: play(s.match!, 1, T0 + 40 * MIN), now: T0 + 40 * MIN });
    const secondId = eveningId(s.result!);
    expect(secondId.startsWith(`${firstId}~`)).toBe(true);
    s = reducer(s, { type: 'endEvening', id: secondId, now: T0 + 50 * MIN });
    expect(s.history.map((h) => h.id).sort()).toEqual([firstId, secondId].sort());
    const second = s.history.find((h) => h.id === secondId)!;
    expect(second.teams.map((t) => t.ids)).toEqual(NEW);
    expect(second.matches).toHaveLength(1);
    expect(nightOf(second.id)).toBe(firstId);
    expect(afterShuffle(second.id)).toBe(true);
    expect(afterShuffle(first.id)).toBe(false);

    // All time: 3 matches, but one evening for everyone who was there.
    const all = allTimeStats(s.history, roster);
    expect(all.evenings).toBe(1);
    expect(all.matches).toBe(3);
    expect(all.rows.every((r) => r.evenings === 1)).toBe(true);
    expect(all.rows.find((r) => r.key === 'a')).toMatchObject({ played: 3, won: 2 }); // 2 with the old teams, lost with the new
  });

  it('a second shuffle keeps the night\'s first id (not a chain)', () => {
    let s = state();
    s = reducer(s, { type: 'setMatch', match: play(s.match!, 0, T0), now: T0 });
    const firstId = eveningId(s.result!);
    s = reducer(s, shuffleTo(TEAMS, ['s'], T0 + 10 * MIN));
    s = reducer(s, { type: 'setMatch', match: play(s.match!, 1, T0 + 20 * MIN), now: T0 });
    s = reducer(s, shuffleTo(TEAMS, ['s'], T0 + 30 * MIN));
    expect(s.result?.night).toBe(firstId);
    expect(s.history).toHaveLength(2);
    expect(new Set(s.history.map((h) => nightOf(h.id)))).toEqual(new Set([firstId]));
  });

  it('nothing to do without teams; a reload keeps the night', () => {
    const none = { ...state(), result: null, match: null };
    expect(reducer(none, shuffleTo(TEAMS, [], T0))).toBe(none);
    let s = state();
    s = reducer(s, { type: 'setMatch', match: play(s.match!, 0, T0), now: T0 });
    s = reducer(s, shuffleTo(TEAMS, ['s'], T0 + 10 * MIN));
    const back = sanitize(JSON.parse(JSON.stringify(s)), T0 + 11 * MIN);
    expect(back.result?.night).toBe(s.result?.night);
    expect(sanitize({ ...s, result: { ...s.result!, night: 42 } } as never, T0 + 11 * MIN).result?.night).toBeUndefined();
  });

  it('the live snapshot carries the night, so another phone keeps the same evening ids', () => {
    let s = state();
    s = reducer(s, { type: 'setMatch', match: play(s.match!, 0, T0), now: T0 });
    s = reducer(s, shuffleTo(TEAMS, ['s'], T0 + 10 * MIN));
    const live = sanitizeLive(JSON.parse(JSON.stringify(liveFromState({ result: s.result, match: s.match, players: s.players, settings: s.settings, now: T0 + 11 * MIN }))))!;
    expect(live.night).toBe(s.result?.night);
    expect(eveningId(liveToState(live).result)).toBe(eveningId(s.result!));
    // The record built from it lands in the same night.
    const m = play(liveToState(live).match!, 0, T0 + 12 * MIN);
    const rec = buildEvening({ match: m, result: liveToState(live).result, players: s.players, bibs: [], now: T0 + 20 * MIN })!;
    expect(nightOf(rec.id)).toBe(s.result?.night);
  });
});
