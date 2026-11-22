/** A player's card, large, with "שיתוף" (loaded only when a card is opened). */
import { useState } from 'react';
import { Sheet } from '../ui/components';
import { downloadBlob, shareFile } from '../share';
import { cardStyleOf } from '../photos/photos';
import { useGroups } from '../state/store';
import { CardBack } from './CardBack';
import type { CardData } from './cardData';
import { PlayerCard } from './PlayerCard';
import { renderCardShare } from './renderCard';
import { SpinCard } from './SpinCard';
import { sanitizeStyle, tierOf } from './style';
import { useCardImages } from './useCardImages';
import './card.css';

export default function CardSheet({ data, groupId, onClose, notify }: { data: CardData; groupId: string; onClose: () => void; notify: (m: string) => void }) {
  const img = useCardImages(groupId, data);
  const { current } = useGroups();
  const [busy, setBusy] = useState(false);
  const saved = cardStyleOf(groupId, data.id, undefined);
  const card = {
    name: data.name,
    position: data.position,
    score: data.score,
    stats: data.stats,
    style: saved ? sanitizeStyle(saved) : data.style,
    cutout: img.cutout,
    portrait: img.portrait,
  };
  const share = async () => {
    setBusy(true);
    try {
      const file = await renderCardShare(card);
      if ((await shareFile(file)) === 'unsupported') downloadBlob(file.name, file);
    } catch {
      notify('משהו השתבש, נסו שוב');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={data.name} onClose={onClose}>
      <div className="card-view">
        <SpinCard
          width={280}
          foil={tierOf(card.score) === 'gold'}
          front={<PlayerCard {...card} className={img.ready ? '' : 'is-loading'} size={280} />}
          back={<CardBack name={card.name} position={card.position} score={card.score} style={card.style} record={data.record} group={current.name} size={280} />}
        />
        <button type="button" className="text-btn" disabled={busy || !img.ready} onClick={() => void share()}>
          {busy ? '…' : 'שיתוף'}
        </button>
      </div>
    </Sheet>
  );
}
