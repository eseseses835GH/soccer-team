import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Width of the revealed action, px. */
const ACTION_W = 88;
/** Movement before we decide between a swipe and a scroll, px. */
const SLOP = 10;
/** Past this share of the row width, letting go asks right away (a "full swipe"). */
const FULL = 0.6;

/** Only one row is open at a time: opening a row closes the previous one. */
let closeOpenRow: (() => void) | null = null;

function swallowNextClick() {
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    done();
  };
  const done = () => {
    document.removeEventListener('click', stop, true);
    clearTimeout(timer);
  };
  document.addEventListener('click', stop, true);
  const timer = setTimeout(done, 600);
}

/**
 * A list row (`<li>`) whose trailing edge slides in to reveal a red delete action.
 *
 * Direction follows the page direction, like iOS and WhatsApp: the action sits on the
 * trailing edge. In RTL you drag the row to the right and "מחיקה" appears on the left;
 * in LTR it's mirrored.
 * Tapping the action, or swiping most of the way, calls `onDelete`, which should
 * ask for confirmation. Vertical scrolling is never captured (`touch-action: pan-y`,
 * and a swipe starts only after a clearly horizontal move).
 */
export function SwipeRow({
  children,
  actionLabel,
  onDelete,
  className,
  disabled,
  nudge,
}: {
  children: ReactNode;
  actionLabel: string;
  onDelete: () => void;
  className?: string;
  /** No swiping (e.g. while selecting several rows); an open row closes. */
  disabled?: boolean;
  /** Peek at the action once (a hint); skipped while the row is moved or open. */
  nudge?: boolean;
}) {
  const rowRef = useRef<HTMLLIElement>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const g = useRef({ id: -1, x: 0, y: 0, base: 0, mode: 'idle' as 'idle' | 'pending' | 'drag' | 'scroll', sign: -1, suppressClick: false });
  const open = offset > 0 && !dragging;

  const close = () => setOffset(0);

  useEffect(() => {
    if (disabled) setOffset(0);
  }, [disabled]);

  // Opening registers this row as the open one; tapping elsewhere or scrolling closes it.
  useEffect(() => {
    if (!open) return;
    closeOpenRow?.();
    const me = () => setOffset(0);
    closeOpenRow = me;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (rowRef.current?.contains(t)) return;
      me();
      // A tap on another row only closes this one (as on iOS); it doesn't open that row too.
      if (t.closest?.('.swipe-row')) swallowNextClick();
    };
    const onScroll = () => me();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('scroll', onScroll, true);
      if (closeOpenRow === me) closeOpenRow = null;
    };
  }, [open]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    g.current = { id: e.pointerId, x: e.clientX, y: e.clientY, base: offset, mode: 'pending', sign: rtl ? 1 : -1, suppressClick: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (e.pointerId !== s.id || s.mode === 'idle' || s.mode === 'scroll') return;
    const dx = (e.clientX - s.x) * s.sign;
    const dy = e.clientY - s.y;
    if (s.mode === 'pending') {
      if (Math.abs(dy) > SLOP && Math.abs(dy) >= Math.abs(dx)) {
        s.mode = 'scroll';
        return;
      }
      if (Math.abs(dx) < SLOP || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      s.mode = 'drag';
      s.x = e.clientX; // start from here, so the row doesn't jump by the slop
      e.currentTarget.setPointerCapture?.(e.pointerId);
      window.getSelection()?.removeAllRanges(); // a mouse drag may have started selecting text
      setDragging(true);
      return;
    }
    const width = e.currentTarget.clientWidth;
    let next = s.base + (e.clientX - s.x) * s.sign;
    if (next < 0) next = 0;
    if (next > width) next = width;
    setOffset(next);
  };

  const finish = (e: React.PointerEvent) => {
    const s = g.current;
    if (e.pointerId !== s.id) return;
    const wasDrag = s.mode === 'drag';
    const wasTapOnOpen = s.mode === 'pending' && s.base > 0;
    s.mode = 'idle';
    if (wasDrag) {
      s.suppressClick = true;
      setDragging(false);
      const width = e.currentTarget.clientWidth;
      if (e.type !== 'pointercancel' && offset > width * FULL) {
        setOffset(ACTION_W);
        onDelete();
      } else setOffset(offset > ACTION_W / 2 ? ACTION_W : 0);
    } else if (wasTapOnOpen && !(e.target as HTMLElement).closest('.swipe-action')) {
      // A tap on an open row's content closes it instead of opening the row.
      s.suppressClick = true;
      close();
    }
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (!g.current.suppressClick) return;
    g.current.suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <li
      ref={rowRef}
      className={`swipe-row ${dragging ? 'dragging' : ''} ${offset > 0 ? 'revealed' : ''} ${nudge && !offset && !dragging ? 'nudge' : ''} ${className ?? ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onClickCapture={onClickCapture}
    >
      <button
        type="button"
        className="swipe-action"
        aria-label={actionLabel}
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
        style={{ inlineSize: Math.max(ACTION_W, offset) }}
        onClick={onDelete}
      >
        מחיקה
      </button>
      {/* The content's trailing edge follows the finger and the row shrinks, so the name stays in place and readable. */}
      <div className="swipe-content" style={{ inlineSize: `calc(100% - ${offset}px)` }}>
        {children}
      </div>
    </li>
  );
}

/** Close whichever row is open (e.g. after the confirmation is cancelled). */
export function closeSwipeRows() {
  closeOpenRow?.();
}
