import { describe, expect, it, vi } from 'vitest';
import type { EveningRecord } from '../state/history';
import { INITIAL_STATE, defaultAttrs, type AppState, type Player } from '../state/model';
import type { KV } from '../state/groups';
import { applyDoc, docFromState, mergeById, mergeDocs, sanitizeDoc, stableKey, type SyncDoc } from './doc';
import { EMPTY_META, hasLocalChanges, loadMeta, saveMeta, syncGroup, type RemoteApi, type RemoteGroup } from './engine';

const p = (id: string, level = 5, name = id): Player => ({ id, name, attrs: defaultAttrs(level), canGK: false, cards: [] });
const doc = (players: Player[], extra: Partial<SyncDoc> = {}): SyncDoc => ({
  ...docFromState({ ...INITIAL_STATE, players }),
  ...extra,
});

describe('stableKey', () => {
  it('ignores key order and undefined fields', () => {
    expect(stableKey({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(stableKey({ b: [1, { d: 3, c: 2 }], a: 1, z: undefined }));
    expect(stableKey({ a: 1 })).not.toBe(stableKey({ a: 2 }));
  });
});

describe('docFromState / applyDoc', () => {
  it('leaves out the per-phone look and tonight', () => {
    const s: AppState = { ...INITIAL_STATE, players: [p('a')], presentIds: ['a'], settings: { ...INITIAL_STATE.settings, theme: 'dark', accent: 'pink' } };
    const d = docFromState(s);
    expect(d.settings).not.toHaveProperty('theme');
    expect(d.settings).not.toHaveProperty('accent');
    expect(d).not.toHaveProperty('presentIds');
    expect(d).not.toHaveProperty('history');
  });
  it('carries the evenings history, and drops broken records coming from the server', () => {
    const s: AppState = { ...INITIAL_STATE, history: [ev('e1', 1)] };
    expect(docFromState(s).history?.map((h) => h.id)).toEqual(['e1']);
    expect(sanitizeDoc({ history: [ev('e1', 1), { bad: true }] }).history?.map((h) => h.id)).toEqual(['e1']);
  });
  it('applies a doc but keeps this phone’s look and attendance', () => {
    const mine: AppState = { ...INITIAL_STATE, players: [p('a')], presentIds: ['a'], settings: { ...INITIAL_STATE.settings, theme: 'dark', accent: 'blue' } };
    const incoming = doc([p('a', 9), p('b')], { settings: { ...docFromState(INITIAL_STATE).settings, matchMinutes: 12 } });
    const next = applyDoc(mine, incoming);
    expect(next.players.map((x) => x.attrs.overall)).toEqual([9, 5]);
    expect(next.presentIds).toEqual(['a']);
    expect(next.settings.matchMinutes).toBe(12);
    expect(next.settings.theme).toBe('dark');
    expect(next.settings.accent).toBe('blue');
  });
  it('sanitizes garbage from the server', () => {
    const d = sanitizeDoc({ players: [{ id: 'x', name: ' X ', attrs: { overall: 99 } }, 7, null], constraints: { together: [['x']], apart: 'no' }, settings: { matchMinutes: -1 } });
    expect(d.players).toHaveLength(1);
    expect(d.players[0].name).toBe('X');
    expect(d.constraints).toEqual({ together: [], apart: [] });
    expect(d.settings.matchMinutes).toBe(8);
    expect(sanitizeDoc(null).players).toEqual([]);
  });
});

describe('mergeById', () => {
  const base = [p('a'), p('b'), p('c')];
  it('keeps players added on either side', () => {
    const out = mergeById(base, [...base, p('mine')], [...base, p('theirs')]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c', 'mine', 'theirs']);
  });
  it('takes the side that changed a player', () => {
    const out = mergeById(base, [p('a', 9), p('b'), p('c')], [p('a'), p('b', 2), p('c')]);
    expect(out.map((x) => x.attrs.overall)).toEqual([9, 2, 5]);
  });
  it('deletes on either side when the other side did not touch it', () => {
    expect(mergeById(base, [p('a'), p('c')], base).map((x) => x.id)).toEqual(['a', 'c']);
    expect(mergeById(base, base, [p('b'), p('c')]).map((x) => x.id)).toEqual(['b', 'c']);
  });
  it('an edit beats a delete', () => {
    expect(mergeById(base, [p('b'), p('c')], [p('a', 8), p('b'), p('c')]).map((x) => x.id).sort()).toEqual(['a', 'b', 'c']);
    expect(mergeById(base, [p('a', 8), p('b'), p('c')], [p('b'), p('c')]).find((x) => x.id === 'a')?.attrs.overall).toBe(8);
  });
  it('both edited: this phone wins', () => {
    expect(mergeById(base, [p('a', 9), p('b'), p('c')], [p('a', 1), p('b'), p('c')])[0].attrs.overall).toBe(9);
  });
  it('without a base nothing is deleted', () => {
    expect(mergeById([], [p('a')], [p('b')]).map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('mergeDocs', () => {
  it('carries player positions through the server and merges an edit to them', () => {
    const withPos = { ...p('a'), canGK: true, positions: ['def', 'att'] } as Player;
    const fromServer = sanitizeDoc(JSON.parse(JSON.stringify(doc([withPos, p('b')]))));
    expect(fromServer.players[0].positions).toEqual(['def', 'att']);
    expect(fromServer.players[0].canGK).toBe(true);
    // A player without positions keeps its old shape, so old copies don't look edited.
    expect(fromServer.players[1]).toEqual(p('b'));
    const base = doc([p('a'), p('b')]);
    const m = mergeDocs(base, base, doc([withPos, p('b')]));
    expect(m.players[0].positions).toEqual(['def', 'att']);
    expect(sanitizeDoc({ players: [{ ...withPos, positions: ['mid', 'xx', 'mid'] }] }).players[0].positions).toEqual(['mid']);
  });
  it('merges pair rules as a set and drops pairs of deleted players', () => {
    const base = doc([p('a'), p('b'), p('c'), p('d')], { constraints: { together: [['a', 'b']], apart: [] } });
    const local = { ...base, constraints: { together: [['a', 'b']], apart: [['c', 'd']] } } as SyncDoc;
    const remote = { ...base, players: base.players.filter((x) => x.id !== 'd'), constraints: { together: [], apart: [] } } as SyncDoc;
    const m = mergeDocs(base, local, remote);
    // a|b removed remotely; c|d added locally but d was deleted remotely.
    expect(m.constraints).toEqual({ together: [], apart: [] });
    const m2 = mergeDocs(base, local, { ...base, constraints: { together: [['b', 'a']], apart: [] } });
    expect(m2.constraints).toEqual({ together: [['a', 'b']], apart: [['c', 'd']] });
  });
  it('a pair can’t end up both together and apart (local wins)', () => {
    const base = doc([p('a'), p('b')]);
    const m = mergeDocs(base, { ...base, constraints: { together: [['a', 'b']], apart: [] } }, { ...base, constraints: { together: [], apart: [['b', 'a']] } });
    expect(m.constraints).toEqual({ together: [['a', 'b']], apart: [] });
  });
  it('merges settings field by field', () => {
    const base = doc([]);
    const local = { ...base, settings: { ...base.settings, matchMinutes: 10 } };
    const remote = { ...base, settings: { ...base.settings, gkMode: 'fixed' as const } };
    const m = mergeDocs(base, local, remote);
    expect(m.settings.matchMinutes).toBe(10);
    expect(m.settings.gkMode).toBe('fixed');
  });
  it('merges history records by id when present', () => {
    const base = doc([], { history: [ev('e1', 1)] });
    const m = mergeDocs(base, { ...base, history: [ev('e1', 1), ev('e2', 2)] }, { ...base, history: [ev('e1', 1), ev('e3', 3)] });
    expect(m.history?.map((h) => h.id)).toEqual(['e3', 'e2', 'e1']); // newest first
    expect(mergeDocs(doc([]), doc([]), doc([]))).not.toHaveProperty('history');
  });
});

// ---------- engine with a fake server ----------

function fakeServer(initial: RemoteGroup) {
  let row = { ...initial };
  const api: RemoteApi & { row: () => RemoteGroup; bump: (data: SyncDoc) => void } = {
    fetchGroup: vi.fn(async (id: string) => (id === row.id ? { ...row } : null)),
    pushGroup: vi.fn(async (_id: string, version: number, data: SyncDoc, name?: string) => {
      if (version !== row.version) return null;
      row = { ...row, data, version: row.version + 1, name: name ?? row.name };
      return row.version;
    }),
    row: () => row,
    bump: (data) => {
      row = { ...row, data, version: row.version + 1 };
    },
  };
  return api;
}

describe('syncGroup', () => {
  it('pulls when only the server changed, without pushing', async () => {
    const base = doc([p('a')]);
    const api = fakeServer({ id: 'g', name: 'שכונה', data: doc([p('a'), p('b')]), version: 2 });
    const out = await syncGroup(api, 'g', base, 'שכונה', { base, baseVersion: 1, baseName: 'שכונה' });
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.pushed).toBe(false);
    expect(out.pulled).toBe(true);
    expect(out.doc.players.map((x) => x.id)).toEqual(['a', 'b']);
    expect(out.meta.baseVersion).toBe(2);
    expect(api.pushGroup).not.toHaveBeenCalled();
  });

  it('pushes local changes and records the new version', async () => {
    const base = doc([p('a')]);
    const api = fakeServer({ id: 'g', name: 'שכונה', data: base, version: 1 });
    const out = await syncGroup(api, 'g', doc([p('a'), p('new')]), 'שכונה', { base, baseVersion: 1, baseName: 'שכונה' });
    expect(out.kind === 'ok' && out.pushed).toBe(true);
    expect(api.row().version).toBe(2);
    expect(sanitizeDoc(api.row().data).players.map((x) => x.id)).toEqual(['a', 'new']);
  });

  it('two phones adding players offline: neither player is lost', async () => {
    const base = doc([p('a')]);
    const api = fakeServer({ id: 'g', name: 'שכונה', data: base, version: 1 });
    const meta = { base, baseVersion: 1, baseName: 'שכונה' };
    await syncGroup(api, 'g', doc([p('a'), p('fromA')]), 'שכונה', meta);
    const out = await syncGroup(api, 'g', doc([p('a'), p('fromB')]), 'שכונה', meta);
    expect(out.kind === 'ok' && out.doc.players.map((x) => x.id)).toEqual(['a', 'fromB', 'fromA']);
    expect(sanitizeDoc(api.row().data).players).toHaveLength(3);
  });

  it('retries after losing a version race', async () => {
    const base = doc([p('a')]);
    const api = fakeServer({ id: 'g', name: 'שכונה', data: base, version: 1 });
    const realPush = api.pushGroup;
    let raced = false;
    api.pushGroup = vi.fn(async (...args: Parameters<RemoteApi['pushGroup']>) => {
      if (!raced) {
        raced = true;
        api.bump(doc([p('a'), p('other')])); // another phone got in first
      }
      return realPush(...args);
    });
    const out = await syncGroup(api, 'g', doc([p('a'), p('mine')]), 'שכונה', { base, baseVersion: 1, baseName: 'שכונה' });
    expect(out.kind).toBe('ok');
    expect(sanitizeDoc(api.row().data).players.map((x) => x.id).sort()).toEqual(['a', 'mine', 'other']);
    expect(api.pushGroup).toHaveBeenCalledTimes(2);
  });

  it('a local rename is pushed; otherwise the server name is taken', async () => {
    const base = doc([]);
    const api = fakeServer({ id: 'g', name: 'ישן', data: base, version: 1 });
    const out = await syncGroup(api, 'g', base, 'חדש', { base, baseVersion: 1, baseName: 'ישן' });
    expect(out.kind === 'ok' && out.name).toBe('חדש');
    expect(api.row().name).toBe('חדש');
    const out2 = await syncGroup(api, 'g', base, 'אחר', { base, baseVersion: 2, baseName: 'אחר' });
    expect(out2.kind === 'ok' && out2.name).toBe('חדש');
  });

  it('reports a group that is gone (deleted or no access)', async () => {
    const api = fakeServer({ id: 'other', name: 'x', data: {}, version: 1 });
    expect((await syncGroup(api, 'g', doc([]), 'x', EMPTY_META)).kind).toBe('gone');
  });

  it('network errors propagate (the caller keeps local changes for later)', async () => {
    const api: RemoteApi = { fetchGroup: async () => Promise.reject(new Error('offline')), pushGroup: async () => 1 };
    await expect(syncGroup(api, 'g', doc([]), 'x', EMPTY_META)).rejects.toThrow('offline');
  });
});

describe('sync meta', () => {
  it('round-trips and detects local changes', () => {
    const m = new Map<string, unknown>();
    const kv: KV = { get: (k) => m.get(k) ?? null, set: (k, v) => (m.set(k, JSON.parse(JSON.stringify(v))), true), remove: (k) => void m.delete(k) };
    expect(loadMeta(kv, 'g')).toEqual(EMPTY_META);
    const base = doc([p('a')]);
    saveMeta(kv, 'g', { base, baseVersion: 3, baseName: 'n' });
    const meta = loadMeta(kv, 'g');
    expect(meta.baseVersion).toBe(3);
    expect(hasLocalChanges(meta, base, 'n')).toBe(false);
    expect(hasLocalChanges(meta, doc([p('a', 7)]), 'n')).toBe(true);
    expect(hasLocalChanges(meta, base, 'renamed')).toBe(true);
  });
});

function ev(id: string, day: number): EveningRecord {
  const t = day * 864e5;
  return {
    id,
    v: 1,
    startedAt: t,
    endedAt: t + 36e5,
    teamSize: 5,
    players: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }],
    teams: [{ bib: 'red', ids: ['a'] }, { bib: 'blue', ids: ['b'] }],
    subIds: [],
    matches: [{ a: 0, b: 1, goalsA: 1, goalsB: 0, goals: [{ team: 0 }], endedAt: t + 6e5 }],
  };
}
