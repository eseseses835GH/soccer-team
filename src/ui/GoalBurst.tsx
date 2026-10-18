import { useEffect, useMemo, useRef } from 'react';

export const BURST_MS = 2000;

export interface ConfettiPiece {
  /** Where it flies to (px from the centre) before falling. */
  dx: number;
  dy: number;
  rot: number;
  delay: number;
  shape: 'strip' | 'dot';
  tone: 0 | 1 | 2;
}

/** A ring of confetti, evenly spread with some jitter, kept within ±maxX so it never overflows a phone. */
export function confetti(n: number, maxX = 170, rnd: () => number = Math.random): ConfettiPiece[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    const dist = 90 + rnd() * 90;
    return {
      dx: Math.round(Math.max(-maxX, Math.min(maxX, Math.cos(angle) * dist * 1.1))),
      dy: Math.round(Math.sin(angle) * dist * 0.8 - 40),
      rot: Math.round((rnd() - 0.5) * 720),
      delay: Math.round(rnd() * 90),
      shape: i % 3 === 0 ? 'dot' : 'strip',
      tone: (i % 3) as 0 | 1 | 2,
    };
  });
}

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * "גוֹל!" bursting in the scoring team's bib colour, with a ring and confetti.
 * Purely decorative and click-through, so the scorer sheet and the clock stay usable.
 * Mount with a new `key` per goal; it calls `onDone` when finished.
 */
export function GoalBurst({ color, onDone }: { color: string; onDone: () => void }) {
  const reduced = useMemo(reducedMotion, []);
  const pieces = useMemo(() => (reduced ? [] : confetti(28)), [reduced]);
  const word = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    // Reduced motion: CSS animations are switched off globally, so a plain fade via the Web Animations API.
    if (reduced)
      word.current?.animate?.([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 1200, fill: 'forwards' });
    const id = window.setTimeout(() => done.current(), reduced ? 1200 : BURST_MS);
    return () => window.clearTimeout(id);
  }, [reduced]);

  return (
    <div className={`goal-burst ${reduced ? 'calm' : ''}`} style={{ '--team': color } as React.CSSProperties} aria-hidden="true">
      <div className="burst-center">
        {!reduced && <span className="burst-ring" />}
        {pieces.map((p, i) => (
          <span
            key={i}
            className={`confetto ${p.shape} tone-${p.tone}`}
            style={{ '--dx': `${p.dx}px`, '--dy': `${p.dy}px`, '--rot': `${p.rot}deg`, animationDelay: `${p.delay}ms` } as React.CSSProperties}
          />
        ))}
        <div className="burst-word" ref={word}>
          גוֹל!
        </div>
        {!reduced && (
          <span className="burst-ball">
            ⚽
          </span>
        )}
      </div>
    </div>
  );
}
