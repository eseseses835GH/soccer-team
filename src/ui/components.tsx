import { useEffect, useId, useRef, type ReactNode } from 'react';
import { scoreLabel } from '../i18n';

/** Labelled 1–10 slider with a large thumb and a visible value. */
export function RatingSlider({
  label,
  value,
  onChange,
  min = 1,
  max = 10,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="rating-slider">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output htmlFor={id} className="rating-value">
        {value}
      </output>
    </div>
  );
}

/** Tap-to-rate: a row of 1..10 buttons. */
export function TapRating({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="tap-rating" role="radiogroup" aria-label={label}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          className={v === value ? 'on' : v < value ? 'below' : ''}
          onClick={() => onChange(v)}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label="הפחת" disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span className="stepper-value" aria-live="polite">
        {value}
      </span>
      <button type="button" aria-label="הוסף" disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

/** Bottom sheet dialog. Escape and backdrop close it; focus moves inside on open. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" aria-label="סגירה" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        {icon}
      </div>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function ScoreMeter({ score }: { score: number }) {
  const tone = score >= 85 ? 'great' : score >= 70 ? 'good' : score >= 50 ? 'ok' : 'bad';
  return (
    <div className={`score score-${tone}`} role="status" aria-live="polite">
      <div className="score-num">
        <strong>{score}</strong>
        <span>/100</span>
      </div>
      <div className="score-body">
        <div className="score-label">מדד איזון · {scoreLabel(score)}</div>
        <div className="score-bar" aria-hidden="true">
          <div style={{ inlineSize: `${score}%` }} />
        </div>
      </div>
    </div>
  );
}

export function Toast({ message }: { message: string | null }) {
  return (
    <div className={`toast ${message ? 'show' : ''}`} role="status" aria-live="polite">
      {message}
    </div>
  );
}
