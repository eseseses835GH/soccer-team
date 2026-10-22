import { describe, expect, it } from 'vitest';
import { addGoal, endMatch, startClock, startSession, type MatchState } from '../match/match';
import { teamMembers } from '../state/history';
import { leaveEarly } from '../state/leave';
import { DEFAULT_SETTINGS, defaultAttrs, INITIAL_STATE, type AppState, type GameResult, type Player } from '../state/model';
import { leaveCtx, reducer } from '../state/reducer';
import { liveFromState, sanitizeLive, type LiveData } from './live';
import { takeBackState } from './organizerControl';
import { runnerApp } from './runner';
import { arrivalChoices, benchTarget, subsAfterLeave } from './runnerLate';

const T = 1_800_000_000_000;
const MIN = 60_000;
const rated = (id: string, level: number): Player => ({ id, name: `P${id}`, attrs: defaultAttrs(level), canGK: true, cards: [] });
const ids = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 's1', 's2', 'x1', 'x2'];
/** The organizer's roster, with real (and very different) levels. */
const roster = ids.map((id, i) => rated(id, 1 + (i % 10)));

/** Red a vs blue b on the pitch (one match played), yellow c one short, two subs; x1, x2 not here. */
function result(): GameResult {
  const teams = [['a1', 'a2', 'a3'], ['b1', 'b2', 'b3'], ['c1', 'c2']];
  const assignment = teams.flatMap((t, i) => t.map(() => i));
  return { playerIds: teams.flat(), subIds: ['s1', 's2'], teamSize: 3, numTeams: 3, sizes: [3, 3, 2], assignment, generated: assignment, pool: [], shown: [], gkOrder: teams, createdAt: T - 30 * MIN };
}
function organizer(): AppState {
  const s0: AppState = { ...INITIAL_STATE, players: roster, settings: { ...DEFAULT_SETTINGS, hasBibs: true }, result: result(), match: startSession(3), presentIds: [...result().playerIds, ...result().subIds] };
  // Match 1: red beats yellow; then red vs blue under way.
  let m: MatchState = startSession(3);
  m = { ...m, onPitch: [0, 2], queue: [1] };
  m = addGoal(startClock(m, T - 20 * MIN), 0, T - 15 * MIN, 'a2');
  const s1 = reducer(s0, { type: 'setMatch', match: m, now: T - 15 * MIN });
  const s2 = reducer(s1, { type: 'setMatch', match: endMatch(s1.match!, 2, T - 12 * MIN), now: T - 12 * MIN });
  return reducer(s2, { type: 'setMatch', match: addGoal(startClock(s2.match!, T - 5 * MIN), 1, T - 3 * MIN, 'b2'), now: T - 3 * MIN });
}
const wire = (s: AppState, now = T): LiveData => sanitizeLive(JSON.parse(JSON.stringify(liveFromState({ result: s.result, match: s.match, players: s.players, settings: s.settings, now }))))!;
/** The player group's state on the runner's phone: names only, everyone level 5. */
const playerBase: AppState = { ...INITIAL_STATE, players: roster.map((p) => ({ id: p.id, name: p.name, attrs: defaultAttrs(5), canGK: false, cards: [] })) };
const runner = () => runnerApp(playerBase, wire(organizer()));

describe('player runner: someone arrived', () => {
  it('picks from the roster (not here tonight) or the bench; never anyone else', () => {
    const app = runner();
    const c = arrivalChoices(app.players, app.result!);
    expect(c.roster.map((p) => p.id)).toEqual(['x1', 'x2']);
    expect(c.bench.map((p) => p.id)).toEqual(['s1', 's2']);
  });
  it('"in now" goes to the smallest team, and a bench player to the smallest existing team', () => {
    const app = runner();
    const next = reducer(app, { type: 'lateJoin', id: 'x1', choice: { kind: 'now' }, seed: 1, now: T });
    expect(teamMembers(next.result!, 2)).toEqual(['c1', 'c2', 'x1']);
    expect(next.players).toHaveLength(app.players.length); // nobody new
    // All full now, two subs: the plain rule would open a new team; from the bench it's a team.
    expect(benchTarget(next.result!)).toBe(2);
    const sub = reducer(next, { type: 'subIn', subId: 's1', team: benchTarget(next.result!) });
    expect(teamMembers(sub.result!, 2)).toEqual(['c1', 'c2', 'x1', 's1']);
    expect(sub.result!.subIds).toEqual(['s2']);
  });
  it('nothing depends on levels: the same choices with any ratings', () => {
    const app = runner();
    const flipped = { ...app, players: app.players.map((p, i) => ({ ...p, attrs: defaultAttrs(10 - (i % 10)) })) };
    const idsOf = (c: ReturnType<typeof arrivalChoices>) => [c.roster.map((p) => p.id), c.bench.map((p) => p.id)];
    expect(idsOf(arrivalChoices(flipped.players, flipped.result!))).toEqual(idsOf(arrivalChoices(app.players, app.result!)));
    expect(benchTarget(flipped.result!)).toBe(benchTarget(app.result!));
  });
});

