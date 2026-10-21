import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { applyCards } from '../state/cards';
import { defaultAttrs, type Player } from '../state/model';
import { applyPlayerVotes, mergePlayerVotes, parseMembers, parseMyVotes, parsePublic, parseVoteRows, playersApi, rateable } from './players';
import { remoteApi } from './supabase';

const U1 = '00000000-0000-4000-8000-000000000001'; // organizer
const U2 = '00000000-0000-4000-8000-000000000002'; // player who may rate
const U3 = '00000000-0000-4000-8000-000000000003'; // another one

describe('parsers', () => {
  it('members', () => {
    const out = parseMembers([
      { user_id: 'a', display_name: 'Dana', role: 'organizer', player_id: null, can_rate: false, joined_at: 'x', is_me: true },
      { user_id: 'b', display_name: '', role: 'player', player_id: 'p7', can_rate: true },
      { nope: 1 },
    ]);
    expect(out).toEqual([
      { userId: 'a', name: 'Dana', role: 'organizer', playerId: null, canRate: false, joinedAt: 'x', isMe: true },
      { userId: 'b', name: 'שחקן/ית', role: 'player', playerId: 'p7', canRate: true, joinedAt: '', isMe: false },
    ]);
    expect(parseMembers(null)).toEqual([]);
  });
  it('the public group', () => {
    const out = parsePublic({
      groupId: 'g',
      name: 'שכונה',
      players: [{ id: 'p1', name: 'Pini' }, { id: 'p2' }, { id: 'p3', name: '  ' }],
      history: 'bad',
      claimed: ['p1', 2],
      me: { role: 'player', playerId: 'p1', canRate: true },
      updatedAt: 't',
    })!;
    expect(out.players).toEqual([{ id: 'p1', name: 'Pini' }]);
    expect(out.history).toEqual([]);
    expect(out.claimed).toEqual(['p1']);
    expect(out.me).toEqual({ role: 'player', playerId: 'p1', canRate: true });
    expect(parsePublic(null)).toBeNull();
  });
  it('votes', () => {
    expect(parseMyVotes({ p1: 7, p2: 11, p3: 6.5, p4: '5' })).toEqual({ p1: 7 });
    expect(parseVoteRows([{ rater: U2.toUpperCase(), player_id: 'p1', level: 8 }, { rater: U2, player_id: 'p1', level: 0 }])).toEqual([{ rater: U2, playerId: 'p1', level: 8 }]);
  });
});

describe('merging players\' votes into the level', () => {
  const rows = [
    { rater: U2, playerId: 'p1', level: 9 },
    { rater: U3, playerId: 'p1', level: 8 },
    { rater: U2, playerId: 'p2', level: 3 },
  ];
  it('one vote per login; the doc (organizers) wins for the same login', () => {
    expect(mergePlayerVotes({ [U1]: 6 }, rows, 'p1')).toEqual({ [U1]: 6, [U2]: 9, [U3]: 8 });
    expect(mergePlayerVotes({ [U2]: 4 }, rows, 'p1')).toEqual({ [U2]: 4, [U3]: 8 });
    expect(mergePlayerVotes(undefined, [], 'p1')).toBeUndefined();
  });
  it('applyPlayerVotes moves the level to the average and keeps tuned sliders', () => {
    const plain: Player = { id: 'p1', name: 'A', attrs: applyCards(6, []), canGK: false, cards: [], levelVotes: { [U1]: 6 } };
    const tuned: Player = { id: 'p2', name: 'B', attrs: { ...defaultAttrs(5), stamina: 9 }, canGK: false, cards: [] };
    const untouched: Player = { id: 'p3', name: 'C', attrs: defaultAttrs(5), canGK: false, cards: [] };
    const out = applyPlayerVotes([plain, tuned, untouched], rows);
    expect(out[0].attrs).toEqual(applyCards(8, [])); // (6 + 9 + 8) / 3 = 7.67 → 8
    expect(out[0].levelVotes).toEqual({ [U1]: 6 }); // players' votes are not written into the doc
    expect(out[1].attrs).toEqual({ ...defaultAttrs(5), stamina: 9, overall: 3 });
    expect(out[2]).toBe(untouched);
    const same = [{ ...plain, attrs: applyCards(8, []) }];
    expect(applyPlayerVotes(same, rows)).toBe(same);
  });
  it('a rater never rates himself', () => {
    expect(rateable([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], 'a')).toEqual([{ id: 'b', name: 'B' }]);
  });
});

