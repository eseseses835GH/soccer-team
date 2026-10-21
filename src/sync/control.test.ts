import { describe, expect, it } from 'vitest';
import {
  addDrawExtraTime,
  addGoal,
  dismissDominance,
  endMatch,
  endOnPenalties,
  inDrawExtraTime,
  keeperIndex,
  matchLength,
  pauseClock,
  setBorrow,
  setMatchLength,
  startClock,
  startSession,
  type MatchState,
} from '../match/match';
import { buildEvening, eveningId, stampSides, teamMembers } from '../state/history';
import { DEFAULT_SETTINGS, defaultAttrs, defaultMatchMs, teamBibs, type GameResult, type Player, type Settings } from '../state/model';
import { iAmRunner, importLive, liveToState, settingsFromLive, someoneElseRuns } from './control';
import { liveFromState, sanitizeLive, type LiveData } from './live';

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const p = (id: string): Player => ({ id, name: `P${id}`, attrs: defaultAttrs(7), canGK: true, cards: [] });
const players = ['a1', 'a2', 'a3', 'b1', 'b2', 'c1', 'c2', 'c3', 's1'].map(p);

function result(teams: string[][], subs: string[] = []): GameResult {
  const playerIds = teams.flat();
  const assignment = teams.flatMap((t, i) => t.map(() => i));
  return {
    playerIds,
    subIds: subs,
    teamSize: 3,
    numTeams: teams.length,
    sizes: teams.map((t) => t.length).sort((x, y) => y - x),
    assignment,
    generated: assignment,
    pool: [],
    shown: [],
    gkOrder: teams.map((t) => [...t].reverse()),
    createdAt: T0 - 5 * MIN,
  };
}
const r3 = result([['a1', 'a2', 'a3'], ['b1', 'b2'], ['c1', 'c2', 'c3']], ['s1']);
const settings: Settings = { ...DEFAULT_SETTINGS, hasBibs: true, bibs: ['red', 'blue'], gkMode: 'rotate', gkSwitchGoals: 2, matchMinutes: 7, drawExtraMinutes: 3 };
const dflt = defaultMatchMs(settings);

/** An evening the way the reducer builds it (sides stamped after each end). */
function evening(): MatchState {
  const end = (m: MatchState, f: (m: MatchState) => MatchState) => stampSides(f(m), m.history.length, r3);
  let m = startClock(startSession(3), T0);
  m = addGoal(m, 0, T0 + MIN, 'a2');
  m = addGoal(m, 1, T0 + 2 * MIN);
  m = addGoal(m, 0, T0 + 3 * MIN, 'a3');
  m = end(m, (x) => endMatch(x, 1, T0 + 7 * MIN)); // 2–1, b leaves, c comes in; c is short? (3 v 3)
  m = setBorrow(m, { team: 2, from: 1, ids: ['b2'] });
  m = startClock(m, T0 + 8 * MIN);
  m = addDrawExtraTime(m, 3, dflt);
  m = pauseClock(m, T0 + 18 * MIN); // so the record's ms is exact
  m = end(m, (x) => endOnPenalties(x, 2, T0 + 18 * MIN, [3, 4]));
  m = setBorrow(m, { team: 1, from: 0, ids: [] }); // skipped
  m = dismissDominance(m, 2);
  m = setMatchLength(startClock(m, T0 + 19 * MIN), 9 * MIN);
  m = addGoal(m, 2, T0 + 20 * MIN, 'c1');
  m = pauseClock(m, T0 + 21 * MIN);
  return m;
}

const wire = (live: LiveData) => sanitizeLive(JSON.parse(JSON.stringify(live)))!;