describe('player runner: someone left', () => {
  it('his team plays short; the subs are offered unranked, in bench order', () => {
    const app = runner();
    const l = leaveEarly(app.result!, app.match, 'b2', leaveCtx(app))!;
    expect(l.outcome).toBe('short');
    expect(subsAfterLeave(l)).toEqual(['s1', 's2']);
    const next = reducer(app, { type: 'leave', id: 'b2', now: T });
    expect(teamMembers(next.result!, 1)).toEqual(['b1', 'b3']);
    expect(subsAfterLeave(leaveEarly(next.result!, next.match, 's1', leaveCtx(next))!)).toEqual([]); // a sub leaving: nothing to offer
  });
  it('a team that would drop below 2 takes the sub he picked, not the "best" one', () => {
    const two: GameResult = { ...result(), playerIds: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'], assignment: [0, 0, 1, 1, 2, 2], generated: [0, 0, 1, 1, 2, 2], teamSize: 2, sizes: [2, 2, 2], gkOrder: [['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2']] };
    const s: AppState = { ...INITIAL_STATE, players: roster, result: two, match: startSession(3) };
    const auto = leaveEarly(two, s.match, 'b2', leaveCtx(s))!;
    expect(auto.outcome).toBe('subIn');
    const pick = auto.subId === 's1' ? 's2' : 's1';
    const next = reducer(s, { type: 'leave', id: 'b2', now: T, subId: pick });
    expect(teamMembers(next.result!, 1)).toEqual(['b1', pick]);
    expect(next.result!.subIds).toEqual([auto.subId]);
  });
});

describe('organizer takes it back after the runner changed people', () => {
  it('teams, bench, keeper order, attendance and history sides come back as the runner left them', () => {
    let app = runner();
    app = reducer(app, { type: 'lateJoin', id: 'x1', choice: { kind: 'now' }, seed: 7, now: T }); // to yellow
    app = reducer(app, { type: 'lateJoin', id: 'x2', choice: { kind: 'wait' }, seed: 8, now: T }); // the bench
    app = reducer(app, { type: 'leave', id: 'a2', now: T }); // scored in match 1, then left
    app = reducer(app, { type: 'subIn', subId: 's1', team: 0 });
    app = reducer(app, { type: 'leave', id: 's2', now: T });
    const live = wire(app, T + MIN);
    expect(live.gone).toEqual([{ id: 'a2', name: 'Pa2' }]);
    expect(JSON.stringify(live)).not.toMatch(/"(attrs|levelVotes|cards|overall|weaknesses)":/);

    const org = organizer();
    const back = takeBackState(org, live, T + 2 * MIN);
    const teams = (r: GameResult) => Array.from({ length: r.numTeams }, (_, t) => teamMembers(r, t));
    expect(teams(back.result!)).toEqual(teams(app.result!));
    expect(teams(back.result!)).toEqual([['a1', 'a3', 's1'], ['b1', 'b2', 'b3'], ['c1', 'c2', 'x1']]);
    expect(back.result!.subIds).toEqual(['x2']);
    expect(back.result!.gkOrder).toEqual(app.result!.gkOrder);
    expect(new Set(back.presentIds)).toEqual(new Set(['a1', 'a3', 's1', 'b1', 'b2', 'b3', 'c1', 'c2', 'x1', 'x2']));
    // The organizer's ratings stay his: nobody was replaced by a level-5 copy.
    expect(back.players).toEqual(org.players);
    // Match 1 still has a2 (who scored) on red; the current match goes on.
    const h = back.match!.history[0];
    expect(h.sides![0]).toContain('a2');
    expect(h.goals[0].scorerId).toBe('a2');
    expect(back.match!.goals.map((g) => g.scorerId)).toEqual(['b2']);
    expect(back.match!.onPitch).toEqual(app.match!.onPitch);
  });
  it('someone who left and is unknown to that phone comes back by name (for the history)', () => {
    let app = runner();
    app = reducer(app, { type: 'leave', id: 'a2', now: T });
    const org = { ...organizer(), players: roster.filter((p) => p.id !== 'a2') };
    const back = takeBackState(org, wire(app), T);
    expect(back.players.find((p) => p.id === 'a2')?.name).toBe('Pa2');
    expect(back.presentIds).not.toContain('a2');
  });
});
