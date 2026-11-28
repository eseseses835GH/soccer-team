/** Pick the card's shirt: colours, pattern, number — with the card live on top. */
import { useState } from 'react';
import { Segmented, Sheet } from '../ui/components';
import { PlayerCard, type PlayerCardProps } from './PlayerCard';
import { PATTERNS, SHIRTS, sanitizeStyle, type CardStyle, type ShirtPattern } from './style';
import './card.css';

export function CardStyleSheet({
  card,
  onDone,
  onClose,
}: {
  /** The card to preview (its `style` is the starting point). */
  card: PlayerCardProps;
  onDone: (style: CardStyle) => void;
  onClose: () => void;
}) {
  const [style, setStyle] = useState<CardStyle>(() => sanitizeStyle(card.style));
  const [num, setNum] = useState(style.number ? String(style.number) : '');
  const set = (patch: Partial<CardStyle>) => setStyle((s) => sanitizeStyle({ ...s, ...patch }));

  return (
    <Sheet title="עיצוב הקלף" onClose={onClose}>
      <div className="card-style">
        <div className="card-style-preview">
          <PlayerCard {...card} style={style} size={150} />
        </div>
        <div className="shirt-swatches" role="radiogroup" aria-label="צבעים">
          {SHIRTS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={style.shirt === s.id}
              aria-label={s.name}
              title={s.name}
              className={`shirt-swatch ${style.shirt === s.id ? 'on' : ''}`}
              style={{ ['--c1' as string]: s.colors[0], ['--c2' as string]: s.colors[1] }}
              onClick={() => set({ shirt: s.id })}
            />
          ))}
        </div>
        <Segmented<ShirtPattern> label="דוגמה" value={style.pattern} options={PATTERNS.map((p) => ({ value: p.id, label: p.name }))} onChange={(pattern) => set({ pattern })} />
        <label className="shirt-number">
          <span>מספר</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            value={num}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 2);
              setNum(v);
              setStyle((s) => sanitizeStyle({ ...s, number: v }));
            }}
          />
        </label>
        <button type="button" className="btn btn-primary btn-block" onClick={() => onDone(style)}>
          שמירה
        </button>
      </div>
    </Sheet>
  );
}
