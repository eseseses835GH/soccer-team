import { describe, expect, it } from 'vitest';
import { bundleEdge, EDGE_URL, readEdge } from '../../scripts/build-edge.mjs';
import { keyOf, search } from '../engine';
import { applyCards } from '../state/cards';
import { DEFAULT_SETTINGS, sanitizePlayer } from '../state/model';
import { finishSplit, prepareSplit, teamTotals } from '../state/splitCore';
import { corsHeaders, handleSplit, parseSplitRequest, type SplitDeps, type SplitReply } from './splitTeams';

const GID = '11111111-2222-4333-8444-555555555555';
const ORG = 'aaaaaaaa-0000-4000-8000-000000000001';
const PLAYER = 'bbbbbbbb-0000-4000-8000-000000000002';
const R = (n: number) => `cccccccc-0000-4000-8000-00000000000${n}`;
const LEVELS = [9, 3, 7, 5, 8, 2, 6, 4, 7, 5, 6, 3];

const roster = () =>
  LEVELS.map((lv, i) => ({
    id: `p${i + 1}`,
    name: `שחקן ${i + 1}`,
    attrs: applyCards(lv, i % 4 === 0 ? ['beast'] : []),
    canGK: i % 5 === 0,
    cards: i % 4 === 0 ? ['beast'] : [],
    ...(i === 2 ? { levelVotes: { [ORG]: lv } } : {}),
    ...(i % 3 === 0 ? { positions: ['def'] } : {}),
  }));

type Over = { uid?: string | null; data?: unknown; mode?: string; votes?: unknown[]; members?: { user_id: string; role: string; can_rate: boolean | null }[]; seed?: () => number };
function deps(over: Over = {}): SplitDeps {
  const members = over.members ?? [
    { user_id: ORG, role: 'organizer', can_rate: null },
    { user_id: PLAYER, role: 'player', can_rate: null },
  ];
  return {
    userId: async () => (over.uid === undefined ? PLAYER : over.uid),
    role: async (g, u) => (g === GID ? (members.find((m) => m.user_id === u)?.role ?? null) : null),
    group: async (g) => (g === GID ? { data: over.data ?? { v: 1, players: roster(), constraints: { together: [['p1', 'p2']], apart: [] }, settings: { gkMode: 'rotate' } }, rating_mode: over.mode ?? 'organizers' } : null),
    members: async () => members,
    votes: async () => over.votes ?? [],
    seed: over.seed ?? (() => 12345),
  };
}

const ALL = LEVELS.map((_, i) => `p${i + 1}`);
/** 2 teams of 5: the exhaustive search, so the answer doesn't depend on time. */
const TEN = ALL.slice(0, 10);
const ok = (r: Awaited<ReturnType<typeof handleSplit>>): SplitReply => {
  expect(r.status).toBe(200);
  return r.body as SplitReply;
};

