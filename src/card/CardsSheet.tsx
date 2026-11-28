/**
 * The regulars' cards (no guests), two per row: my own card first (✎), then players with a photo, then the rest
 * (silhouette). A tap opens the card large (CardSheet, with שיתוף; on my own card also "עריכת הקלף"). Scores as in CardViewer: players' phones only the public
 * copy's `score`, organizer phones from the level.
 */
import { useMemo, useState } from 'react';
import { cardStyleOf, photoVersion } from '../photos/photos';
import { withPhotoChange } from '../photos/style';
import { useGroups, useStore } from '../state/store';
import { usePlayerGroup } from '../sync/PlayerGroupProvider';
import { Sheet } from '../ui/components';
import { Icon } from '../ui/icons';
import { useMyOrgPlayer } from '../ui/Nudges';
import CardSheet from './CardSheet';
import { cardData, type CardData } from './cardData';
import { PlayerCard } from './PlayerCard';
import { sanitizeStyle } from './style';
import { useCardImages } from './useCardImages';
import './card.css';

export default function CardsSheet({ notify, onClose }: { notify: (m: string) => void; onClose: () => void }) {
  const { state } = useStore();
  const groups = useGroups();
  const { current } = groups;
  const pg = usePlayerGroup();
  const [openId, setOpenId] = useState<string | null>(null);
  const pub = pg.active ? (pg.pub ?? { players: [] }) : null;
  // My own card: the player this phone claimed (players' phones), or the organizer's own roster player.
  const orgMe = useMyOrgPlayer(current.id, !pg.active);
  const myId = pg.active ? (pg.pub?.me.playerId ?? null) : orgMe;
  const list = useMemo(() => {
    // Regulars only: guests ("מזדמנים") aren't in the cards.
    const ids = (pub ? pub.players : state.players).filter((p) => !(p as { occasional?: boolean }).occasional).map((p) => p.id);
    const all = ids.map((id) => cardData(id, state.players, state.history, pub)).filter((c): c is CardData => !!c);
    const has = (c: CardData) => (photoVersion(current.id, c.id, c.photo) ? 0 : 1);
    const me = (c: CardData) => (c.id === myId ? 0 : 1);
    return all.sort((a, b) => me(a) - me(b) || has(a) - has(b) || a.name.localeCompare(b.name, 'he'));
  }, [pub, state.players, state.history, current.id, myId]);
  const open = openId ? list.find((c) => c.id === openId) : undefined;
  const mine = open && open.id === myId ? (state.players.find((p) => p.id === myId) ?? pub?.players.find((p) => p.id === myId)) : undefined;
  return (
    <>
      <Sheet title="הקלפים" onClose={onClose}>
        <ul className="cards-grid">
          {list.map((c) => (
            <li key={c.id}>
              <Tile data={c} groupId={current.id} mine={c.id === myId} onOpen={() => setOpenId(c.id)} />
            </li>
          ))}
        </ul>
      </Sheet>
      {open && (
        <CardSheet
          data={open}
          groupId={current.id}
          notify={notify}
          onClose={() => setOpenId(null)}
          edit={
            mine
              ? {
                  player: { id: mine.id, name: mine.name, photo: open.photo, card: mine.card },
                  onDone: (change) =>
                    groups.setGroupState(current.id, (st) => ({ ...st, players: st.players.map((p) => (p.id === mine.id ? withPhotoChange(p, change) : p)) })),
                }
              : undefined
          }
        />
      )}
    </>
  );
}

function Tile({ data, groupId, mine, onOpen }: { data: CardData; groupId: string; mine: boolean; onOpen: () => void }) {
  const img = useCardImages(groupId, data);
  const saved = cardStyleOf(groupId, data.id, undefined);
  return (
    <button type="button" className="cards-tile" aria-label={mine ? 'הקלף שלי' : `הקלף של ${data.name}`} onClick={onOpen}>
      <PlayerCard
        name={data.name}
        position={data.position}
        score={data.score}
        stats={data.stats}
        style={saved ? sanitizeStyle(saved) : data.style}
        cutout={img.cutout}
        portrait={img.portrait}
        size={150}
      />
      {mine && (
        <span className="cards-tile-mine" aria-hidden="true">
          <Icon name="edit" size={16} />
        </span>
      )}
    </button>
  );
}
