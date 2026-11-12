// v19 "אני לא ברשימה": players add themselves on the server while organizers edit on their phones.
// The server is the source of truth for the roster; an organizer's phone must never drop a player
// who joined meanwhile (the conditional push + three-way merge in engine.ts / doc.ts).
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { INITIAL_STATE, defaultAttrs, sanitizePlayer, type Player } from '../state/model';
import { docFromState, sanitizeDoc, type SyncDoc } from './doc';
import { EMPTY_META, hasLocalChanges, syncGroup, type RemoteApi, type SyncMeta } from './engine';
import { cleanName, sameName, withJoined } from './playerGroup';
import { playersApi, type PublicGroup } from './players';
import { SyncError } from './supabase';

const p = (id: string, level = 5, name = id): Player => ({ id, name, attrs: defaultAttrs(level), canGK: false, cards: [] });
const doc = (players: Player[]): SyncDoc => docFromState({ ...INITIAL_STATE, players });
const ids = (d: SyncDoc) => d.players.map((x) => x.id);

/** The player join_as_new_player appends (same JSON as the SQL builds). */
const serverPlayer = (id: string, name: string) => ({
  id,
  name,
  attrs: { overall: 5, stamina: 5, passing: 5, dribbling: 5, shooting: 5, defense: 5, teamwork: 5, leadership: 5 },
  canGK: false,
  cards: [],
});

/** An in-memory `groups` row with the server's rules: version bumped on every write, conditional push. */
function server(players: Player[] = []) {
  const s = {
    data: JSON.parse(JSON.stringify(doc(players))) as Record<string, unknown> & { players: unknown[] },
    version: 1,
    name: 'ערב',
    online: true,
    /** Runs once right before the next push lands (another phone / a join sneaking in). */
    beforePush: null as null | (() => void),
    pushes: 0,
    join(id: string, name: string) {
      if (sameName(s.data.players as { name: string }[], name)) throw new Error('name_taken');
      s.data = { ...s.data, players: [...s.data.players, serverPlayer(id, cleanName(name))] };
      s.version++;
    },
  };
  const api: RemoteApi = {
    async fetchGroup() {
      if (!s.online) throw new SyncError('Failed to fetch', 'offline');
      return { id: 'g', name: s.name, data: JSON.parse(JSON.stringify(s.data)), version: s.version };
    },
    async pushGroup(_id, version, data) {
      if (!s.online) throw new SyncError('Failed to fetch', 'offline');
      const hook = s.beforePush;
      s.beforePush = null;
      hook?.();
      if (version !== s.version) return null;
      s.data = JSON.parse(JSON.stringify(data));
      s.version++;
      s.pushes++;
      return s.version;
    },
  };
  return { s, api };
}

/** One organizer phone: local doc + meta, running rounds like SyncProvider does. */
async function round(api: RemoteApi, local: SyncDoc, meta: SyncMeta) {
  const out = await syncGroup(api, 'g', local, 'ערב', meta);
  if (out.kind !== 'ok') throw new Error('gone');
  return out;
}

