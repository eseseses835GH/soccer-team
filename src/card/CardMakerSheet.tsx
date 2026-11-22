/** "הקלף" in a player's sheet: the card maker, saved to the group (loaded only when opened). */
import { createPortal } from 'react-dom';
import { Sheet } from '../ui/components';
import { cardStyleOf, savePlayerCard, setMyCard, type CardStyle as SavedStyle } from '../photos/photos';
import { photoError } from '../photos/Avatar';
import { CardMaker } from './CardMaker';
import { useCardImages } from './useCardImages';
import { sanitizeStyle, type CardPosition } from './style';
import './card.css';

export default function CardMakerSheet({
  player,
  groupId,
  score,
  position,
  notify,
  onClose,
  onDone,
}: {
  player: { id: string; name: string; photo?: string; card?: SavedStyle };
  groupId: string;
  score?: number;
  position?: CardPosition;
  notify: (m: string) => void;
  onClose: () => void;
  onDone: (version: string | undefined, card: SavedStyle | undefined) => void;
}) {
  const img = useCardImages(groupId, player);
  // Out of the player's form (its own sheet; Enter in the shirt number doesn't submit the form).
  return createPortal(
    <Sheet title={player.name} onClose={onClose}>
      <CardMaker
        name={player.name}
        position={position}
        score={score}
        initialStyle={sanitizeStyle(cardStyleOf(groupId, player.id, player.card))}
        existing={img.ready ? { cutout: img.cutout, portrait: img.portrait } : undefined}
        onSaveStyle={async (style) => {
          try {
            onDone(undefined, await setMyCard(groupId, player.id, style));
          } catch (e) {
            notify(photoError(e));
          }
        }}
        onSave={async (c) => {
          try {
            const r = await savePlayerCard(groupId, player.id, c);
            onDone(r.version, r.card);
          } catch (e) {
            notify(photoError(e));
          }
        }}
      />
    </Sheet>,
    document.body,
  );
}
