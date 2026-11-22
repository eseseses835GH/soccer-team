/** Gesture math for the big card's tilt and spin (pure: no DOM, no React). Angles in degrees. */

export const MAX_TILT = 18;
/** Movement before a drag picks an axis, px. */
export const SLOP = 8;
/** A release faster than this flips even a short drag, deg/ms. */
export const FLICK = 0.35;
/** A release faster than this adds a whole extra turn, deg/ms. */
export const SPIN = 1.6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Tilt toward the pointer: the pressed side sinks. `rx` around the horizontal axis, `ry` around the vertical. */
export function tiltFrom(px: number, py: number, rect: { left: number; top: number; width: number; height: number }, max = MAX_TILT): { rx: number; ry: number } {
  const nx = clamp(((px - rect.left) / rect.width) * 2 - 1, -1, 1);
  const ny = clamp(((py - rect.top) / rect.height) * 2 - 1, -1, 1);
  return { rx: -ny * max + 0, ry: nx * max + 0 };
}

/** Which way a drag goes, once it moved past the slop; null until then. Ties go to scrolling. */
export function lockAxis(dx: number, dy: number, slop = SLOP): 'x' | 'y' | null {
  if (Math.hypot(dx, dy) < slop) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

/** The card's turn while dragging: a full card width = half a turn. */
export const dragAngle = (from: number, dx: number, width: number) => from + (dx * 180) / Math.max(1, width);

/**
 * Where a released spin settles. `base` is the side it started on (a multiple of 180), `rot` where it is
 * now, `vel` the release speed (deg/ms). Flips past halfway or on a flick; a fast flick adds one whole
 * turn. Always lands on a multiple of 180.
 */
export function settleTarget(base: number, rot: number, vel: number): number {
  const moved = rot - base;
  const flick = Math.abs(vel) >= FLICK;
  const dir = flick ? Math.sign(vel) : Math.sign(moved);
  const flip = flick || Math.abs(moved) > 90;
  if (!flip || dir === 0) return base;
  const extra = Math.abs(vel) >= SPIN ? 360 : 0;
  return base + dir * (180 + extra);
}

/** The side showing at a resting angle. */
export const sideOf = (angle: number): 'front' | 'back' => (Math.abs(Math.round(angle / 180)) % 2 === 0 ? 'front' : 'back');

/** An angle as seen from a face: 0 = facing the viewer, ±180 = turned away. */
export function faceAngle(rot: number, side: 'front' | 'back'): number {
  const a = (((rot - (side === 'back' ? 180 : 0)) % 360) + 540) % 360 - 180;
  return a === -180 ? 180 : a;
}

export interface Spring {
  x: number;
  /** deg/s */
  v: number;
}

/** One step (dt seconds) of a slightly bouncy spring toward `target`. */
export function springStep(s: Spring, target: number, dt: number, k = 170, c = 20): Spring {
  const h = Math.min(dt, 1 / 30);
  const v = s.v + (-k * (s.x - target) - c * s.v) * h;
  return { x: s.x + v * h, v };
}

export const atRest = (s: Spring, target: number) => Math.abs(s.x - target) < 0.05 && Math.abs(s.v) < 0.5;

/** Release speed from recent samples (t ms, a deg): over the last ~80ms, clamped. */
export function velocityOf(samples: { t: number; a: number }[], now: number): number {
  const recent = samples.filter((s) => now - s.t <= 80);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const dt = Math.max(16, last.t - first.t);
  return clamp((last.a - first.a) / dt, -4, 4);
}