describe('self-joined players and the organizer sync', () => {
  it('the server-made player is exactly what the app keeps (no rewrite, no extra push)', async () => {
    expect(sanitizePlayer(serverPlayer('x', 'דני'))).toEqual(serverPlayer('x', 'דני'));
    const { s, api } = server([]);
    let out = await round(api, doc([]), EMPTY_META);
    s.join('n1', 'דני');
    out = await round(api, out.doc, out.meta);
    expect(ids(out.doc)).toEqual(['n1']);
    expect(out.pushed).toBe(false);
    expect(s.pushes).toBe(0);
  });

  it('a join between the organizer’s pull and push: the push loses the race and re-merges, nobody is lost', async () => {
    const { s, api } = server([p('a'), p('b')]);
    const first = await round(api, doc([p('a'), p('b')]), EMPTY_META);
    s.beforePush = () => s.join('n1', 'דני');
    const out = await round(api, doc([p('a', 9), p('b')]), first.meta);
    expect(ids(out.doc)).toEqual(['a', 'b', 'n1']);
    expect(out.doc.players[0].attrs.overall).toBe(9);
    expect(ids(sanitizeDoc(s.data))).toEqual(['a', 'b', 'n1']);
  });

  it('organizer edits and deletes others while players join: all of it lands', async () => {
    const { s, api } = server([p('a'), p('b'), p('c')]);
    const first = await round(api, doc([p('a'), p('b'), p('c')]), EMPTY_META);
    s.join('n1', 'דני');
    s.join('n2', 'יוסי');
    // Organizer (who hasn't seen them yet) renames a, deletes c, adds his own d.
    const out = await round(api, doc([p('a', 5, 'אבי'), p('b'), p('d')]), first.meta);
    const server_ = sanitizeDoc(s.data);
    expect(ids(server_)).toEqual(['a', 'b', 'd', 'n1', 'n2']);
    expect(server_.players[0].name).toBe('אבי');
    expect(out.doc).toEqual(server_);
  });

  it('an organizer can still delete a joined player he has seen, and edit him', async () => {
    const { s, api } = server([p('a')]);
    let out = await round(api, doc([p('a')]), EMPTY_META);
    s.join('n1', 'דני');
    s.join('n2', 'רון');
    out = await round(api, out.doc, out.meta); // the organizer now sees both
    const edited = out.doc.players.filter((x) => x.id !== 'n2').map((x) => (x.id === 'n1' ? { ...x, attrs: defaultAttrs(8) } : x));
    s.join('n3', 'טל'); // and one more joins meanwhile
    out = await round(api, doc(edited), out.meta);
    const server_ = sanitizeDoc(s.data);
    expect(ids(server_)).toEqual(['a', 'n1', 'n3']);
    expect(server_.players.find((x) => x.id === 'n1')?.attrs.overall).toBe(8);
  });

  it('offline edits wait (local ≠ base is the queue) and apply when back online, next to the joins', async () => {
    const { s, api } = server([p('a'), p('b')]);
    const first = await round(api, doc([p('a'), p('b')]), EMPTY_META);
    s.online = false;
    const local = doc([p('a', 3)]); // edit a, delete b, while offline
    await expect(round(api, local, first.meta)).rejects.toMatchObject({ code: 'offline' });
    expect(hasLocalChanges(first.meta, local, 'ערב')).toBe(true); // still queued (meta untouched)
    s.online = true;
    s.join('n1', 'דני'); // someone joined while the organizer was offline
    const out = await round(api, local, first.meta);
    expect(ids(sanitizeDoc(s.data))).toEqual(['a', 'n1']);
    expect(out.doc.players[0].attrs.overall).toBe(3);
    expect(hasLocalChanges(out.meta, out.doc, 'ערב')).toBe(false);
  });

  it('a phone that never synced (no base) deletes nothing on the server', async () => {
    const { s, api } = server([]);
    s.join('n1', 'דני');
    await round(api, doc([p('mine')]), EMPTY_META);
    expect(ids(sanitizeDoc(s.data)).sort()).toEqual(['mine', 'n1']);
  });

  it('two people joining one after the other both stay', async () => {
    const { s, api } = server([]);
    const first = await round(api, doc([]), EMPTY_META);
    s.join('n1', 'דני');
    s.join('n2', 'רון');
    expect(() => s.join('n3', ' דנ  י ')).toThrow('name_taken');
    const out = await round(api, doc([p('x')]), first.meta);
    expect(ids(out.doc)).toEqual(['x', 'n1', 'n2']);
  });
});

describe('join form helpers', () => {
  it('cleans names like the server and finds the same name ignoring case and spaces', () => {
    expect(cleanName('  דני   כהן ')).toBe('דני כהן');
    const roster = [{ id: '1', name: 'Dani Cohen' }, { id: '2', name: 'יוסי' }];
    expect(sameName(roster, 'dani  cohen')?.id).toBe('1');
    expect(sameName(roster, 'DaniCohen')?.id).toBe('1');
    expect(sameName(roster, ' יוסי ')?.id).toBe('2');
    expect(sameName(roster, 'יוסף')).toBeUndefined();
    expect(sameName(roster, '   ')).toBeUndefined();
  });

  it('withJoined adds me to the roster and claims me', () => {
    const pub: PublicGroup = { groupId: 'g', name: 'ערב', players: [], history: [], claimed: [], me: { role: 'player', playerId: null, canRate: true }, updatedAt: '' };
    const next = withJoined(pub, 'n1', 'דני');
    expect(next.players).toEqual([{ id: 'n1', name: 'דני' }]);
    expect(next.claimed).toEqual(['n1']);
    expect(next.me.playerId).toBe('n1');
    expect(withJoined(next, 'n1', 'דני').players).toHaveLength(1);
  });
});

describe('playersApi.joinAsNew', () => {
  const sb = (result: { data?: unknown; error?: { code: string; message: string } }) => {
    const rpc = vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null }));
    return { api: playersApi({ rpc } as unknown as SupabaseClient), rpc };
  };
  it('calls join_as_new_player and returns the new id', async () => {
    const { api, rpc } = sb({ data: 'abc' });
    await expect(api.joinAsNew('g', 'דני')).resolves.toBe('abc');
    expect(rpc).toHaveBeenCalledWith('join_as_new_player', { p_group_id: 'g', p_name: 'דני' });
  });
  it('maps the errors: name taken, already claimed, full roster', async () => {
    await expect(sb({ error: { code: '23505', message: 'name_taken' } }).api.joinAsNew('g', 'x')).rejects.toMatchObject({ code: 'name' });
    await expect(sb({ error: { code: '23505', message: 'already claimed' } }).api.joinAsNew('g', 'x')).rejects.toMatchObject({ code: 'taken' });
    await expect(sb({ error: { code: '54000', message: 'players_limit' } }).api.joinAsNew('g', 'x')).rejects.toMatchObject({ code: 'limit' });
    await expect(sb({ error: { code: '42501', message: 'not allowed' } }).api.joinAsNew('g', 'x')).rejects.toMatchObject({ code: 'denied' });
  });
});