describe('liveToState: round trip state → live → state', () => {
  const m = evening();
  const live = wire(liveFromState({ result: r3, match: m, players, settings, now: T0 + 22 * MIN })!);
  const back = liveToState(live);

  it('the match: pitch, queue, goals with scorers and times, clock, streaks, keepers', () => {
    const b = back.match!;
    expect(b.onPitch).toEqual(m.onPitch);
    expect(b.queue).toEqual(m.queue);
    expect(b.goals).toEqual(m.goals.map((g) => (g.scorerId ? g : { team: g.team, at: g.at })));
    expect(b.clock).toEqual(m.clock);
    expect(b.streak).toEqual(m.streak);
    expect(b.pitchSince).toEqual(m.pitchSince);
    expect(b.conceded).toEqual(m.conceded);
    expect(b.dismissed).toEqual(m.dismissed);
    expect(b.borrow).toEqual(m.borrow); // skipped borrow survives
    expect(matchLength(b, dflt)).toBe(9 * MIN);
    expect(inDrawExtraTime(b)).toBe(inDrawExtraTime(m));
  });

  it('finished matches: every field of the records', () => {
    expect(back.match!.history).toEqual(m.history.map((h) => ({ ...h, goals: h.goals.map((g) => (g.scorerId ? g : { team: g.team, at: g.at })) })));
    expect(back.match!.history[1]).toMatchObject({ pens: { winner: 2, a: 3, b: 4 }, borrow: { team: 2, from: 1, ids: ['b2'] }, ms: 10 * MIN });
  });

  it('the teams: same members, keeper order, subs, evening id, bibs', () => {
    for (let t = 0; t < 3; t++) expect(teamMembers(back.result, t)).toEqual(teamMembers(r3, t));
    expect(back.result.subIds).toEqual(r3.subIds);
    expect(eveningId(back.result)).toBe(eveningId(r3));
    expect(back.bibs).toEqual(teamBibs(settings, 3));
    for (let t = 0; t < 3; t++) {
      const ids = teamMembers(back.result, t);
      expect(ids[keeperIndex(back.match!.conceded[t], settings.gkSwitchGoals, ids.length)]).toBe(live.teams[t].keeper);
    }
  });

  it('archives to the same history record and publishes the same snapshot again', () => {
    const bibs = teamBibs(settings, 3);
    const now = T0 + 30 * MIN;
    // Same record; only the order of the names list may differ (it follows the teams' keeper order).
    const byId = (e: ReturnType<typeof buildEvening>) => ({ ...e!, players: [...e!.players].sort((x, y) => x.id.localeCompare(y.id)) });
    expect(byId(buildEvening({ match: back.match!, result: back.result, players, bibs, now }))).toEqual(byId(buildEvening({ match: m, result: r3, players, bibs, now })));
    const again = liveFromState({ result: back.result, match: back.match, players: back.players, settings, now: T0 + 22 * MIN })!;
    expect(wire(again)).toEqual(live);
  });

  it('a player runner with default settings publishes the same teams and rules', () => {
    const mine = settingsFromLive(DEFAULT_SETTINGS, live);
    expect(teamBibs(mine, 3)).toEqual(live.teams.map((t) => t.bib));
    expect(mine).toMatchObject({ gkMode: 'rotate', gkSwitchGoals: 2, matchMinutes: 7, matchNoLimit: false, drawExtraMinutes: 3, theme: DEFAULT_SETTINGS.theme });
    const again = liveFromState({ result: back.result, match: back.match, players: back.players, settings: mine, now: T0 + 22 * MIN })!;
    expect(wire(again)).toEqual(live);
  });

  it('teams only, no match yet', () => {
    const l = wire(liveFromState({ result: r3, match: null, players, settings, now: T0 })!);
    expect(liveToState(l).match).toBeNull();
    expect(eveningId(liveToState(l).result)).toBe(eveningId(r3));
  });

  it('numbered teams stay numbered; no limit carries over', () => {
    const plain = { ...settings, hasBibs: false, matchNoLimit: true };
    const l = wire(liveFromState({ result: r3, match: startSession(3), players, settings: plain, now: T0 })!);
    const s = settingsFromLive({ ...DEFAULT_SETTINGS, hasBibs: true }, l);
    expect(s.hasBibs).toBe(false);
    expect(s.matchNoLimit).toBe(true);
    expect(matchLength(liveToState(l).match!, null)).toBeNull();
  });
});

describe('sides', () => {
  it('sent only when the teams changed since; restored either way', () => {
    let m = startClock(startSession(3), T0);
    m = stampSides(endMatch(addGoal(m, 0, T0 + MIN), 1, T0 + 5 * MIN), 0, r3);
    const swapped = { ...r3, assignment: r3.assignment.map((t, i) => (r3.playerIds[i] === 'a1' ? 1 : r3.playerIds[i] === 'b1' ? 0 : t)) };
    m = stampSides(endMatch(addGoal(startClock(m, T0 + 6 * MIN), 2, T0 + 7 * MIN), 0, T0 + 9 * MIN), 1, swapped);
    const live = wire(liveFromState({ result: swapped, match: m, players, settings, now: T0 + 10 * MIN })!);
    expect(live.match!.played[0].sides).toEqual(m.history[0].sides); // old lineup: sent
    expect(live.match!.played[1].sides).toBeUndefined(); // same as today's teams: left out
    expect(liveToState(live).match!.history.map((h) => h.sides)).toEqual(m.history.map((h) => h.sides));
  });
});

