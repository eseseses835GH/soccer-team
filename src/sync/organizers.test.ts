import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { creatorName, expiresIn, inviteUrl, parseInvites, parseOrganizers, shortDate } from './organizers';
import { SyncError, remoteApi } from './supabase';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();

describe('parseOrganizers', () => {
  it('keeps valid rows, oldest first, and marks me', () => {
    const out = parseOrganizers([
      { user_id: 'b', display_name: 'bob.k', role: 'organizer', joined_at: iso(NOW - DAY), is_me: true },
      { user_id: 'a', display_name: ' אלי ', role: 'organizer', joined_at: iso(NOW - 5 * DAY), is_me: false },
      { display_name: 'no id' },
      null,
      7,
    ]);
    expect(out.map((o) => o.userId)).toEqual(['a', 'b']);
    expect(out[0].name).toBe('אלי');
    expect(out[1].isMe).toBe(true);
    expect(out[0].isMe).toBe(false);
  });
  it('gives a nameless login a placeholder and survives garbage', () => {
    expect(parseOrganizers([{ user_id: 'x', display_name: '', joined_at: 'bad' }])[0]).toEqual({ userId: 'x', name: 'מארגן/ת', joinedAt: '', isMe: false });
    expect(parseOrganizers(null)).toEqual([]);
    expect(parseOrganizers({ user_id: 'x' })).toEqual([]);
  });
});

describe('parseInvites', () => {
  const row = (token: string, createdAgo: number, expiresIn: number, extra = {}) => ({
    token,
    created_by: 'a',
    created_at: iso(NOW - createdAgo),
    expires_at: iso(NOW + expiresIn),
    revoked_at: null,
    ...extra,
  });
  it('keeps only live links, newest first', () => {
    const out = parseInvites(
      [row('old', 3 * DAY, 11 * DAY), row('new', DAY, 13 * DAY), row('expired', 15 * DAY, -DAY), row('revoked', DAY, 13 * DAY, { revoked_at: iso(NOW) }), { token: 'x' }],
      NOW,
    );
    expect(out.map((i) => i.token)).toEqual(['new', 'old']);
    expect(out[0].createdBy).toBe('a');
  });
  it('a link whose creator was deleted has no creator', () => {
    expect(parseInvites([row('t', DAY, DAY, { created_by: null })], NOW)[0].createdBy).toBeNull();
  });
});

describe('creatorName / dates / links', () => {
  const orgs = parseOrganizers([
    { user_id: 'me', display_name: 'me', joined_at: iso(NOW), is_me: true },
    { user_id: 'b', display_name: 'בני', joined_at: iso(NOW), is_me: false },
  ]);
  const inv = (createdBy: string | null) => ({ token: 't', createdBy, createdAt: iso(NOW), expiresAt: iso(NOW + DAY) });
  it('names who made a link', () => {
    expect(creatorName(inv('me'), orgs)).toBe('את/ה');
    expect(creatorName(inv('b'), orgs)).toBe('בני');
    expect(creatorName(inv('gone'), orgs)).toBe('מארגן/ת לשעבר');
    expect(creatorName(inv(null), orgs)).toBe('מארגן/ת לשעבר');
  });
  it('says how long a link is still good', () => {
    expect(expiresIn(iso(NOW + 14 * DAY), NOW)).toBe('בתוקף עוד 14 ימים');
    expect(expiresIn(iso(NOW + 2 * DAY + 5), NOW)).toBe('בתוקף עוד יומיים');
    expect(expiresIn(iso(NOW + DAY + 5), NOW)).toBe('בתוקף עוד יום');
    expect(expiresIn(iso(NOW + 13 * DAY - 5000), NOW)).toBe('בתוקף עוד 13 ימים');
    expect(expiresIn(iso(NOW + 60_000), NOW)).toBe('בתוקף פחות מיום');
    expect(expiresIn(iso(NOW - 60_000), NOW)).toBe('בתוקף פחות מיום');
  });
  it('formats a short date and builds the join link', () => {
    expect(shortDate('nope')).toBe('');
    expect(shortDate(iso(NOW))).toMatch(/20.*10.*26/);
    expect(inviteUrl('abc', 'https://x.app/')).toBe('https://x.app/#join=abc');
  });
});

describe('remoteApi: organizers and invites (mocked network)', () => {
  function fakeClient(result: { data?: unknown; error?: unknown }) {
    const calls: { rpc: unknown[]; chain: string[] } = { rpc: [], chain: [] };
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'gt', 'order', 'limit']) {
      builder[m] = (...args: unknown[]) => {
        calls.chain.push(`${m}:${JSON.stringify(args)}`);
        return builder;
      };
    }
    builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(ok);
    const sb = {
      rpc: vi.fn(async (...args: unknown[]) => {
        calls.rpc.push(args);
        return { data: result.data ?? null, error: result.error ?? null };
      }),
      from: vi.fn(() => builder),
    } as unknown as SupabaseClient;
    return { sb, calls };
  }

  it('lists organizers through the RPC', async () => {
    const { sb, calls } = fakeClient({ data: [{ user_id: 'u', display_name: 'dana', joined_at: iso(NOW), is_me: true }] });
    const out = await remoteApi(sb).listOrganizers('g1');
    expect(calls.rpc[0]).toEqual(['group_organizers', { p_group_id: 'g1' }]);
    expect(out[0]).toMatchObject({ name: 'dana', isMe: true });
  });
  it('lists only live invites of the group', async () => {
    const { sb, calls } = fakeClient({ data: [{ token: 't', created_by: 'u', created_at: iso(Date.now()), expires_at: iso(Date.now() + DAY), revoked_at: null }] });
    const out = await remoteApi(sb).listInvites('g1');
    expect(out.map((i) => i.token)).toEqual(['t']);
    expect(calls.chain).toContain('eq:["group_id","g1"]');
    expect(calls.chain).toContain('is:["revoked_at",null]');
  });
  it('revokes through the RPC and maps errors', async () => {
    const ok = fakeClient({});
    await remoteApi(ok.sb).revokeInvite('tok');
    expect(ok.calls.rpc[0]).toEqual(['revoke_invite', { p_token: 'tok' }]);
    const denied = fakeClient({ error: { message: 'not a member', code: '42501' } });
    await expect(remoteApi(denied.sb).revokeInvite('tok')).rejects.toMatchObject({ code: 'denied' });
    const offline = fakeClient({ error: { message: 'TypeError: Failed to fetch' } });
    await expect(remoteApi(offline.sb).listOrganizers('g')).rejects.toBeInstanceOf(SyncError);
  });
});
