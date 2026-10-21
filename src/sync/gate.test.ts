import { describe, expect, it } from 'vitest';
import { loadIndex, INDEX_KEY, type GroupMeta, type KV } from '../state/groups';
import { sampleSquad } from '../state/sample';
import { FREE_PLAYERS, MAX_PLAYERS, afterLoginQueue, gateNewGroup, gatePlayers, limitText, ownCount, shouldAutoUpload } from './gate';
import { SyncError, fail } from './supabase';

const own = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `p${from + i}` }));
const meta = (m: Partial<GroupMeta> = {}): GroupMeta => ({ id: 'g', name: 'הקבוצה שלי', synced: false, createdAt: 0, ...m });

describe('free players limit (logged out)', () => {
  it('is 4 own players', () => {
    expect(FREE_PLAYERS).toBe(4);
    expect(gatePlayers(true, own(3), own(1, 3))).toBe('ok');
    expect(gatePlayers(true, own(4), own(1, 4))).toBe('players');
  });

  it('counts only non-sample players', () => {
    const sample = sampleSquad();
    expect(ownCount([...sample, ...own(2)])).toBe(2);
    expect(gatePlayers(true, sample, own(4))).toBe('ok');
    expect(gatePlayers(true, [...sample, ...own(4)], own(1, 4))).toBe('players');
    // Loading the sample again never needs a login.
    expect(gatePlayers(true, own(4), sample)).toBe('ok');
  });

  it('an import past the limit asks once for the whole list', () => {
    expect(gatePlayers(true, [], own(19))).toBe('players');
    expect(gatePlayers(true, own(1), own(3, 1))).toBe('ok');
  });

  it('keeps an old phone with more than 4, but adds no more', () => {
    expect(gatePlayers(true, own(9), [])).toBe('ok');
    expect(gatePlayers(true, own(9), own(2))).toBe('ok'); // same ids: nothing new
    expect(gatePlayers(true, own(9), own(1, 9))).toBe('players');
  });

  it('never applies when logged in (or login is unavailable)', () => {
    expect(gatePlayers(false, own(4), own(20, 4))).toBe('ok');
  });

  it(`a group holds at most ${MAX_PLAYERS} players, for everyone`, () => {
    expect(gatePlayers(false, own(MAX_PLAYERS - 1), own(1, 500))).toBe('ok');
    expect(gatePlayers(false, own(MAX_PLAYERS), own(1, 500))).toBe('full');
  });
});

describe('one group when logged out', () => {
  it('"+ קבוצה חדשה" asks to log in', () => {
    expect(gateNewGroup(true)).toBe('group');
    expect(gateNewGroup(false)).toBe('ok');
  });
});

describe('blocked action → login → continues', () => {
  /** The app's flow in miniature: gate, open login with the action, the login fires the queue. */
  function app(loggedOut: boolean) {
    const q = afterLoginQueue();
    const players = own(4);
    const opened: string[] = [];
    const add = (p: { id: string }) => {
      const r = gatePlayers(loggedOut, players, [p]);
      const go = () => players.push(p);
      if (r === 'players') {
        opened.push(r);
        q.set(go);
      } else go();
    };
    return { q, players, opened, add };
  }

  it('the 5th player opens login and is added after it', () => {
    const a = app(true);
    a.add({ id: 'p4' });
    expect(a.opened).toEqual(['players']);
    expect(a.players).toHaveLength(4);
    expect(a.q.run()).toBe(true);
    expect(a.players.map((p) => p.id)).toContain('p4');
    expect(a.q.run()).toBe(false); // only once (a token refresh doesn't add him again)
  });

  it('closing the login sheet drops it', () => {
    const a = app(true);
    a.add({ id: 'p4' });
    a.q.clear();
    a.q.run();
    expect(a.players).toHaveLength(4);
  });

  it('logged in: added right away', () => {
    const a = app(false);
    a.add({ id: 'p4' });
    expect(a.opened).toEqual([]);
    expect(a.players).toHaveLength(5);
  });
});

describe('local group goes to the cloud after login', () => {
  const app = { players: own(2) };
  it('uploads the open local group with own players once logged in', () => {
    expect(shouldAutoUpload({ loggedIn: true, meta: meta(), app, pendingJoin: false })).toBe(true);
    expect(shouldAutoUpload({ loggedIn: false, meta: meta(), app, pendingJoin: false })).toBe(false);
  });
  it('not an empty or sample-only group, unless it was created logged in', () => {
    expect(shouldAutoUpload({ loggedIn: true, meta: meta(), app: { players: [] }, pendingJoin: false })).toBe(false);
    expect(shouldAutoUpload({ loggedIn: true, meta: meta(), app: { players: sampleSquad() }, pendingJoin: false })).toBe(false);
    expect(shouldAutoUpload({ loggedIn: true, meta: meta({ upload: true }), app: { players: [] }, pendingJoin: false })).toBe(true);
  });
  it('never a synced group, a player group, or while an invite is joined', () => {
    expect(shouldAutoUpload({ loggedIn: true, meta: meta({ synced: true }), app, pendingJoin: false })).toBe(false);
    expect(shouldAutoUpload({ loggedIn: true, meta: meta({ role: 'player' }), app, pendingJoin: false })).toBe(false);
    expect(shouldAutoUpload({ loggedIn: true, meta: meta(), app, pendingJoin: true })).toBe(false);
  });
  it('the "created logged in" mark survives a reload, and only for local groups', () => {
    const m = new Map<string, unknown>([[INDEX_KEY, { v: 1, currentId: 'a', groups: [meta({ id: 'a', upload: true }), meta({ id: 'b', synced: true, upload: true })] }]]);
    const kv: KV = { get: (k) => m.get(k) ?? null, set: (k, v) => (m.set(k, v), true), remove: (k) => void m.delete(k) };
    const idx = loadIndex(kv);
    expect(idx.groups[0].upload).toBe(true);
    expect(idx.groups[1].upload).toBeUndefined();
  });
});

describe('server caps', () => {
  it('54000 is a limit error, named in Hebrew', () => {
    let err: unknown;
    try {
      fail({ code: '54000', message: 'groups_limit' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyncError);
    expect((err as SyncError).code).toBe('limit');
    expect(limitText('groups_limit')).toBe('אפשר לפתוח עד 20 קבוצות בחשבון');
    expect(limitText('players_limit')).toContain('200');
    expect(limitText('memberships_limit')).toContain('50');
    expect(limitText('something new')).toBe('הגעתם למגבלה של השרת');
  });
});
