import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ATTR_KEYS, type Attributes } from '../engine';
import { ATTR_LABELS, scoreLabel } from '../i18n';
import { STRENGTHS, WEAKNESSES, cardById, type Card, type CardId } from '../state/cards';

/** Labelled slider with a visible value. */
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
    <div className="slider">
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
      <output htmlFor={id}>{value}</output>
    </div>
  );
}

/** Tap-to-rate: a row of 1..10 buttons. */
export function LevelPicker({ value, onChange, label = 'רמה' }: { value: number; onChange: (v: number) => void; label?: string }) {
  return (
    <div className="levels" role="radiogroup" aria-label={label}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {v}
        </button>
      ))}
    </div>
  );
}

function CardGroup({ title, cards, value, onToggle }: { title: string; cards: Card[]; value: CardId[]; onToggle: (id: CardId) => void }) {
  return (
    <div className="card-group" role="group" aria-label={title}>
      <span className="card-group-title">{title}</span>
      <div className="card-chips">
        {cards.map((c) => {
          const on = value.includes(c.id);
          return (
            <button key={c.id} type="button" className={`card-chip ${on ? 'on' : ''}`} aria-pressed={on} title={c.blurb} onClick={() => onToggle(c.id)}>
              <span className="card-emoji" aria-hidden="true">
                {c.emoji}
              </span>
              {c.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Two labelled rows of card chips (strengths, then weaknesses) and the blurbs of the picked ones. */
export function CardPicker({ value, onToggle }: { value: CardId[]; onToggle: (id: CardId) => void }) {
  const picked = value.map(cardById).filter((c): c is Card => !!c);
  return (
    <div className="card-picker">
      <CardGroup title="חוזקות" cards={STRENGTHS} value={value} onToggle={onToggle} />
      <CardGroup title="חולשות" cards={WEAKNESSES} value={value} onToggle={onToggle} />
      {picked.length > 0 && (
        <ul className="card-notes" aria-live="polite">
          {picked.map((c) => (
            <li key={c.id}>
              <span aria-hidden="true">{c.emoji}</span> <strong>{c.name}:</strong> {c.blurb}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Card emojis next to a name. Screens that people can see over the organizer's
 * shoulder show strengths only; the players screen passes `all`.
 */
export function CardBadges({ cards, all = false }: { cards: CardId[]; all?: boolean }) {
  const shown = cards.map(cardById).filter((c): c is Card => !!c && (all || c.kind === 'strength'));
  if (!shown.length) return null;
  return (
    <span className="badges" aria-label={shown.map((c) => c.name).join(', ')}>
      {shown.map((c) => (
        <span key={c.id} aria-hidden="true" title={c.name}>
          {c.emoji}
        </span>
      ))}
    </span>
  );
}

/** One slider per attribute except the level. */
export function AttrSliders({ attrs, onChange }: { attrs: Attributes; onChange: (a: Attributes) => void }) {
  return (
    <div className="sliders">
      {ATTR_KEYS.filter((k) => k !== 'overall').map((k) => (
        <RatingSlider key={k} label={ATTR_LABELS[k]} value={attrs[k]} onChange={(v) => onChange({ ...attrs, [k]: v })} />
      ))}
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, min, max, onChange, label, suffix }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string; suffix?: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label="יותר" disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
      <span aria-live="polite">
        {value}
        {suffix && <small> {suffix}</small>}
      </span>
      <button type="button" aria-label="פחות" disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle">
      <span className="toggle-text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}

/** Bottom sheet dialog. Escape and backdrop close it; focus moves inside on open. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
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

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
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

function usePrefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Big 0–100 balance score; counts up when `animateKey` changes. */
export function ScoreMeter({ score, animateKey }: { score: number; animateKey?: string | number }) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(score);
  const lastKey = useRef(animateKey);
  useEffect(() => {
    if (reduced || animateKey === undefined || lastKey.current === animateKey) {
      setShown(score);
      return;
    }
    lastKey.current = animateKey;
    let raf = 0;
    const t0 = performance.now();
    const from = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 800);
      setShown(Math.round(from + (score - from) * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score, animateKey, reduced]);
  const tone = score >= 85 ? 'great' : score >= 70 ? 'good' : score >= 50 ? 'ok' : 'bad';
  return (
    <div className={`score tone-${tone}`} role="status" aria-label={`מדד איזון ${score} מתוך 100, ${scoreLabel(score)}`}>
      <div className="score-num" aria-hidden="true">
        {shown}
      </div>
      <div className="score-side" aria-hidden="true">
        <span className="score-label">{scoreLabel(score)}</span>
        <span className="score-of">מדד איזון · מתוך 100</span>
        <span className="score-bar">
          <span style={{ inlineSize: `${shown}%` }} />
        </span>
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
