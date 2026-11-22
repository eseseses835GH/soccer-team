// Player photos (DECISIONS → "v31: player photos", "v33: the card in the app"). Per roster player in
// the private Storage bucket `player-photos`: `<group id>/<player id>.webp` (the portrait, also the
// round photo) and `<player id>-cut.webp` (the card cutout, when there is one); members read them,
// the player himself or an organizer writes them. The roster player carries `photo` (a version string) so
// phones know when to fetch again, and `card` (the style the player chose for his card).
import type { SupabaseClient } from '@supabase/supabase-js';
import { fail, getClient } from '../sync/supabase';

export const PHOTO_BUCKET = 'player-photos';

export * from './style';
import { cutoutPath, newPhotoVersion, photoPath, sanitizeCard, type CardStyle } from './style';

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
/** gid/pid → the card style set on this phone (null = none). */
const localCards = new Map<string, CardStyle | null>();
/** The card style to show: one set on this phone wins over the roster's. */
export function cardStyleOf(gid: string, pid: string, fromRoster: CardStyle | undefined): CardStyle | undefined {
  const v = localCards.get(key(gid, pid));
  return v === undefined ? fromRoster : (v ?? undefined);
}
function setLocal(gid: string, pid: string, v: string) {
  localVersions.set(key(gid, pid), v);
  for (const f of listeners) f();
}

// ---------- server ----------

const TYPES = ['image/webp', 'image/jpeg', 'image/png'];
const typeOf = (b: Blob) => (TYPES.includes(b.type) ? b.type : 'image/webp');

async function put(c: SupabaseClient, path: string, blob: Blob) {
  const { error } = await c.storage.from(PHOTO_BUCKET).upload(path, blob, { upsert: true, contentType: typeOf(blob), cacheControl: '31536000' });
  if (error) fail({ message: error.message, code: /row-level security|unauthorized|403/i.test(error.message) ? '42501' : undefined });
}

async function pointAt(c: SupabaseClient, groupId: string, playerId: string, v: string | null) {
  const { error } = await c.rpc('set_player_photo', { p_group_id: groupId, p_player_id: playerId, p_version: v });
  if (error) fail(error);
}

/**
 * Save a card from the card maker: the portrait (`<pid>.webp`), the cutout (`<pid>-cut.webp`, or the
 * old one removed when there's none), one version for both, then the shirt style.
 */
export async function savePlayerCard(
  groupId: string,
  playerId: string,
  card: { portrait: Blob; cutout: Blob | null; style: CardStyle | null },
  sb?: SupabaseClient,
): Promise<{ version: string; card: CardStyle | undefined }> {
  const c = sb ?? (await getClient());
  await put(c, photoPath(groupId, playerId), card.portrait);
  if (card.cutout) await put(c, cutoutPath(groupId, playerId), card.cutout);
  else await c.storage.from(PHOTO_BUCKET).remove([cutoutPath(groupId, playerId)]).catch(() => null);
  const version = newPhotoVersion();
  await pointAt(c, groupId, playerId, version);
  // This phone has the files already: no download to show them.
  prime(groupId, playerId, '', version, card.portrait);
  prime(groupId, playerId, '-cut', version, card.cutout);
  setLocal(groupId, playerId, version);
  const kept = await setMyCard(groupId, playerId, card.style, c);
  return { version, card: kept };
}

/** Remove a player's photo (the roster first, then the files). */
export async function removePlayerPhoto(groupId: string, playerId: string, sb?: SupabaseClient): Promise<void> {
  const c = sb ?? (await getClient());
  await pointAt(c, groupId, playerId, null);
  setLocal(groupId, playerId, '');
  await c.storage.from(PHOTO_BUCKET).remove([photoPath(groupId, playerId), cutoutPath(groupId, playerId)]);
}

/** The player's card style (the player himself or an organizer). Returns what the server kept. */
export async function setMyCard(groupId: string, playerId: string, card: CardStyle | null, sb?: SupabaseClient): Promise<CardStyle | undefined> {
  const c = sb ?? (await getClient());
  const { data, error } = await c.rpc('set_my_card', { p_group_id: groupId, p_player_id: playerId, p_card: card });
  if (error) fail(error);
  const kept = sanitizeCard(data);
  localCards.set(key(groupId, playerId), kept ?? null);
  for (const f of listeners) f();
  return kept;
}

// ---------- reading: an object URL per (player, version), kept in memory and in Cache Storage ----------
// `kind` '' = the round photo (portrait), '-cut' = the card cutout (same version).

type Kind = '' | '-cut';
const urls = new Map<string, Promise<string | null>>();
const CACHE = 'kochot-photos';
const cacheUrl = (gid: string, pid: string, kind: Kind, v: string) => `${location.origin}/__photos/${gid}/${pid}${kind}?v=${v}`;

async function fromCache(u: string): Promise<Blob | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const res = await (await caches.open(CACHE)).match(u);
    return res ? await res.blob() : null;
  } catch {
    return null;
  }
}

async function toCache(gid: string, pid: string, kind: Kind, v: string, blob: Blob) {
  try {
    if (typeof caches === 'undefined') return;
    const c = await caches.open(CACHE);
    // Older versions of this player's file go.
    for (const req of await c.keys()) if (req.url.startsWith(`${location.origin}/__photos/${gid}/${pid}${kind}?`)) await c.delete(req);
    await c.put(cacheUrl(gid, pid, kind, v), new Response(blob, { headers: { 'content-type': blob.type || 'image/webp' } }));
  } catch {
    /* storage full or disabled: memory only */
  }
}

async function load(gid: string, pid: string, kind: Kind, v: string): Promise<string | null> {
  let blob = await fromCache(cacheUrl(gid, pid, kind, v));
  if (!blob) {
    const c = await getClient();
    const path = kind ? cutoutPath(gid, pid) : photoPath(gid, pid);
    const { data, error } = await c.storage.from(PHOTO_BUCKET).download(path, { cacheNonce: v });
    if (error || !data) return null;
    blob = data;
    void toCache(gid, pid, kind, v, blob);
  }
  return URL.createObjectURL(blob);
}

function fetchUrl(gid: string, pid: string, kind: Kind, v: string): Promise<string | null> {
  const k = `${key(gid, pid)}${kind}?${v}`;
  let p = urls.get(k);
  if (!p) {
    p = load(gid, pid, kind, v).catch(() => null);
    urls.set(k, p);
    // A failed photo is tried again later (logged in, back online). A missing cutout is normal
    // (photos from before the card, or the models couldn't load): asked once per version.
    if (!kind) void p.then((u) => {
      if (!u) setTimeout(() => urls.get(k) === p && urls.delete(k), 30_000);
    });
  }
  return p;
}

function prime(gid: string, pid: string, kind: Kind, v: string, blob: Blob | null) {
  if (typeof URL.createObjectURL !== 'function') return;
  urls.set(`${key(gid, pid)}${kind}?${v}`, Promise.resolve(blob ? URL.createObjectURL(blob) : null));
  if (blob && typeof location !== 'undefined') void toCache(gid, pid, kind, v, blob);
}

/** An object URL for the photo (null when it can't be had: no login, offline, gone). */
export const photoUrl = (gid: string, pid: string, v: string) => fetchUrl(gid, pid, '', v);
/** An object URL for the card cutout (null: none for this version, or it can't be had). */
export const cutoutUrl = (gid: string, pid: string, v: string) => fetchUrl(gid, pid, '-cut', v);
