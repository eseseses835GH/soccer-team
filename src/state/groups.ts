// Groups ("קבוצות"): each group has its own app state on this phone.
//
// Keys:
//   kochot:groups          index { v, currentId, groups: GroupMeta[] }
//   kochot:group:<id>      the group's AppState (the same shape `kochot:v1` used to hold)
//   kochot:sync:<id>       sync bookkeeping for groups that live in the cloud (see sync/engine)
// Before groups existed the whole state lived in `kochot:v1`. On first run it becomes the first
// group ("הקבוצה שלי"); the old key is removed only after the new keys were written.
import { INITIAL_STATE, sanitize, type AppState } from './model';

export interface GroupMeta {
  id: string;
  name: string;
  /** True once the group was uploaded to (or joined from) the cloud. */
  synced: boolean;
  createdAt: number;
}

export interface GroupIndex {
  v: 1;
  currentId: string;
  groups: GroupMeta[];
}

/** Minimal key-value storage (localStorage in the app, a Map in tests). */
export interface KV {
  get(key: string): unknown;
  set(key: string, value: unknown): boolean;
  remove(key: string): void;
}

export const LEGACY_KEY = 'kochot:v1';
export const INDEX_KEY = 'kochot:groups';
export const groupKey = (id: string) => `kochot:group:${id}`;
export const syncKey = (id: string) => `kochot:sync:${id}`;
export const DEFAULT_GROUP_NAME = 'הקבוצה שלי';
export const MAX_GROUP_NAME = 40;

/**
 * A v4 UUID for group ids (the cloud table uses uuid keys). Uses getRandomValues, which also
 * works on plain http (a phone on the LAN), where crypto.randomUUID is missing.
 */
export function uuid(): string {
  const b = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, MAX_GROUP_NAME);
}

function sanitizeIndex(raw: unknown): GroupIndex | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<GroupIndex>;
  if (!Array.isArray(r.groups)) return null;
  const seen = new Set<string>();
  const groups: GroupMeta[] = [];
  for (const g of r.groups) {
    if (!g || typeof g.id !== 'string' || !g.id || seen.has(g.id)) continue;
    seen.add(g.id);
    groups.push({
      id: g.id,
      name: typeof g.name === 'string' && cleanName(g.name) ? cleanName(g.name) : DEFAULT_GROUP_NAME,
      synced: !!g.synced,
      createdAt: Number(g.createdAt) || 0,
    });
  }
  if (!groups.length) return null;
  const currentId = typeof r.currentId === 'string' && seen.has(r.currentId) ? r.currentId : groups[0].id;
  return { v: 1, currentId, groups };
}

/**
 * Load the group index, creating it on first run. An existing single-state install
 * (`kochot:v1`) becomes the first group with all its data.
 */
export function loadIndex(kv: KV, now = Date.now(), makeId: () => string = uuid): GroupIndex {
  const existing = sanitizeIndex(kv.get(INDEX_KEY));
  if (existing) return existing;
  const id = makeId();
  const legacy = kv.get(LEGACY_KEY);
  const index: GroupIndex = { v: 1, currentId: id, groups: [{ id, name: DEFAULT_GROUP_NAME, synced: false, createdAt: now }] };
  // Copy the raw blob (not a sanitized one) so nothing is dropped by the move itself.
  const wroteState = legacy == null || kv.set(groupKey(id), legacy);
  if (wroteState && kv.set(INDEX_KEY, index) && legacy != null) kv.remove(LEGACY_KEY);
  return index;
}

export function saveIndex(kv: KV, index: GroupIndex): boolean {
  return kv.set(INDEX_KEY, index);
}

export function loadGroupState(kv: KV, id: string, now = Date.now()): AppState {
  return sanitize(kv.get(groupKey(id)), now);
}

export function saveGroupState(kv: KV, id: string, state: AppState): boolean {
  return kv.set(groupKey(id), state);
}

export function addGroup(index: GroupIndex, meta: GroupMeta): GroupIndex {
  if (index.groups.some((g) => g.id === meta.id)) return { ...index, groups: index.groups.map((g) => (g.id === meta.id ? { ...g, ...meta } : g)) };
  return { ...index, groups: [...index.groups, meta] };
}

export function updateGroup(index: GroupIndex, id: string, patch: Partial<Omit<GroupMeta, 'id'>>): GroupIndex {
  return {
    ...index,
    groups: index.groups.map((g) => (g.id === id ? { ...g, ...patch, name: patch.name !== undefined ? cleanName(patch.name) || g.name : g.name } : g)),
  };
}

/** Remove a group from the index (never the last one). The current group moves to a neighbour. */
export function removeGroup(index: GroupIndex, id: string): GroupIndex {
  if (index.groups.length <= 1) return index;
  const at = index.groups.findIndex((g) => g.id === id);
  if (at < 0) return index;
  const groups = index.groups.filter((g) => g.id !== id);
  const currentId = index.currentId === id ? groups[Math.max(0, at - 1)].id : index.currentId;
  return { ...index, currentId, groups };
}

export function deleteGroupData(kv: KV, id: string): void {
  kv.remove(groupKey(id));
  kv.remove(syncKey(id));
}

/** A fresh group's state: empty roster, this phone's look. */
export function newGroupState(look: Pick<AppState['settings'], 'theme' | 'accent'>): AppState {
  return { ...INITIAL_STATE, settings: { ...INITIAL_STATE.settings, ...look } };
}
