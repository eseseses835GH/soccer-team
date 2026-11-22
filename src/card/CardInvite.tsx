/** "עצבו את הקלף שלכם": his card with the silhouette, and a jump into the card maker (loaded only when shown). */
import { useState } from 'react';
import CardMakerSheet from './CardMakerSheet';
import { PlayerCard } from './PlayerCard';
import { cardStyleOf, type CardStyle, type PhotoChange } from '../photos/photos';
import { sanitizeStyle, type CardPosition } from './style';
import './card.css';

export default function CardInvite({
  player,
  groupId,
  score,
  position,
  notify,
  onOpen,
  onLater,
  onDone,
}: {
  player: { id: string; name: string; photo?: string; card?: CardStyle };
  groupId: string;
  score?: number;
  position?: CardPosition;
  notify: (m: string) => void;
  /** "לעצב": answered (the invite won't come back), the maker opens. */
  onOpen: () => void;
  onLater: () => void;
  /** The maker closed (saved or not). */
  onDone: (change: PhotoChange | null) => void;
}) {
  const [open, setOpen] = useState(false);
  if (open)
    return (
      <CardMakerSheet
        player={player}
        groupId={groupId}
        score={score}
        position={position}
        notify={notify}
        onClose={() => onDone(null)}
        onDone={(v, card) => onDone({ ...(v ? { photo: v } : {}), card: card ?? null })}
      />
    );
  return (
    <aside className="card-invite" aria-labelledby="card-invite-h">
      <PlayerCard name={player.name} position={position} score={score} style={sanitizeStyle(cardStyleOf(groupId, player.id, player.card))} size={58} />
      <div className="card-invite-body">
        <h2 id="card-invite-h">עצבו את הקלף שלכם</h2>
        <div className="card-invite-actions">
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={() => {
              onOpen();
              setOpen(true);
            }}
          >
            לעצב
          </button>
          <button type="button" className="text-btn" onClick={onLater}>
            אחר כך
          </button>
        </div>
      </div>
    </aside>
  );
}