describe('split-teams handler', () => {
  it('a player gets teams with one total per team and nothing about any player but ids', async () => {
    const body = ok(await handleSplit({ groupId: GID, present: ALL.slice(0, 10), teamSize: 5 }, deps()));
    expect(body.sizes).toEqual([5, 5]);
    expect(body.totals).toHaveLength(2);
    expect(body.assignment).toHaveLength(10);
    expect(new Set([...body.playerIds, ...body.subIds])).toEqual(new Set(ALL.slice(0, 10)));
    expect(Object.keys(body).sort()).toEqual(['assignment', 'gkOrder', 'playerIds', 'rules', 'seed', 'sizes', 'subIds', 'teamSize', 'totals']);
    expect(Object.keys(body.rules).sort()).toEqual(['bibs', 'drawExtraMinutes', 'gkMode', 'gkSwitchGoals', 'hasBibs', 'matchMinutes', 'matchNoLimit']);
    const text = JSON.stringify(body);
    for (const leak of ['attrs', 'overall', 'levelVotes', 'cards', 'weights', 'positions', 'canGK', 'name', 'pool', 'cost']) expect(text).not.toContain(leak);
    // Only ids, numbers and the rules' words: no level hides in an array of numbers per player.
    expect(body.totals.every((t) => Number.isInteger(t))).toBe(true);
    expect(body.assignment.every((t) => t === 0 || t === 1)).toBe(true);
  });

  it('is exactly the app split for the same seed (same code, same roster)', async () => {
    const body = ok(await handleSplit({ groupId: GID, present: TEN, teamSize: 5 }, deps({ uid: ORG })));
    const src = {
      players: roster().map((p) => sanitizePlayer(p)!),
      presentIds: TEN,
      teamSize: 5,
      settings: { ...DEFAULT_SETTINGS, gkMode: 'rotate' as const },
      constraints: { together: [['p1', 'p2']] as [string, string][], apart: [] },
    };
    const prep = prepareSplit(src, 12345)!;
    const res = search(prep.req.players, prep.req.k, prep.req.options, prep.req.constraints, { seed: 12345, sizes: prep.req.sizes });
    const app = finishSplit(src, prep, res.best.assignment, 12345);
    expect(body.playerIds).toEqual(app.playerIds);
    expect(body.assignment).toEqual(app.assignment);
    expect(body.gkOrder).toEqual(app.gkOrder);
    expect(body.totals).toEqual(teamTotals(app.playerIds, app.assignment, 2, src.players, DEFAULT_SETTINGS.weights));
    // Keep-together is honoured.
    expect(body.assignment[body.playerIds.indexOf('p1')]).toBe(body.assignment[body.playerIds.indexOf('p2')]);
  });

  it('needs a login and membership', async () => {
    expect(await handleSplit({ groupId: GID, present: ALL, teamSize: 5 }, deps({ uid: null }))).toEqual({ status: 401, body: { error: 'auth' } });
    expect(await handleSplit({ groupId: GID, present: ALL, teamSize: 5 }, deps({ uid: 'dddddddd-0000-4000-8000-000000000009' }))).toEqual({ status: 403, body: { error: 'denied' } });
    const other = '22222222-2222-4333-8444-555555555555';
    expect(await handleSplit({ groupId: other, present: ALL, teamSize: 5 }, deps())).toEqual({ status: 403, body: { error: 'denied' } });
  });

  it('refuses bad input and too few players', async () => {
    expect((await handleSplit(null, deps())).status).toBe(400);
    expect((await handleSplit({ groupId: 'x', present: ALL, teamSize: 5 }, deps())).status).toBe(400);
    expect((await handleSplit({ groupId: GID, present: ALL, teamSize: 99 }, deps())).status).toBe(400);
    expect(await handleSplit({ groupId: GID, present: ['p1', 'p2', 'p3'], teamSize: 5 }, deps())).toEqual({ status: 400, body: { error: 'few' } });
    // Ids that aren't in the roster are ignored.
    expect(await handleSplit({ groupId: GID, present: ['p1', 'p2', 'p3', 'zz'], teamSize: 5 }, deps())).toEqual({ status: 400, body: { error: 'few' } });
    expect(parseSplitRequest({ groupId: GID, present: ['a', 'a', 'b'], teamSize: 3 })?.present).toEqual(['a', 'b']);
  });

  it("players' votes count like in the organizer app: allowed raters only, from 3 raters", async () => {
    const present = ALL.slice(0, 8);
    const base = ok(await handleSplit({ groupId: GID, present, teamSize: 4 }, deps()));
    const raters = [1, 2, 3].map((n) => ({ user_id: R(n), role: 'player', can_rate: null }));
    const members = [{ user_id: ORG, role: 'organizer', can_rate: null }, { user_id: PLAYER, role: 'player', can_rate: null }, ...raters];
    // p2 (level 3) gets three 10s.
    const votes = [1, 2, 3].map((n) => ({ rater: R(n), player_id: 'p2', level: 10 }));
    const sum = (b: SplitReply) => b.totals.reduce((a, x) => a + x, 0);
    const notAllowed = ok(await handleSplit({ groupId: GID, present, teamSize: 4 }, deps({ members, votes, mode: 'organizers' })));
    expect(sum(notAllowed)).toBe(sum(base));
    const everyone = ok(await handleSplit({ groupId: GID, present, teamSize: 4 }, deps({ members, votes, mode: 'everyone' })));
    expect(sum(everyone)).toBeGreaterThan(sum(base) + 4);
    const two = ok(await handleSplit({ groupId: GID, present, teamSize: 4 }, deps({ members, votes: votes.slice(0, 2), mode: 'everyone' })));
    expect(sum(two)).toBe(sum(base));
  });

  it('re-roll: same seed keeps the subs and order, gives another split', async () => {
    const first = ok(await handleSplit({ groupId: GID, present: ALL.slice(0, 11), teamSize: 5 }, deps()));
    expect(first.subIds).toHaveLength(1);
    const again = ok(await handleSplit({ groupId: GID, present: ALL.slice(0, 11), teamSize: 5, seed: first.seed, shown: [first.assignment] }, deps({ seed: () => 777 })));
    expect(again.subIds).toEqual(first.subIds);
    expect(again.playerIds).toEqual(first.playerIds);
    expect(keyOf(again.assignment)).not.toBe(keyOf(first.assignment));
  });

  it('CORS only for the app and local dev', () => {
    expect(corsHeaders('https://www.kadoregel.com')['Access-Control-Allow-Origin']).toBe('https://www.kadoregel.com');
    expect(corsHeaders('http://localhost:4173')['Access-Control-Allow-Origin']).toBe('http://localhost:4173');
    expect(corsHeaders('https://evil.example')['Access-Control-Allow-Origin']).toBeUndefined();
    expect(corsHeaders(null)['Access-Control-Allow-Origin']).toBeUndefined();
  });
});

describe('the deployed bundle', () => {
  it('supabase/functions/split-teams/core.js is up to date (node scripts/build-edge.mjs)', async () => {
    expect(readEdge()).toBe(await bundleEdge());
  });

  it('the bundle gives the same answer as the source', async () => {
    const core = (await import(/* @vite-ignore */ EDGE_URL)) as { handleSplit: typeof handleSplit };
    const req = { groupId: GID, present: TEN, teamSize: 5 };
    expect(await core.handleSplit(req, deps())).toEqual(await handleSplit(req, deps()));
  });
});
