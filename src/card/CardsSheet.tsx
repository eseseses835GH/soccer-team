/**
 * The regulars' cards (no guests), two per row: players with a photo first, then the rest (silhouette). A tap opens
 * the card large (CardSheet, with שיתוף). Scores as in CardViewer: players' phones only the public
 * copy's `score`, organizer phones from the level.
 */
import { useMemo, useState } from 'react';
import { cardStyleOf, photoVersion } from '../photos/photos';
import { useGroups, useStore } from '../state/store';
import { usePlayerGroup } from '../sync/PlayerGroupProvider';
import { Sheet } from '../ui/components';
import CardSheet from './CardSheet';
import { cardData, type CardData } from './cardData';
import { PlayerCard } from './PlayerCard';
import { sanitizeStyle } from './style';
import { useCardImages } from './useCardImages';
import './card.css';

export default function CardsSheet({ notify, onClose }: { notify: (m: string) => void; onClose: () => void }) {
  const { state } = useStore();
  const { current } = useGroups();
  const pg = usePlayerGroup();
  const [open, setOpen] = useState<CardData | null>(null);
  const pub = pg.active ? (pg.pub ?? { players: [] }) : null;
  const list = useMemo(() => {
    // Regulars only: guests ("מזדמנים") aren't in the cards.
    const ids = (pub ? pub.players : state.players).filter((p) => !(p as { occasional?: boolean }).occasional).map((p) => p.id);
    const all = ids.map((id) => cardData(id, state.players, state.history, pub)).filter((c): c is CardData => !!c);
    const has = (c: CardData) => (photoVersion(current.id, c.id, c.photo) ? 0 : 1);
    return all.sort((a, b) => has(a) - has(b) || a.name.localeCompare(b.name, 'he'));
  }, [pub, state.players, state.history, current.id]);
  return (
    <>
      <Sheet title="הקלפים" onClose={onClose}>
        <ul className="cards-grid">
          {list.map((c) => (
            <li key={c.id}>
              <Tile data={c} groupId={current.id} onOpen={() => setOpen(c)} />
            </li>
          ))}
        </ul>
      </Sheet>
      {open && <CardSheet data={open} groupId={current.id} notify={notify} onClose={() => setOpen(null)} />}
    </>
  );
}

function Tile({ data, groupId, onOpen }: { data: CardData; groupId: string; onOpen: () => void }) {
  const img = useCardImages(groupId, data);
  const saved = cardStyleOf(groupId, data.id, undefined);
  return (
    <button type="button" className="cards-tile" aria-label={`הקלף של ${data.name}`} onClick={onOpen}>
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
    </button>
  );
}
