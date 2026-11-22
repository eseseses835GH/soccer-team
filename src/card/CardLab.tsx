import { SpinCard } from './SpinCard';
/** `#card-lab`: a dev page (not linked anywhere) to try the card maker and see sample cards. */
import { useState } from 'react';
import { CardMaker, useObjectUrl, type CardSave } from './CardMaker';
import { PlayerCard, type PlayerCardProps } from './PlayerCard';
import { renderCardPng } from './renderCard';
import './card.css';

const SAMPLES: Omit<PlayerCardProps, 'cutout' | 'portrait'>[] = [
  { name: 'אבי כהן', position: 'att', score: 91, style: { shirt: 'red-blue', pattern: 'stripes', number: 10 }, stats: [{ label: 'שערים', value: 14 }, { label: 'ניצחונות', value: 22 }, { label: 'ערבים', value: 31 }] },
  { name: 'יוסי', position: 'mid', score: 81, style: { shirt: 'sky', pattern: 'plain', number: 8 } },
  { name: 'Daniel', position: 'def', score: 74, style: { shirt: 'black-white', pattern: 'halves', number: 4 }, stats: [{ label: 'ניצחונות', value: 9 }, { label: 'ערבים', value: 12 }] },
  { name: 'מוחמד אבו-חוסיין', position: 'gk', style: { shirt: 'yellow-green', pattern: 'sash', number: 1 } },
  { name: 'רון', position: 'mid', style: { shirt: 'white', pattern: 'plain' } },
];

declare global {
  interface Window {
    __cardLab?: { saved?: { portrait: number; cutout: number | null; portraitType: string; style: CardSave['style'] }; png?: { width: number; height: number; size: number } };
  }
}

export default function CardLab() {
  const [saved, setSaved] = useState<CardSave | null>(null);
  const cutout = useObjectUrl(saved?.cutout ?? null);
  const portrait = useObjectUrl(saved?.portrait ?? null);
  const [png, setPng] = useState<string | null>(null);
  const img = (i: number) => (saved ? (i % 2 === 0 || !cutout ? { cutout, portrait } : { portrait }) : {});

  return (
    <div className="card-lab" dir="rtl">
      <div className="spin-lab" style={{ display: 'grid', placeItems: 'center', padding: 16 }}>
        <SpinCard
          width={260}
          foil
          front={<PlayerCard name="סיבוב" position="att" score={90} style={{ shirt: 'red-blue', pattern: 'stripes', number: 7 }} size={260} />}
          back={<PlayerCard name="גב" position="def" score={90} style={{ shirt: 'black-white', pattern: 'plain', number: 7 }} size={260} />}
        />
      </div>
      <CardMaker
        name="אבי כהן"
        position="att"
        initialStyle={{ shirt: 'red-blue', pattern: 'stripes', number: 10 }}
        onSave={(c) => {
          setSaved(c);
          window.__cardLab = {
            ...window.__cardLab,
            saved: { portrait: c.portrait.size, cutout: c.cutout?.size ?? null, portraitType: c.portrait.type, style: c.style },
          };
        }}
      />
      <div className="card-lab-grid">
        {SAMPLES.map((s, i) => (
          <PlayerCard key={i} {...s} {...img(i)} size={170} />
        ))}
      </div>
      <button
        type="button"
        className="btn btn-quiet"
        onClick={async () => {
          const b = await renderCardPng({ ...SAMPLES[0], ...img(0) });
          const u = URL.createObjectURL(b);
          const im = new Image();
          im.src = u;
          await im.decode();
          window.__cardLab = { ...window.__cardLab, png: { width: im.naturalWidth, height: im.naturalHeight, size: b.size } };
          setPng(u);
        }}
      >
        PNG
      </button>
      {png && <img src={png} alt="" width={300} />}
    </div>
  );
}
