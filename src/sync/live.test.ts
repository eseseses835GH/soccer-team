import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { addDrawExtraTime, addGoal, endMatch, setBorrow, startClock, startSession } from '../match/match';
import { DEFAULT_SETTINGS, defaultAttrs, type GameResult, type Player } from '../state/model';
import { liveApi, liveClockMs, liveFromState, parseLiveRow, sanitizeLive } from './live';

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const p = (id: string): Player => ({
  id,
  name: `P${id}`,
  attrs: defaultAttrs(7),
  canGK: true,
  cards: ['fast' as Player['cards'][number]],
  levelVotes: { '00000000-0000-4000-8000-000000000001': 7 },
});
const players = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 's1'].map(p);

function result(teams: string[][], subs: string[] = []): GameResult {
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
    createdAt: T0,
  };
}
const r3 = result([['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2']], ['s1']);
const settings = { ...DEFAULT_SETTINGS, gkMode: 'rotate' as const, gkSwitchGoals: 1, matchMinutes: 8, matchNoLimit: false };

describe('liveFromState', () => {
  it('is null without teams', () => {
    expect(liveFromState({ result: null, match: null, players, settings, now: T0 })).toBeNull();
  });

  it('teams only (no match yet): names, bibs, keepers, subs', () => {
    const live = liveFromState({ result: r3, match: null, players, settings, now: T0 })!;
    expect(live).toMatchObject({ v: 1, at: T0, teamSize: 2, subs: ['s1'], match: null });
    expect(live.teams.map((t) => t.bib)).toEqual(['n1', 'n2', 'n3']);
    expect(live.teams[0]).toEqual({ bib: 'n1', ids: ['a1', 'a2'], keeper: 'a1' });
    expect(live.players).toHaveLength(7);
    expect(liveFromState({ result: r3, match: null, players, settings: { ...settings, hasBibs: true, bibs: ['red', 'blue', 'yellow'] } as typeof settings, now: T0 })!.teams[1].bib).toBe('blue');
  });

  it('never carries ratings', () => {
    let m = startClock(startSession(3), T0);
    m = addGoal(m, 0, T0 + MIN, 'a2');
    const text = JSON.stringify(liveFromState({ result: r3, match: m, players, settings, now: T0 + 2 * MIN }));
    expect(text).not.toMatch(/attrs|levelVotes|cards|overall|canGK|fast/);
  });

  it('the match: score, goals, clock, queue, keeper rotation, borrow, played', () => {
    let m = startClock(startSession(3), T0);
    m = addGoal(m, 1, T0 + MIN, 'b2'); // team 0 conceded once → its keeper rotates
    m = endMatch(m, 0, T0 + 3 * MIN); // team 0 leaves, team 2 comes in
    m = setBorrow(m, { team: 2, from: 0, ids: ['a2'] });
    m = startClock(m, T0 + 4 * MIN);
    m = addGoal(m, 2, T0 + 5 * MIN);
    const live = liveFromState({ result: r3, match: m, players, settings, now: T0 + 6 * MIN })!;
    const lm = live.match!;
    expect(lm.n).toBe(2);
    expect(lm.onPitch).toEqual(m.onPitch);
    expect(lm.queue).toEqual([0]);
    expect(lm.score).toEqual(m.onPitch[0] === 2 ? [1, 0] : [0, 1]);
    expect(lm.goals).toEqual([{ team: 2 }]);
    expect(lm.clock).toEqual({ running: true, startedAt: T0 + 4 * MIN, elapsedMs: 0, lengthMs: 8 * MIN });
    expect(lm.borrow).toEqual({ team: 2, from: 0, ids: ['a2'] });
    expect(lm.played).toEqual([{ a: 0, b: 1, goalsA: 0, goalsB: 1 }]);
    expect(lm.extra).toBe(false);
    expect(live.teams[0].keeper).toBe('a2');
    expect(liveClockMs(lm.clock, T0 + 6 * MIN)).toBe(2 * MIN);
  });

  it('no time limit, extra time, fixed keepers', () => {
    const m = startSession(2);
    const free = liveFromState({ result: r3, match: m, players, settings: { ...settings, matchNoLimit: true }, now: T0 })!;
    expect(free.match!.clock).toEqual({ running: false, startedAt: null, elapsedMs: 0, lengthMs: null });
    const extra = addDrawExtraTime(m, 2, 8 * MIN);
    expect(liveFromState({ result: r3, match: extra, players, settings, now: T0 })!.match!).toMatchObject({ extra: true, clock: { lengthMs: 10 * MIN } });
    const fixed = addGoal(m, 1, T0);
    expect(liveFromState({ result: r3, match: fixed, players, settings: { ...settings, gkMode: 'fixed' }, now: T0 })!.teams[0].keeper).toBe('a1');
  });

  it('round-trips through sanitizeLive', () => {
    let m = startClock(startSession(3), T0);
    m = addGoal(m, 0, T0 + MIN, 'a1');
    const live = liveFromState({ result: r3, match: m, players, settings, now: T0 + MIN })!;
    expect(sanitizeLive(JSON.parse(JSON.stringify(live)))).toEqual(live);
  });
});