describe('importLive (organizer takes it back)', () => {
  it('same teams: keeps the local split (re-roll pool), takes the match', () => {
    const local = { ...r3, pool: [{ assignment: [0], cost: 1 }] as unknown as GameResult['pool'], shown: [[0]] };
    const m = evening();
    const live = wire(liveFromState({ result: r3, match: m, players, settings, now: T0 + 22 * MIN })!);
    const imp = importLive({ result: local }, live);
    expect(imp.result.pool).toBe(local.pool);
    expect(imp.match!.history).toHaveLength(2);
  });
  it('teams changed on the other phone: the snapshot wins', () => {
    const other = result([['a1', 'b1', 'a3'], ['a2', 'b2'], ['c1', 'c2', 'c3']], ['s1']);
    const live = wire(liveFromState({ result: other, match: null, players, settings, now: T0 })!);
    const imp = importLive({ result: r3 }, live);
    expect(teamMembers(imp.result, 0).sort()).toEqual(['a1', 'a3', 'b1']);
  });
});

describe('v10 snapshots (no details)', () => {
  it('rebuilds goals, out and conceded from the scores', () => {
    const old = sanitizeLive({
      v: 1,
      at: T0,
      teamSize: 3,
      players: [],
      subs: [],
      teams: [
        { bib: 'n1', ids: ['a1'], keeper: 'a1' },
        { bib: 'n2', ids: ['b1'], keeper: 'b1' },
        { bib: 'n3', ids: ['c1'], keeper: 'c1' },
      ],
      match: {
        n: 2,
        onPitch: [0, 2],
        queue: [1],
        score: [0, 1],
        goals: [{ team: 2, by: 'c1' }],
        clock: { running: false, startedAt: null, elapsedMs: 0, lengthMs: 8 * MIN },
        extra: false,
        borrow: null,
        streak: [1, 0, 0],
        played: [{ a: 0, b: 1, goalsA: 2, goalsB: 1 }],
      },
    })!;
    const s = liveToState(old, 8 * MIN);
    expect(s.result.createdAt).toBe(T0);
    expect(s.match!.history[0]).toMatchObject({ out: 1, endedAt: T0, goals: [{ team: 0 }, { team: 0 }, { team: 1 }] });
    expect(s.match!.conceded).toEqual([2, 2, 0]);
    expect(s.match!.goals).toEqual([{ team: 2, scorerId: 'c1', at: T0 }]);
    expect(s.match!.length).toBeUndefined();
  });
});

describe('who runs it', () => {
  it('iAmRunner / someoneElseRuns', () => {
    expect(iAmRunner({ runner: 'ABC' }, 'abc')).toBe(true);
    expect(iAmRunner({ runner: null }, 'abc')).toBe(false);
    expect(iAmRunner(null, 'abc')).toBe(false);
    expect(someoneElseRuns({ runner: 'x' }, 'abc')).toBe(true);
    expect(someoneElseRuns({ runner: null }, 'abc')).toBe(false);
    expect(someoneElseRuns({ runner: 'abc' }, 'abc')).toBe(false);
  });
});

describe('size', () => {
  it('a long evening (4 teams of 7, uuid ids, 40 matches, 6 goals each) stays well under the 64 KB limit', () => {
    const id = (i: number) => `0000000${i}`.slice(-8) + '-1111-4222-8333-444455556666';
    const teams = Array.from({ length: 4 }, (_, t) => Array.from({ length: 7 }, (_, i) => id(t * 10 + i)));
    const r = { ...result(teams, [id(90), id(91), id(92)]), teamSize: 7 };
    const roster = [...teams.flat(), id(90), id(91), id(92)].map((x) => ({ ...p(x), name: 'שם ארוך של שחקן' }));
    let m = startSession(4);
    for (let k = 0; k < 40; k++) {
      m = startClock(m, T0 + k * 10 * MIN);
      const [a, b] = m.onPitch;
      for (let g = 0; g < 6; g++) m = addGoal(m, g % 2 ? a : b, T0 + k * 10 * MIN + g * MIN, teams[g % 2 ? a : b][g]);
      m = stampSides(endMatch(m, b, T0 + k * 10 * MIN + 8 * MIN), m.history.length, r);
    }
    const bytes = new TextEncoder().encode(JSON.stringify(liveFromState({ result: r, match: m, players: roster, settings, now: T0 }))).length;
    expect(bytes).toBeLessThan(32_000);
  });
});
