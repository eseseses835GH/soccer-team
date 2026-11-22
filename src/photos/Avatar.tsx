// A roster player's round photo, or his initial. Only in cloud groups (a local group has no photos).
import { createContext, lazy, Suspense, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { CardPosition } from '../card/style';
import { initialOf } from '../state/me';
import { useGroups } from '../state/store';
import { photoUrl, photoVersion, removePlayerPhoto, subscribePhotos, type CardStyle, type PhotoChange } from './photos';
import { SyncError } from '../sync/supabase';

const CardMakerSheet = lazy(() => import('../card/CardMakerSheet'));

/** Opens a player's card (CardViewer, in the app); null where there's none (the card lab). */
export const OpenCardCtx = createContext<((playerId: string) => void) | null>(null);

let tick = 0;
const bump = (f: () => void) =>
  subscribePhotos(() => {
    tick++;
    f();
  });
export const useLocalPhotos = () => useSyncExternalStore(bump, () => tick, () => tick);

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
  card = false,
}: {
  player: { id: string; name: string; photo?: string };
  size?: number;
  groupId?: string;
  /** Show the initial also in a local group. */
  always?: boolean;
  /** A tap opens his card. */
  card?: boolean;
}) {
  const { current } = useGroups();
  const url = usePlayerPhoto(player, groupId);
  const openCard = useContext(OpenCardCtx);
  if (!current.synced && !always && !url) return null;
  const style = { inlineSize: size, blockSize: size, fontSize: size * 0.45 };
  const pic = url ? (
    <img className="avatar p-avatar" src={url} alt="" width={size} height={size} style={style} decoding="async" />
  ) : (
    <span className="avatar avatar-letter p-avatar" style={style} aria-hidden="true">
      {initialOf(player.name)}
    </span>
  );
  if (!card || !openCard) return pic;
  // Inside a row that is itself a button (the roster): a span, so the row's own tap still works.
  const go = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    openCard(player.id);
  };
  return (
    <span role="button" tabIndex={0} className="avatar-tap" aria-label={`הקלף של ${player.name}`} onClick={go} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && go(e)}>
      {pic}
    </span>
  );
}

/**
 * "הקלף": opens the card maker for this player (photo → card → shirt → save). `onDone` gets what
 * changed (`photo`: new version, null = removed, absent = kept; `card`: the style the server kept)
 * so the caller can put it in this phone's state at once.
 */
export function PhotoButton({
  player,
  groupId,
  score,
  position,
  onDone,
  notify,
}: {
  player: { id: string; name: string; photo?: string; card?: CardStyle };
  groupId: string;
  score?: number;
  position?: CardPosition;
  onDone?: (change: PhotoChange) => void;
  notify: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useLocalPhotos();
  const has = !!photoVersion(groupId, player.id, player.photo);
  const remove = async () => {
    setBusy(true);
    try {
      await removePlayerPhoto(groupId, player.id);
      onDone?.({ photo: null });
    } catch (e) {
      notify(photoError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="photo-row">
      <Avatar player={player} groupId={groupId} size={56} always />
      <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => setOpen(true)}>
        {busy ? '…' : 'הקלף'}
      </button>
      {has && !busy && (
        <button type="button" className="text-btn danger" aria-label="הסרת התמונה" onClick={() => void remove()}>
          הסרה
        </button>
      )}
      {open && (
        <Suspense fallback={null}>
          <CardMakerSheet
            player={player}
            groupId={groupId}
            score={score}
            position={position}
            notify={notify}
            onClose={() => setOpen(false)}
            onDone={(v, card) => {
              setOpen(false);
              onDone?.({ ...(v ? { photo: v } : {}), card: card ?? null });
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

export const photoError = (e: unknown) => {
  const code = e instanceof SyncError ? e.code : 'other';
  return code === 'offline' ? 'אין חיבור לאינטרנט' : code === 'denied' ? 'אין הרשאה' : 'משהו השתבש, נסו שוב';
};