describe('sanitizeLive / parseLiveRow', () => {
  it('nothing live: garbage, the "ended" marker, other versions', () => {
    expect(sanitizeLive(null)).toBeNull();
    expect(sanitizeLive({ ended: true })).toBeNull();
    expect(sanitizeLive({ v: 2, teams: [] })).toBeNull();
    expect(parseLiveRow([])).toBeNull();
    expect(parseLiveRow({ data: { ended: true } })).toBeNull();
  });
  it('drops bad parts', () => {
    const out = sanitizeLive({
      v: 1,
      teams: [{ bib: 'red', ids: ['x', 3], keeper: 'nope' }, {}],
      players: [{ id: 'x', name: 'X' }, { id: 1 }],
      match: { onPitch: [0, 7], score: [1, 1] },
    })!;
    expect(out.teams).toEqual([
      { bib: 'red', ids: ['x'], keeper: null },
      { bib: 'n2', ids: [], keeper: null },
    ]);
    expect(out.players).toEqual([{ id: 'x', name: 'X' }]);
    expect(out.match).toBeNull();
  });
  it('maps the row columns', () => {
    const row = parseLiveRow([{ data: { v: 1, teams: [] }, updated_by: 'u', by_name: 'דנה', updated_at: '2026-10-21T10:00:00Z' }])!;
    expect(row).toMatchObject({ updatedBy: 'u', byName: 'דנה', updatedAt: '2026-10-21T10:00:00Z' });
  });
});

describe('liveApi (mocked network)', () => {
  function fake(result: { data?: unknown; error?: unknown }) {
    const handlers: ((p: unknown) => void)[] = [];
    const channel = {
      on: vi.fn((_e: string, _f: unknown, h: (p: unknown) => void) => {
        handlers.push(h);
        return channel;
      }),
      subscribe: vi.fn(() => channel),
    };
    const sb = {
      rpc: vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null })),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => 'ok'),
    };
    return { sb, api: liveApi(sb as unknown as SupabaseClient), handlers, channel };
  }
  it('get / set / clear call the RPCs', async () => {
    const f = fake({ data: [{ data: { v: 1, teams: [] }, by_name: 'x' }] });
    expect((await f.api.get('g'))!.byName).toBe('x');
    expect(f.sb.rpc).toHaveBeenLastCalledWith('live_get', { p_group_id: 'g' });
    await f.api.set('g', null);
    expect(f.sb.rpc).toHaveBeenLastCalledWith('live_set', { p_group_id: 'g', p_data: null });
  });
  it('a player publishing is denied', async () => {
    const f = fake({ error: { message: 'not allowed', code: '42501' } });
    await expect(f.api.set('g', null)).rejects.toMatchObject({ code: 'denied' });
  });
  it('subscribes to the group row and unsubscribes', () => {
    const f = fake({});
    const seen: unknown[] = [];
    const off = f.api.subscribe('g1', (row) => seen.push(row));
    expect(f.channel.on.mock.calls[0][1]).toMatchObject({ table: 'group_live', filter: 'group_id=eq.g1' });
    f.handlers[0]({ eventType: 'UPDATE', new: { data: { v: 1, teams: [] }, by_name: 'n' } });
    f.handlers[0]({ eventType: 'UPDATE', new: { data: { ended: true } } });
    f.handlers[0]({ eventType: 'DELETE', old: {} });
    expect(seen).toEqual([expect.objectContaining({ byName: 'n' }), null, null]);
    off();
    expect(f.sb.removeChannel).toHaveBeenCalled();
  });
});