describe('playersApi / remoteApi (mocked network)', () => {
  function fake(result: { data?: unknown; error?: unknown }) {
    const chain: string[] = [];
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'gt', 'order', 'limit']) {
      builder[m] = (...args: unknown[]) => {
        chain.push(`${m}:${JSON.stringify(args)}`);
        return builder;
      };
    }
    builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(ok);
    const sb = {
      rpc: vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null })),
      from: vi.fn(() => builder),
    };
    return { sb, chain, api: playersApi(sb as unknown as SupabaseClient), remote: remoteApi(sb as unknown as SupabaseClient) };
  }
  it('calls each RPC with its arguments', async () => {
    const f = fake({ data: { p2: 7 } });
    await f.api.claimPlayer('g', 'p1');
    expect(f.sb.rpc).toHaveBeenLastCalledWith('claim_player', { p_group_id: 'g', p_player_id: 'p1' });
    await f.api.unclaimPlayer('g', 'u');
    expect(f.sb.rpc).toHaveBeenLastCalledWith('unclaim_player', { p_group_id: 'g', p_user_id: 'u' });
    await f.api.setCanRate('g', 'u', true);
    expect(f.sb.rpc).toHaveBeenLastCalledWith('set_can_rate', { p_group_id: 'g', p_user_id: 'u', p_can: true });
    await f.api.removePlayer('g', 'u');
    expect(f.sb.rpc).toHaveBeenLastCalledWith('remove_player', { p_group_id: 'g', p_user_id: 'u' });
    expect(await f.api.submitVotes('g', { p2: 7, p3: null })).toEqual({ p2: 7 });
    expect(f.sb.rpc).toHaveBeenLastCalledWith('submit_votes', { p_group_id: 'g', p_votes: { p2: 7, p3: null } });
    expect(await f.api.myVotes('g')).toEqual({ p2: 7 });
    await f.api.createPlayerInvite('g');
    expect(f.sb.rpc).toHaveBeenLastCalledWith('create_player_invite', { p_group_id: 'g' });
  });
  it('maps server errors', async () => {
    await expect(fake({ error: { message: 'already claimed', code: '23505' } }).api.claimPlayer('g', 'p')).rejects.toMatchObject({ code: 'taken' });
    await expect(fake({ error: { message: 'invalid votes', code: '22023' } }).api.submitVotes('g', {})).rejects.toMatchObject({ code: 'invalid' });
    await expect(fake({ error: { message: 'not allowed', code: '42501' } }).api.groupVotes('g')).rejects.toMatchObject({ code: 'denied' });
  });
  it('the player link and the organizer links are listed apart', async () => {
    const f = fake({ data: [{ token: 'pt' }] });
    expect(await f.api.playerInvite('g')).toBe('pt');
    expect(f.chain).toContain('eq:["role","player"]');
    const o = fake({ data: [] });
    await o.remote.listInvites('g');
    expect(o.chain).toContain('eq:["role","organizer"]');
  });
  it('join returns the role', async () => {
    expect(await fake({ data: [{ group_id: 'g', name: 'N', role: 'player' }] }).remote.joinGroup('t')).toEqual({ id: 'g', name: 'N', role: 'player' });
    expect(await fake({ data: [{ group_id: 'g', name: 'N' }] }).remote.joinGroup('t')).toMatchObject({ role: 'organizer' });
  });
});
