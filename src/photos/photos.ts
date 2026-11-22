// Player photos (DECISIONS → "vNN: player photos"). One small webp per roster player in the private
// Storage bucket `player-photos` at `<group id>/<player id>.webp`; members read it, the player
// himself or an organizer writes it. The roster player carries `photo` (a version string) so
// phones know when to fetch again, and `card` (the style the player chose for his card).
import type { SupabaseClient } from '@supabase/supabase-js';
import { fail, getClient } from '../sync/supabase';

export const PHOTO_BUCKET = 'player-photos';

export * from './style';
import { newPhotoVersion, photoPath, sanitizeCard, type CardStyle } from './style';

// ---------- changes made on this phone, shown at once (before the roster brings them) ----------

type Listener = () => void;
const listeners = new Set<Listener>();
/** gid/pid → version ('' = removed) set on this phone. */
const localVersions = new Map<string, string>();
const key = (gid: string, pid: string) => `${gid}/${pid}`;

export function subscribePhotos(f: Listener): () => void {
  listeners.add(f);
  return () => void listeners.delete(f);
}
/** The version to show: one set on this phone wins over the roster's until the roster has it too. */
export function photoVersion(gid: string, pid: string, fromRoster: string | undefined): string | undefined {
  const v = localVersions.get(key(gid, pid));
  if (v === undefined) return fromRoster;
  return v || undefined;
}
function setLocal(gid: string, pid: string, v: string) {
  localVersions.set(key(gid, pid), v);
  for (const f of listeners) f();
}

// ---------- server ----------

/**
 * Upload a prepared photo (≤ 300 KB, webp) for a roster player and point the roster at it. Throws
 * SyncError ('denied' when not his photo to change, 'offline'…). Callable from anywhere (the card maker).
 * Returns the new version.
 */
export async function uploadPlayerPhoto(groupId: string, playerId: string, blob: Blob, sb?: SupabaseClient): Promise<string> {
  const c = sb ?? (await getClient());
  const { error } = await c.storage.from(PHOTO_BUCKET).upload(photoPath(groupId, playerId), blob, { upsert: true, contentType: blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp', cacheControl: '31536000' });
  if (error) fail({ message: error.message, code: /row-level security|unauthorized|403/i.test(error.message) ? '42501' : undefined });
  const v = newPhotoVersion();
  const { error: e2 } = await c.rpc('set_player_photo', { p_group_id: groupId, p_player_id: playerId, p_version: v });
  if (e2) fail(e2);
  setLocal(groupId, playerId, v);
  return v;
}

/** Remove a player's photo (the roster first, then the file). */
export async function removePlayerPhoto(groupId: string, playerId: string, sb?: SupabaseClient): Promise<void> {
  const c = sb ?? (await getClient());
  const { error } = await c.rpc('set_player_photo', { p_group_id: groupId, p_player_id: playerId, p_version: null });
  if (error) fail(error);
  setLocal(groupId, playerId, '');
  await c.storage.from(PHOTO_BUCKET).remove([photoPath(groupId, playerId)]);
}

/** The player's card style (the player himself or an organizer). Returns what the server kept. */
export async function setMyCard(groupId: string, playerId: string, card: CardStyle | null, sb?: SupabaseClient): Promise<CardStyle | undefined> {
  const c = sb ?? (await getClient());
  const { data, error } = await c.rpc('set_my_card', { p_group_id: groupId, p_player_id: playerId, p_card: card });
  if (error) fail(error);
  return sanitizeCard(data);
}

// ---------- reading: an object URL per (player, version), kept in memory and in Cache Storage ----------

const urls = new Map<string, Promise<string | null>>();
const CACHE = 'kochot-photos';
const cacheUrl = (gid: string, pid: string, v: string) => `${location.origin}/__photos/${gid}/${pid}?v=${v}`;

async function fromCache(u: string): Promise<Blob | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const res = await (await caches.open(CACHE)).match(u);
    return res ? await res.blob() : null;
  } catch {
    return null;
  }
}

async function toCache(gid: string, pid: string, v: string, blob: Blob) {
  try {
    if (typeof caches === 'undefined') return;
    const c = await caches.open(CACHE);
    // Older versions of this player's photo go.
    for (const req of await c.keys()) if (req.url.startsWith(`${location.origin}/__photos/${gid}/${pid}?`)) await c.delete(req);
    await c.put(cacheUrl(gid, pid, v), new Response(blob, { headers: { 'content-type': blob.type || 'image/webp' } }));
  } catch {
    /* storage full or disabled: memory only */
  }
}

async function load(gid: string, pid: string, v: string): Promise<string | null> {
  let blob = await fromCache(cacheUrl(gid, pid, v));
  if (!blob) {
    const c = await getClient();
    const { data, error } = await c.storage.from(PHOTO_BUCKET).download(photoPath(gid, pid), { cacheNonce: v });
    if (error || !data) return null;
    blob = data;
    void toCache(gid, pid, v, blob);
  }
  return URL.createObjectURL(blob);
}

/** An object URL for the photo (null when it can't be had: no login, offline, gone). */
export function photoUrl(gid: string, pid: string, v: string): Promise<string | null> {
  const k = `${key(gid, pid)}?${v}`;
  let p = urls.get(k);
  if (!p) {
    p = load(gid, pid, v).catch(() => null);
    urls.set(k, p);
    // A failure is tried again later (logged in, back online).
    void p.then((u) => {
      if (!u) setTimeout(() => urls.get(k) === p && urls.delete(k), 30_000);
    });
  }
  return p;
}
