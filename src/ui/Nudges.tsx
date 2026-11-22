// The one-time prompts at the top of a home screen: "סיור קצר?" for someone new, else (another
// session) "עצבו את הקלף שלכם" for a claimed player without a photo. DECISIONS → v36.
import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react';
import type { CardPosition } from '../card/style';
import { useLocalPhotos } from '../photos/Avatar';
import { photoVersion, type CardStyle, type PhotoChange } from '../photos/photos';
import { meKey } from '../state/groups';
import { localKV } from '../state/store';
import { playersApi } from '../sync/players';
import { useSync } from '../sync/SyncProvider';
import {
  answerCardInvite,
  cardInviteAnswered,
  markTourOffered,
  shouldInviteCard,
  shouldOfferTour,
  startTour,
  tourSeen,
  tourThisSession,
  type TourOfferContext,
} from './onboarding';

const CardInvite = lazy(() => import('../card/CardInvite'));

export interface MyCard {
  player: { id: string; name: string; photo?: string; card?: CardStyle };
  score?: number;
  position?: CardPosition;
}

/** Key it by the group id (the flags are per group). */
export function Nudges({
  tour,
  groupId,
  synced,
  me,
  matchOn,
  notify,
  onPhoto,
}: {
  tour: Omit<TourOfferContext, 'seen' | 'matchOn'>;
  groupId: string;
  synced: boolean;
  me: MyCard | null;
  matchOn: boolean;
  notify: (m: string) => void;
  onPhoto: (playerId: string, change: PhotoChange) => void;
}) {
  const [offer, setOffer] = useState(false);
  const ok = shouldOfferTour({ ...tour, matchOn, seen: tourSeen(tour.kind) });
  // Offered once: remembered as soon as it shows.
  useLayoutEffect(() => {
    if (!ok) return;
    markTourOffered(tour.kind);
    setOffer(true);
  }, [ok, tour.kind]);

  useLocalPhotos();
  const [answered, setAnswered] = useState(() => cardInviteAnswered(groupId));
  const [making, setMaking] = useState(false);
  const invite =
    making ||
    shouldInviteCard({
      synced,
      playerId: me?.player.id,
      hasPhoto: !!me && !!photoVersion(groupId, me.player.id, me.player.photo),
      answered,
      tourSession: tourThisSession(),
      matchOn,
    });

  if (offer)
    return (
      <aside className="nudge tour-offer" aria-labelledby="tour-offer-h">
        <h2 id="tour-offer-h">סיור קצר?</h2>
        <div className="nudge-actions">
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={() => {
              setOffer(false);
              startTour();
            }}
          >
            יאללה
          </button>
          <button type="button" className="text-btn" onClick={() => setOffer(false)}>
            לא תודה
          </button>
        </div>
      </aside>
    );
  if (!invite || !me) return null;
  const answer = () => {
    answerCardInvite(groupId);
    setAnswered(true);
  };
  return (
    <Suspense fallback={null}>
      <CardInvite
        player={me.player}
        groupId={groupId}
        score={me.score}
        position={me.position}
        notify={notify}
        onOpen={() => {
          answer();
          setMaking(true);
        }}
        onLater={answer}
        onDone={(change) => {
          setMaking(false);
          if (change) onPhoto(me.player.id, change);
        }}
      />
    </Suspense>
  );
}

/**
 * An organizer's own roster player in a cloud group (organizers play too): the server's answer
 * cached per login, as "הדף שלי" keeps it; asked once when it isn't there yet. `want` = it matters.
 */
export function useMyOrgPlayer(groupId: string, want: boolean): string | null {
  const sync = useSync();
  const user = sync.userId ?? '';
  const cached = () => {
    const v = localKV.get(meKey(groupId)) as { user: string; playerId: string | null; taken: string[] } | null;
    return v && v.user === user ? v : null;
  };
  const [id, setId] = useState<string | null>(() => cached()?.playerId ?? null);
  useEffect(() => {
    const c = cached();
    setId(c?.playerId ?? null);
    if (c || !want || !user) return;
    let off = false;
    void (async () => {
      const client = await sync.client().catch(() => null);
      const members = client ? await playersApi(client).listMembers(groupId).catch(() => null) : null;
      if (!members || off) return;
      const v = { user, playerId: members.find((m) => m.isMe)?.playerId ?? null, taken: members.filter((m) => !m.isMe && m.playerId).map((m) => m.playerId!) };
      localKV.set(meKey(groupId), v);
      setId(v.playerId);
    })();
    return () => {
      off = true;
    };
  }, [groupId, user, want]); // eslint-disable-line react-hooks/exhaustive-deps
  return id;
}
