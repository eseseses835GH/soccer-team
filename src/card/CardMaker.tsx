/** Take or pick a photo → it's framed and cleaned up on the phone → the card → save. */
import { useEffect, useRef, useState } from 'react';
import { CardStyleSheet } from './CardStyleSheet';
import { minFrame, panFrame, pictureBox, sameFrame, withZoom, zoomFrame, zoomOf, MAX_ZOOM, type Square } from './crop';
import { PlayerCard, VIEW_W, type CardStat } from './PlayerCard';
import { previewUrl, processPhoto, renderFramed, type ProcessOptions, type Processed } from './process';
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
  existing,
  onSaveStyle,
  options,
}: {
  name: string;
  position?: CardPosition;
  score?: number;
  stats?: CardStat[];
  initialStyle?: CardStyle;
  onSave: (card: CardSave) => void | Promise<void>;
  /** The card he has now (shown until a new photo is taken). */
  existing?: { cutout: string | null; portrait: string | null };
  /** With `existing`: save a new shirt alone, keeping the photo. */
  onSaveStyle?: (style: CardStyle) => void | Promise<void>;
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
  const [frame, setFrame] = useState<Square | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const run = useRef(0);
  const stage = useRef<HTMLDivElement>(null);

  // The wider enhanced picture for moving/zooming (a smaller copy is enough on screen).
  useEffect(() => {
    if (!result) return;
    let off = false;
    let made: string | null = null;
    void previewUrl(result.source.cutout ?? result.source.portrait).then((u) => {
      made = u;
      if (off) {
        if (u) URL.revokeObjectURL(u);
      } else setPreview(u);
    });
    return () => {
      off = true;
      if (made) URL.revokeObjectURL(made);
      setPreview(null);
    };
  }, [result]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const mine = ++run.current;
    setState('busy');
    try {
      const r = await processPhoto(file, options);
      if (mine !== run.current) return;
      setResult(r);
      setFrame(r.source.base);
      setState('done');
    } catch {
      if (mine === run.current) setState('error');
    }
  };

  const card = { name, position, score, stats, style };
  const src = result?.source;
  const pic = src ? { w: src.portrait.width, h: src.portrait.height } : null;
  const shown = result
    ? { cutout: src?.cutout ? preview : null, portrait: !src?.cutout ? preview : null }
    : (existing ?? { cutout: null, portrait: null });
  const imageBox = result && frame && pic ? pictureBox(frame, pic) : undefined;
  const moved = !!(src && frame && !sameFrame(frame, src.base));
  const move = (f: (fr: Square) => Square) => setFrame((fr) => (fr ? f(fr) : fr));
  const gesture = useFrameGesture(stage, !!(src && pic), {
    slot: src?.cutout ? 260 / VIEW_W : 196 / VIEW_W,
    pan: (dx, dy) => src && pic && move((fr) => panFrame(fr, dx, dy, pic, minFrame(src.base))),
    zoom: (k, ax, ay) => src && pic && move((fr) => zoomFrame(fr, k, pic, minFrame(src.base), ax, ay)),
  });
  // The slider works on log zoom: from the whole kept area to MAX_ZOOM.
  const zMin = src && pic ? Math.log(src.base.size / Math.min(pic.w, pic.h)) : 0;
  const zMax = Math.log(MAX_ZOOM);
  const zNow = src && frame ? Math.log(zoomOf(src.base, frame)) : 0;
  const saveNew = async () => {
    if (!result) return;
    const files = src && frame && moved ? await renderFramed(src, frame) : result;
    await onSave({ portrait: files.portrait, cutout: files.cutout, style });
  };
  const hasPhoto = !!(existing?.cutout || existing?.portrait);
  const styleChanged = JSON.stringify(style) !== JSON.stringify(sanitizeStyle(initialStyle));
  const save = async (f: () => void | Promise<void>) => {
    setSaving(true);
    try {
      await f();
    } finally {
      setSaving(false);
    }
  };
  const pick = (input: HTMLInputElement | null) => {
    if (!input) return;
    input.value = '';
    input.click();
  };

  return (
    <div className="card-maker">
      <div ref={stage} className={`card-maker-stage ${state === 'busy' ? 'is-busy' : ''} ${gesture ? 'is-movable' : ''}`}>
        {gesture ? (
          <div className="card-maker-card" data-frame={frame ? `${Math.round(frame.x)},${Math.round(frame.y)},${Math.round(frame.size)}` : ''}>
            <PlayerCard {...card} {...shown} imageBox={imageBox} size={240} />
          </div>
        ) : (
          <button type="button" className="card-maker-card" tabIndex={-1} aria-hidden="true" onClick={() => setStyling(true)}>
            <PlayerCard {...card} {...shown} size={240} />
          </button>
        )}
        {state === 'busy' && (
          <div className="card-maker-busy" role="status">
            <span className="card-spinner" aria-hidden="true" />
            משפרים את התמונה…
          </div>
        )}
      </div>
      {state === 'error' && <p className="card-maker-error">התמונה לא נפתחה</p>}
      {state === 'done' && src && frame && pic && (
        <div className="card-maker-zoom">
          <input
            type="range"
            aria-label="הגדלה"
            min={zMin}
            max={zMax}
            step="any"
            value={zNow}
            style={{ '--pct': `${zMax > zMin ? ((zNow - zMin) / (zMax - zMin)) * 100 : 0}%` } as React.CSSProperties}
            onChange={(e) => move((fr) => withZoom(fr, src.base, Math.exp(Number(e.target.value)), pic))}
          />
          <button type="button" className="text-btn" disabled={!moved} onClick={() => setFrame(src.base)}>
            איפוס
          </button>
        </div>
      )}

      <input ref={camera} type="file" accept="image/*" capture="user" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <input ref={gallery} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />

      <div className="stack">
        {state === 'done' && result ? (
          <>
            <button type="button" className="btn btn-primary btn-block" disabled={saving} onClick={() => save(saveNew)}>
              שמירה
            </button>
            <button type="button" className="btn btn-quiet btn-block" onClick={() => pick(camera.current)}>
              צילום מחדש
            </button>
          </>
        ) : hasPhoto && onSaveStyle && styleChanged && state !== 'busy' ? (
          <>
            <button type="button" className="btn btn-primary btn-block" disabled={saving} onClick={() => save(() => onSaveStyle(style))}>
              שמירה
            </button>
            <button type="button" className="btn btn-quiet btn-block" onClick={() => pick(camera.current)}>
              צילום
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary btn-block" disabled={state === 'busy'} onClick={() => pick(camera.current)}>
              צילום
            </button>
            {/* No photo yet: the photo is the main thing; a new shirt alone is only a side save. */}
            {existing && onSaveStyle && styleChanged && state !== 'busy' && (
              <button type="button" className="btn btn-quiet btn-block" disabled={saving} onClick={() => save(() => onSaveStyle(style))}>
                שמירת החולצה
              </button>
            )}
          </>
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
          card={{ ...card, ...shown, imageBox }}
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

/**
 * Drag to move the photo, pinch or scroll to zoom (pointer events; touch first). `pan` gets the move
 * in shares of the photo's slot, `zoom` a factor and the anchor (shares of the slot). True when on.
 */
function useFrameGesture(
  ref: React.RefObject<HTMLDivElement | null>,
  on: boolean,
  h: { slot: number; pan: (dx: number, dy: number) => void; zoom: (k: number, ax: number, ay: number) => void },
): boolean {
  const hr = useRef(h);
  hr.current = h;
  useEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    const pts = new Map<number, { x: number; y: number }>();
    // The photo's square slot on screen.
    const slotRect = () => {
      const svg = el.querySelector('svg')!.getBoundingClientRect();
      const s = svg.width * hr.current.slot;
      const top = hr.current.slot > 0.8 ? 30 : 60;
      return { x: svg.left + (svg.width - s) / 2, y: svg.top + (svg.width / VIEW_W) * top, s };
    };
    const mid = () => {
      const a = [...pts.values()];
      return { x: a.reduce((t, p) => t + p.x, 0) / a.length, y: a.reduce((t, p) => t + p.y, 0) / a.length };
    };
    const spread = () => {
      const [a, b] = [...pts.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const down = (e: PointerEvent) => {
      el.setPointerCapture?.(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      e.preventDefault();
    };
    const moveP = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      const r = slotRect();
      const m0 = mid();
      const d0 = spread();
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const m1 = mid();
      hr.current.pan((m1.x - m0.x) / r.s, (m1.y - m0.y) / r.s);
      const d1 = spread();
      if (d0 > 0 && d1 > 0) hr.current.zoom(d1 / d0, (m1.x - r.x) / r.s, (m1.y - r.y) / r.s);
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = slotRect();
      hr.current.zoom(Math.exp(-e.deltaY * 0.002), (e.clientX - r.x) / r.s, (e.clientY - r.y) / r.s);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', moveP);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', moveP);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [ref, on]);
  return on;
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
