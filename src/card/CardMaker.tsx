/** Take or pick a photo → it's framed and cleaned up on the phone → the card → save. */
import { useEffect, useRef, useState } from 'react';
import { CardStyleSheet } from './CardStyleSheet';
import { PlayerCard, type CardStat } from './PlayerCard';
import { processPhoto, type ProcessOptions, type Processed } from './process';
import { sanitizeStyle, type CardPosition, type CardStyle } from './style';
import './card.css';

export interface CardSave {
  portrait: Blob;
  cutout: Blob | null;
  style: CardStyle;
}

export function CardMaker({
  name,
  position,
  score,
  stats,
  initialStyle,
  onSave,
  options,
}: {
  name: string;
  position?: CardPosition;
  score?: number;
  stats?: CardStat[];
  initialStyle?: CardStyle;
  onSave: (card: CardSave) => void | Promise<void>;
  /** Processing options (tests force the no-models path). */
  options?: ProcessOptions;
}) {
  const [style, setStyle] = useState<CardStyle>(() => sanitizeStyle(initialStyle));
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<Processed | null>(null);
  const [saving, setSaving] = useState(false);
  const [styling, setStyling] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const url = useObjectUrl(result?.cutout ?? result?.portrait ?? null);
  const run = useRef(0);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const mine = ++run.current;
    setState('busy');
    try {
      const r = await processPhoto(file, options);
      if (mine !== run.current) return;
      setResult(r);
      setState('done');
    } catch {
      if (mine === run.current) setState('error');
    }
  };

  const card = { name, position, score, stats, style };
  const pick = (input: HTMLInputElement | null) => {
    if (!input) return;
    input.value = '';
    input.click();
  };

  return (
    <div className="card-maker">
      <div className={`card-maker-stage ${state === 'busy' ? 'is-busy' : ''}`}>
        <button type="button" className="card-maker-card" tabIndex={-1} aria-hidden="true" onClick={() => setStyling(true)}>
          <PlayerCard {...card} cutout={result?.cutout ? url : null} portrait={result && !result.cutout ? url : null} size={240} />
        </button>
        {state === 'busy' && (
          <div className="card-maker-busy" role="status">
            <span className="card-spinner" aria-hidden="true" />
            משפרים את התמונה…
          </div>
        )}
      </div>
      {state === 'error' && <p className="card-maker-error">התמונה לא נפתחה</p>}

      <input ref={camera} type="file" accept="image/*" capture="user" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <input ref={gallery} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />

      <div className="stack">
        {state === 'done' && result ? (
          <>
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSave({ portrait: result.portrait, cutout: result.cutout, style });
                } finally {
                  setSaving(false);
                }
              }}
            >
              שמירה
            </button>
            <button type="button" className="btn btn-quiet btn-block" onClick={() => pick(camera.current)}>
              צילום מחדש
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary btn-block" disabled={state === 'busy'} onClick={() => pick(camera.current)}>
            צילום
          </button>
        )}
        <div className="card-maker-links">
          <button type="button" className="text-btn" disabled={state === 'busy'} onClick={() => pick(gallery.current)}>
            תמונה מהגלריה
          </button>
          <button type="button" className="text-btn" onClick={() => setStyling(true)}>
            החולצה
          </button>
        </div>
      </div>

      {styling && (
        <CardStyleSheet
          card={{ ...card, cutout: result?.cutout ? url : null, portrait: result && !result.cutout ? url : null }}
          onClose={() => setStyling(false)}
          onDone={(s) => {
            setStyle(s);
            setStyling(false);
          }}
        />
      )}
    </div>
  );
}

/** An object URL for a blob, revoked when it changes. */
export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return setUrl(null);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}
