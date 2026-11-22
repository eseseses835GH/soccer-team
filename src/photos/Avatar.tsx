// A roster player's round photo, or his initial. Only in cloud groups (a local group has no photos).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { initialOf } from '../state/me';
import { useGroups } from '../state/store';
import { photoUrl, photoVersion, removePlayerPhoto, subscribePhotos, uploadPlayerPhoto } from './photos';
import { preparePhoto } from './prepare';
import { SyncError } from '../sync/supabase';

let tick = 0;
const bump = (f: () => void) =>
  subscribePhotos(() => {
    tick++;
    f();
  });
const useLocalPhotos = () => useSyncExternalStore(bump, () => tick, () => tick);

/** The photo URL of a player (null while loading or when there is none). */
export function usePlayerPhoto(player: { id: string; photo?: string }, groupId?: string): string | null {
  const { current } = useGroups();
  const gid = groupId ?? current.id;
  useLocalPhotos();
  const v = photoVersion(gid, player.id, player.photo);
  const [url, setUrl] = useState<{ k: string; u: string | null } | null>(null);
  const k = v ? `${gid}/${player.id}?${v}` : '';
  useEffect(() => {
    if (!k || !v) return;
    let off = false;
    void photoUrl(gid, player.id, v).then((u) => !off && setUrl({ k, u }));
    return () => {
      off = true;
    };
  }, [k, gid, player.id, v]);
  return url && url.k === k ? url.u : null;
}

export function Avatar({
  player,
  size = 28,
  groupId,
  always = false,
}: {
  player: { id: string; name: string; photo?: string };
  size?: number;
  groupId?: string;
  /** Show the initial also in a local group. */
  always?: boolean;
}) {
  const { current } = useGroups();
  const url = usePlayerPhoto(player, groupId);
  if (!current.synced && !always && !url) return null;
  const style = { inlineSize: size, blockSize: size, fontSize: size * 0.45 };
  return url ? (
    <img className="avatar p-avatar" src={url} alt="" width={size} height={size} style={style} decoding="async" />
  ) : (
    <span className="avatar avatar-letter p-avatar" style={style} aria-hidden="true">
      {initialOf(player.name)}
    </span>
  );
}

/**
 * "תמונה": take or pick a photo of this player, upload it, point the roster at it. `onDone` gets the
 * new version (null = removed) so the caller can put it in this phone's state at once.
 */
export function PhotoButton({
  player,
  groupId,
  onDone,
  notify,
}: {
  player: { id: string; name: string; photo?: string };
  groupId: string;
  onDone?: (version: string | null) => void;
  notify: (m: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  useLocalPhotos();
  const has = !!photoVersion(groupId, player.id, player.photo);
  const run = async (f: () => Promise<string | null>) => {
    setBusy(true);
    try {
      onDone?.(await f());
    } catch (e) {
      const code = e instanceof SyncError ? e.code : 'other';
      notify(code === 'offline' ? 'אין חיבור לאינטרנט' : code === 'denied' ? 'אין הרשאה' : 'משהו השתבש, נסו שוב');
    } finally {
      setBusy(false);
    }
  };
  const picked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void run(async () => uploadPlayerPhoto(groupId, player.id, await preparePhoto(file)));
  };
  return (
    <div className="photo-row">
      <Avatar player={player} groupId={groupId} size={56} always />
      <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? '…' : 'תמונה'}
      </button>
      {has && !busy && (
        <button type="button" className="text-btn danger" aria-label="הסרת התמונה" onClick={() => void run(async () => (await removePlayerPhoto(groupId, player.id), null))}>
          הסרה
        </button>
      )}
      <input ref={input} type="file" accept="image/*" capture="user" hidden aria-label="תמונה" onChange={picked} />
    </div>
  );
}
