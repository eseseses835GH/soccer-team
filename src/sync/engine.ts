// One sync round for a cloud group: pull → three-way merge → push (only if something changed).
// The push is conditional on the server version we merged against ("update … where version = n"),
// so two phones pushing at once can't overwrite each other: the loser pulls again and re-merges.
// Nothing here needs the network to be up; when it isn't, the round fails and the local copy
// simply stays ahead of `base` until the next round (that difference *is* the offline queue).
import { mergeDocs, sameDoc, sanitizeDoc, type SyncDoc } from './doc';
import type { KV } from '../state/groups';
import { syncKey } from '../state/groups';

export interface RemoteGroup {
  id: string;
  name: string;
  data: unknown;
  version: number;
}

export interface RemoteApi {
  fetchGroup(id: string): Promise<RemoteGroup | null>;
  /** Update data (and name) only if the server is still at `version`. Returns the new version, or null on a version conflict. */
  pushGroup(id: string, version: number, data: SyncDoc, name?: string): Promise<number | null>;
}

/** What this phone last agreed on with the server for one group. */
export interface SyncMeta {
  base: SyncDoc | null;
  baseVersion: number;
  baseName: string | null;
}

export const EMPTY_META: SyncMeta = { base: null, baseVersion: 0, baseName: null };

export function loadMeta(kv: KV, id: string): SyncMeta {
  const raw = kv.get(syncKey(id)) as Partial<SyncMeta> | null;
  if (!raw || typeof raw !== 'object') return EMPTY_META;
  return {
    base: raw.base ? sanitizeDoc(raw.base) : null,
    baseVersion: Number(raw.baseVersion) || 0,
    baseName: typeof raw.baseName === 'string' ? raw.baseName : null,
  };
}

export function saveMeta(kv: KV, id: string, meta: SyncMeta): void {
  kv.set(syncKey(id), meta);
}

/** True if this phone has changes the server hasn't seen yet. */
export function hasLocalChanges(meta: SyncMeta, local: SyncDoc, name: string): boolean {
  return !sameDoc(meta.base, local) || (meta.baseName !== null && meta.baseName !== name);
}

export type SyncOutcome =
  | { kind: 'ok'; doc: SyncDoc; name: string; meta: SyncMeta; pushed: boolean; pulled: boolean }
  | { kind: 'gone' };

/**
 * Run one round. `local` is read when the round starts; the caller applies `doc` to its state
 * (and should merge again if the user edited meanwhile; the next round does that).
 */
export async function syncGroup(api: RemoteApi, id: string, local: SyncDoc, name: string, meta: SyncMeta, maxTries = 3): Promise<SyncOutcome> {
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const remote = await api.fetchGroup(id);
    if (!remote) return { kind: 'gone' };
    const remoteDoc = sanitizeDoc(remote.data);
    const merged = mergeDocs(meta.base, local, remoteDoc);
    // Name: a local rename (differs from what we last agreed on) wins, otherwise take the server's.
    const localRenamed = meta.baseName !== null && name !== meta.baseName;
    const mergedName = localRenamed ? name : remote.name;
    const needPush = !sameDoc(merged, remoteDoc) || mergedName !== remote.name;
    const pulled = !sameDoc(merged, local) || mergedName !== name;
    if (!needPush) {
      return { kind: 'ok', doc: merged, name: mergedName, meta: { base: merged, baseVersion: remote.version, baseName: mergedName }, pushed: false, pulled };
    }
    const version = await api.pushGroup(id, remote.version, merged, mergedName !== remote.name ? mergedName : undefined);
    if (version !== null) {
      return { kind: 'ok', doc: merged, name: mergedName, meta: { base: merged, baseVersion: version, baseName: mergedName }, pushed: true, pulled };
    }
    // Someone else pushed in between: pull again and re-merge against the same base.
  }
  throw new Error('sync conflict');
}
