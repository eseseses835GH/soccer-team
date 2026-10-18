import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUP_NAME,
  INDEX_KEY,
  LEGACY_KEY,
  addGroup,
  cleanName,
  deleteGroupData,
  groupKey,
  loadGroupState,
  loadIndex,
  newGroupState,
  removeGroup,
  syncKey,
  updateGroup,
  type KV,
} from './groups';
import { INITIAL_STATE } from './model';

function memKV(init: Record<string, unknown> = {}, failWrites = false) {
  const m = new Map<string, string>(Object.entries(init).map(([k, v]) => [k, JSON.stringify(v)]));
  const kv: KV & { m: Map<string, string> } = {
    m,
    get: (k) => (m.has(k) ? JSON.parse(m.get(k)!) : null),
    set: (k, v) => {
      if (failWrites) return false;
      m.set(k, JSON.stringify(v));
      return true;
    },
    remove: (k) => void m.delete(k),
  };
  return kv;
}

const NOW = 1_800_000_000_000;
const legacy = {
  version: 2,
  players: [{ id: 'a', name: 'אבי', attrs: { overall: 8 }, canGK: false, cards: [] }],
  presentIds: ['a'],
  dayAt: NOW - 1000,
  teamSize: 6,
  settings: { matchMinutes: 11, theme: 'dark' },
  constraints: { together: [], apart: [] },
  result: null,
  match: null,
};

describe('group index + migration from kochot:v1', () => {
  it('turns existing data into the first group, losing nothing', () => {
    const kv = memKV({ [LEGACY_KEY]: legacy });
    const idx = loadIndex(kv, NOW, () => 'g1');
    expect(idx).toEqual({ v: 1, currentId: 'g1', groups: [{ id: 'g1', name: DEFAULT_GROUP_NAME, synced: false, createdAt: NOW }] });
    expect(kv.get(groupKey('g1'))).toEqual(legacy);
    expect(kv.m.has(LEGACY_KEY)).toBe(false);
    const s = loadGroupState(kv, 'g1', NOW);
    expect(s.players.map((p) => p.name)).toEqual(['אבי']);
    expect(s.presentIds).toEqual(['a']);
    expect(s.teamSize).toBe(6);
    expect(s.settings.matchMinutes).toBe(11);
    expect(s.settings.theme).toBe('dark');
  });

  it('is idempotent once the index exists', () => {
    const kv = memKV({ [LEGACY_KEY]: legacy });
    loadIndex(kv, NOW, () => 'g1');
    expect(loadIndex(kv, NOW, () => 'other').currentId).toBe('g1');
  });

  it('a fresh install gets one empty group', () => {
    const kv = memKV();
    const idx = loadIndex(kv, NOW, () => 'g1');
    expect(idx.groups).toHaveLength(1);
    expect(kv.get(INDEX_KEY)).toEqual(idx);
    expect(loadGroupState(kv, 'g1', NOW)).toEqual(INITIAL_STATE);
  });

  it('keeps the old key if the new keys could not be written', () => {
    const kv = memKV({ [LEGACY_KEY]: legacy }, true);
    loadIndex(kv, NOW, () => 'g1');
    expect(kv.m.has(LEGACY_KEY)).toBe(true);
  });

  it('repairs a damaged index', () => {
    const kv = memKV({ [INDEX_KEY]: { v: 1, currentId: 'nope', groups: [{ id: 'x', name: '  ' }, { id: 'x', name: 'dup' }, { bad: 1 }] } });
    const idx = loadIndex(kv, NOW, () => 'g1');
    expect(idx.groups).toEqual([{ id: 'x', name: DEFAULT_GROUP_NAME, synced: false, createdAt: 0 }]);
    expect(idx.currentId).toBe('x');
    expect(loadIndex(memKV({ [INDEX_KEY]: { groups: [] } }), NOW, () => 'g1').currentId).toBe('g1');
  });
});

describe('group index edits', () => {
  const base = { v: 1 as const, currentId: 'a', groups: [{ id: 'a', name: 'בית', synced: false, createdAt: 0 }] };
  it('adds, renames and removes', () => {
    let idx = addGroup(base, { id: 'b', name: 'בסיס', synced: false, createdAt: 1 });
    idx = addGroup(idx, { id: 'c', name: 'משרד', synced: true, createdAt: 2 });
    expect(idx.groups.map((g) => g.id)).toEqual(['a', 'b', 'c']);
    idx = updateGroup(idx, 'b', { name: '  כדורגל   בשכונה ' });
    expect(idx.groups[1].name).toBe('כדורגל בשכונה');
    expect(updateGroup(idx, 'b', { name: '   ' }).groups[1].name).toBe('כדורגל בשכונה');
    idx = { ...idx, currentId: 'b' };
    idx = removeGroup(idx, 'b');
    expect(idx.groups.map((g) => g.id)).toEqual(['a', 'c']);
    expect(idx.currentId).toBe('a');
    expect(removeGroup(base, 'a')).toBe(base); // never the last one
  });
  it('re-adding an id updates it instead of duplicating', () => {
    expect(addGroup(base, { id: 'a', name: 'x', synced: true, createdAt: 0 }).groups).toEqual([{ id: 'a', name: 'x', synced: true, createdAt: 0 }]);
  });
  it('deletes a group’s data and sync bookkeeping', () => {
    const kv = memKV({ [groupKey('a')]: {}, [syncKey('a')]: {}, [groupKey('b')]: {} });
    deleteGroupData(kv, 'a');
    expect([...kv.m.keys()]).toEqual([groupKey('b')]);
  });
  it('names are trimmed and capped', () => {
    expect(cleanName('x'.repeat(60))).toHaveLength(40);
  });
  it('a new group starts empty with this phone’s look', () => {
    const s = newGroupState({ theme: 'dark', accent: 'pink' });
    expect(s.players).toEqual([]);
    expect(s.settings.theme).toBe('dark');
    expect(s.settings.accent).toBe('pink');
  });
});

describe('uuid', () => {
  it('makes v4 uuids', async () => {
    const { uuid, isUuid } = await import('./groups');
    const a = uuid();
    expect(isUuid(a)).toBe(true);
    expect(a[14]).toBe('4');
    expect(uuid()).not.toBe(a);
  });
});
