/**
 * The big card in your hand: it leans toward the finger (or mouse) with a moving shine, a sideways
 * swipe spins it over to the back, and it springs back when let go. Vertical drags stay the sheet's
 * (`touch-action: pan-y`). All motion is written straight to the DOM in a rAF loop: the SVGs never
 * re-render per frame. Reduced motion: no tilt or spin, a small "↻" turns it over.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { VIEW_H, VIEW_W, shieldPath } from './PlayerCard';
import { atRest, dragAngle, faceAngle, lockAxis, settleTarget, sideOf, springStep, tiltFrom, velocityOf, type Spring } from './tilt';

const SHIELD_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${VIEW_W} ${VIEW_H}' preserveAspectRatio='none'><path d='${shieldPath(0)}'/></svg>`,
)}")`;
const SPUN_KEY = 'kochot.cardSpun';
let hintedThisLoad = false;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function SpinCard({ front, back, width, foil }: { front: ReactNode; back: ReactNode; width: number; foil?: boolean }) {
  const [reduced] = useState(reducedMotion);
  const [side, setSide] = useState<'front' | 'back'>('front');
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const shine = useRef<(HTMLDivElement | null)[]>([]);
  const sideRef = useRef(side);
  sideRef.current = side;

  // Motion state (refs only).
  const m = useRef({
    rot: { x: 0, v: 0 } as Spring,
    rx: { x: 0, v: 0 } as Spring,
    ry: { x: 0, v: 0 } as Spring,
    base: 0,
    tilt: { rx: 0, ry: 0 },
    orient: { rx: 0, ry: 0 },
    drag: null as null | { id: number; x0: number; y0: number; axis: 'x' | 'y' | null; from: number; lockDx: number; samples: { t: number; a: number }[]; touch: boolean },
    hover: false,
    raf: 0,
    last: 0,
  });

  const paint = () => {
    const s = m.current;
    const el = body.current;
    if (!el) return;
    el.style.transform = `rotateX(${s.rx.x.toFixed(2)}deg) rotateY(${(s.rot.x + s.ry.x).toFixed(2)}deg)`;
    (['front', 'back'] as const).forEach((f, i) => {
      const a = faceAngle(s.rot.x + s.ry.x, f);
      const gx = Math.max(-1, Math.min(1, a / 40));
      const gy = Math.max(-1, Math.min(1, -s.rx.x / 30));
      const mag = Math.min(1, (Math.abs(a) + Math.abs(s.rx.x)) / 16);
      const glare = shine.current[i * 2];
      const rainbow = shine.current[i * 2 + 1];
      if (glare) {
        glare.style.transform = `translate(${(gx * 25).toFixed(2)}%, ${(gy * 25).toFixed(2)}%)`;
        glare.style.opacity = (mag * 0.75).toFixed(3);
      }
      if (rainbow) {
        rainbow.style.transform = `translateX(${(-(gx + gy * 0.5) * 22).toFixed(2)}%)`;
        rainbow.style.opacity = (mag * 0.22).toFixed(3);
      }
    });
  };

  const frame = (now: number) => {
    const s = m.current;
    const dt = s.last ? (now - s.last) / 1000 : 1 / 60;
    s.last = now;
    const t = s.drag || s.hover ? s.tilt : s.orient;
    if (!(s.drag && s.drag.axis === 'x')) s.rot = springStep(s.rot, s.base, dt);
    s.rx = springStep(s.rx, t.rx, dt, 260, 26);
    s.ry = springStep(s.ry, s.drag?.axis === 'x' ? 0 : t.ry, dt, 260, 26);
    const rest = !s.drag && atRest(s.rot, s.base) && atRest(s.rx, t.rx) && atRest(s.ry, t.ry);
    if (rest) {
      s.rot = { x: s.base, v: 0 };
      s.rx = { x: t.rx, v: 0 };
      s.ry = { x: t.ry, v: 0 };
    }
    paint();
    if (rest) {
      s.raf = 0;
      s.last = 0;
      body.current?.classList.remove('is-moving');
      const landed = sideOf(s.base);
      // Keep the numbers small: 540° is 180°.
      s.base = landed === 'back' ? 180 : 0;
      s.rot.x = s.base;
      if (landed !== sideRef.current) setSide(landed);
      return;
    }
    s.raf = requestAnimationFrame(frame);
  };

  const kick = () => {
    const s = m.current;
    if (s.raf) return;
    body.current?.classList.add('is-moving');
    s.raf = requestAnimationFrame(frame);
  };

  useEffect(() => () => cancelAnimationFrame(m.current.raf), []);

  // A one-time nudge so the card looks alive (until he has spun one).
  useEffect(() => {
    if (reduced || hintedThisLoad) return;
    let spun = false;
    try {
      spun = localStorage.getItem(SPUN_KEY) === '1';
    } catch {
      /* private mode */
    }
    if (spun) return;
    hintedThisLoad = true;
    const t = setTimeout(() => {
      if (m.current.drag) return;
      m.current.rot.v = -150;
      kick();
    }, 650);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  // Phones (not iOS, which would need a permission prompt): a gentle lean with the device.
  useEffect(() => {
    if (reduced || typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return;
    if (typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === 'function') return;
    if (!matchMedia('(pointer: coarse)').matches) return;
    let b0: number | null = null;
    let g0 = 0;
    const q = (v: number) => Math.round(Math.max(-6, Math.min(6, v)) * 2) / 2;
    const on = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      if (b0 === null) {
        b0 = e.beta;
        g0 = e.gamma;
      }
      // A slowly following baseline: only changes lean the card, however he holds the phone.
      b0 += (e.beta - b0) * 0.02;
      g0 += (e.gamma - g0) * 0.02;
      const next = { rx: q(-(e.beta - b0) * 0.5), ry: q((e.gamma - g0) * 0.5) };
      const s = m.current;
      if (next.rx === s.orient.rx && next.ry === s.orient.ry) return;
      s.orient = next;
      if (!s.drag && !s.hover) kick();
    };
    window.addEventListener('deviceorientation', on);
    return () => window.removeEventListener('deviceorientation', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const flipNow = () => {
    const s = m.current;
    s.base = sideOf(s.base) === 'front' ? 180 : 0;
    s.rot = { x: s.base, v: 0 };
    paint();
    setSide(sideOf(s.base));
  };

  const rect = () => root.current!.getBoundingClientRect();

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const s = m.current;
    s.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null, from: s.rot.x, lockDx: 0, samples: [], touch: e.pointerType !== 'mouse' };
    if (reduced) return;
    s.tilt = tiltFrom(e.clientX, e.clientY, rect());
    kick();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = m.current;
    const d = s.drag;
    if (!d || d.id !== e.pointerId) {
      if (e.pointerType === 'mouse' && !reduced && !d) {
        s.hover = true;
        s.tilt = tiltFrom(e.clientX, e.clientY, rect());
        kick();
      }
      return;
    }
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.axis) {
      d.axis = lockAxis(dx, dy);
      if (d.axis === 'x') {
        d.from = s.rot.x;
        d.lockDx = dx;
        root.current?.setPointerCapture?.(e.pointerId);
      }
    }
    if (!reduced) s.tilt = tiltFrom(e.clientX, e.clientY, rect());
    if (d.axis === 'x') {
      const a = dragAngle(d.from, dx - d.lockDx, rect().width);
      const now = performance.now();
      d.samples.push({ t: now, a });
      if (d.samples.length > 12) d.samples.shift();
      if (!reduced) {
        s.rot = { x: a, v: 0 };
        kick();
      }
    } else if (!reduced) kick();
  };

  const release = (e: React.PointerEvent, cancelled: boolean) => {
    const s = m.current;
    const d = s.drag;
    if (!d || d.id !== e.pointerId) return;
    s.drag = null;
    s.hover = !d.touch && !cancelled;
    if (d.axis === 'x' && !cancelled) {
      const last = d.samples[d.samples.length - 1];
      const vel = velocityOf(d.samples, performance.now());
      const target = settleTarget(s.base, last ? last.a : s.rot.x, vel);
      try {
        localStorage.setItem(SPUN_KEY, '1');
      } catch {
        /* private mode */
      }
      if (reduced) {
        if (sideOf(target) !== sideOf(s.base)) flipNow();
        return;
      }
      s.base = target;
      s.rot.v = vel * 1000;
    }
    if (!reduced) kick();
  };

  const onLeave = (e: React.PointerEvent) => {
    const s = m.current;
    if (e.pointerType === 'mouse' && !s.drag) {
      s.hover = false;
      kick();
    }
  };

  return (
    <div
      ref={root}
      className={`card-spin${reduced ? ' is-still' : ''}`}
      data-side={side}
      style={{ inlineSize: width, blockSize: (width * VIEW_H) / VIEW_W }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => release(e, false)}
      onPointerCancel={(e) => release(e, true)}
      onPointerLeave={onLeave}
      // No release on lostpointercapture: on touch the browser's implicit capture moves to the card
      // when it takes the pointer, which fired a release mid-drag and the card never turned.
      onDragStart={(e) => e.preventDefault()}
    >
      <div ref={body} className="card-spin-body">
        {[front, back].map((face, i) => (
          <div key={i} className={`card-spin-face ${i ? 'is-back' : 'is-front'}`} aria-hidden={(i ? 'back' : 'front') !== side}>
            {face}
            <div className="card-shine" style={{ maskImage: SHIELD_MASK, WebkitMaskImage: SHIELD_MASK }} aria-hidden="true">
              <div className="card-glare" ref={(el) => void (shine.current[i * 2] = el)} />
              {foil && <div className="card-foil" ref={(el) => void (shine.current[i * 2 + 1] = el)} />}
            </div>
          </div>
        ))}
      </div>
      {reduced && (
        <button type="button" className="card-flip-btn" aria-label="הפיכת הקלף" onClick={flipNow}>
          ↻
        </button>
      )}
    </div>
  );
}
