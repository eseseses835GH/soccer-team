// Coach marks over the home screen: dim the page, a spotlight around the real element, one short line.
// Targets are `data-tour="…"` attributes; a step whose element isn't on the page is skipped.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { availableSteps, bubbleAt, onTourStart, spotBox, stepsFor, takePendingTour, type Box, type TourKind, type TourStep } from './onboarding';

function findTarget(t: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${t}"]`);
  if (!el || !el.getClientRects().length) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

/** In the sticky top bar or the fixed bottom dock: scrolling won't move it. */
function pinned(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
    const p = getComputedStyle(n).position;
    if (p === 'fixed' || p === 'sticky') return true;
  }
  return false;
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Bring the element into the middle of the screen (a tall one: its top under the top bar). */
function bringIntoView(el: HTMLElement) {
  if (pinned(el)) return;
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  if (r.top >= 70 && r.bottom <= vh - 150) return;
  const tall = r.height > vh * 0.45;
  const top = window.scrollY + r.top - (tall ? 90 : (vh - r.height) / 2);
  window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/** Starts when asked (the offer's "יאללה", help's "סיור באפליקציה"); lives on the home screen. */
export function TourHost({ kind }: { kind: TourKind }) {
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  useEffect(() => {
    let timer = 0;
    const begin = (tries = 0) => {
      window.clearTimeout(timer);
      // Let the home screen paint (a player's home may still be loading).
      timer = window.setTimeout(() => {
        const s = availableSteps(stepsFor(kind), (t) => !!findTarget(t));
        if (s.length >= 2 || (s.length && tries >= 8)) setSteps(s);
        else if (tries < 8) begin(tries + 1);
      }, 120);
    };
    if (takePendingTour()) begin();
    const off = onTourStart(() => {
      takePendingTour();
      begin();
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [kind]);
  if (!steps) return null;
  return <Tour steps={steps} onClose={() => setSteps(null)} />;
}

function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const nextRef = useRef<HTMLButtonElement>(null);
  const xRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [bubbleH, setBubbleH] = useState(110);
  const close = useRef(onClose);
  close.current = onClose;
  const step = steps[i];
  const last = i === steps.length - 1;

  useLayoutEffect(() => {
    const el = findTarget(step.target);
    if (!el) {
      // Gone since the tour started: skip it.
      if (last) close.current();
      else setI((x) => x + 1);
      return;
    }
    bringIntoView(el);
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        setSize({ w: window.innerWidth, h: window.innerHeight });
        setBox(spotBox(r, window.innerWidth, window.innerHeight));
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step, last]);

  useLayoutEffect(() => {
    if (bubbleRef.current) setBubbleH(bubbleRef.current.offsetHeight);
  }, [box, i]);

  // Once the bubble is placed (hidden until then, and a hidden button can't take focus).
  const placed = !!box;
  useEffect(() => {
    if (placed) nextRef.current?.focus({ preventScroll: true });
  }, [i, placed]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key === 'Tab') {
        // Two buttons: keep the focus inside.
        e.preventDefault();
        (document.activeElement === nextRef.current ? xRef.current : nextRef.current)?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, []);

  const next = () => (last ? onClose() : setI(i + 1));

  const style: React.CSSProperties = box
    ? bubbleAt(box, size.w, size.h, bubbleH)
    : { width: Math.min(300, size.w - 32), visibility: 'hidden' };

  return createPortal(
    <div className="tour">
      {/* Taps outside the bubble do nothing. */}
      <div className="tour-block" />
      {box && <div className="tour-spot" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} aria-hidden="true" />}
      <div ref={bubbleRef} className="tour-bubble" role="dialog" aria-modal="true" aria-label={`סיור · ${i + 1} מתוך ${steps.length}`} aria-describedby="tour-text" style={style}>
        <button ref={xRef} type="button" className="icon-btn tour-x" aria-label="סגירת הסיור" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
        <p id="tour-text" className="tour-text">
          {step.text}
        </p>
        <div className="tour-foot">
          <span className="tour-dots" aria-hidden="true">
            {steps.map((s, k) => (
              <i key={s.target} className={k === i ? 'on' : ''} />
            ))}
          </span>
          <button ref={nextRef} type="button" className="btn btn-primary btn-small" onClick={next}>
            {last ? 'סיימתי' : 'הבא'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
