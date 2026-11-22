/** A player's card pictures from the bucket: the cutout when there is one, else the round photo. */
import { useEffect, useState } from 'react';
import { useLocalPhotos } from '../photos/Avatar';
import { cutoutUrl, photoUrl, photoVersion } from '../photos/photos';

export interface CardImages {
  cutout: string | null;
  portrait: string | null;
  /** Both asked (no flash from the round photo to the cutout). */
  ready: boolean;
}

export function useCardImages(gid: string, player: { id: string; photo?: string }): CardImages {
  useLocalPhotos();
  const v = photoVersion(gid, player.id, player.photo);
  const k = v ? `${gid}/${player.id}?${v}` : '';
  const [got, setGot] = useState<{ k: string; cutout: string | null; portrait: string | null } | null>(null);
  useEffect(() => {
    if (!k || !v) return;
    let off = false;
    void Promise.all([cutoutUrl(gid, player.id, v), photoUrl(gid, player.id, v)]).then(([cutout, portrait]) => !off && setGot({ k, cutout, portrait }));
    return () => {
      off = true;
    };
  }, [k, gid, player.id, v]);
  if (!k) return { cutout: null, portrait: null, ready: true };
  if (!got || got.k !== k) return { cutout: null, portrait: null, ready: false };
  return { cutout: got.cutout, portrait: got.cutout ? null : got.portrait, ready: true };
}
