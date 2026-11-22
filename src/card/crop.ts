/** Head-and-shoulders square crop from a face box (pure). */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Square {
  x: number;
  y: number;
  size: number;
}

/** The face's width as a share of the crop's side, and where its centre sits from the top. */
export const FACE_SHARE = 0.34;
export const FACE_TOP = 0.42;

/**
 * The square to cut from a `width`×`height` image. With a face: head and shoulders, face centred
 * horizontally and a little above the middle; without: a centre crop (a tall photo leans up, where
 * heads usually are). Always inside the image.
 */
export function cropBox(width: number, height: number, face?: Box | null): Square {
  const max = Math.min(width, height);
  if (!face || face.w <= 0 || face.h <= 0) {
    const y = height > width ? (height - max) * 0.25 : (height - max) / 2;
    return { x: Math.round((width - max) / 2), y: Math.round(y), size: Math.round(max) };
  }
  const faceSize = Math.max(face.w, face.h * 0.85);
  const size = Math.min(max, Math.max(faceSize / FACE_SHARE, Math.min(max, 96)));
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h / 2;
  const x = clamp(cx - size / 2, 0, width - size);
  const y = clamp(cy - size * FACE_TOP, 0, height - size);
  return { x: Math.round(x), y: Math.round(y), size: Math.round(size) };
}

/** `box` (image pixels) in the coordinates of `crop` scaled to `out`×`out`. */
export function mapBox(box: Box, crop: Square, out: number): Box {
  const k = out / crop.size;
  return { x: (box.x - crop.x) * k, y: (box.y - crop.y) * k, w: box.w * k, h: box.h * k };
}

/** Where to measure light when no face was found: the upper middle of the square. */
export const centerFace = (out: number): Box => ({ x: out * 0.33, y: out * 0.22, w: out * 0.34, h: out * 0.4 });

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* ---------- Moving and zooming the photo in the card (pure) ---------- */

export interface Size {
  w: number;
  h: number;
}

/** Zoom in at most this much past the automatic framing. */
export const MAX_ZOOM = 3;

/**
 * The part of the image kept around the automatic crop (`margin` × its side on every side, inside
 * the image), so the photo can be moved and zoomed out later.
 */
export function extendBox(crop: Square, width: number, height: number, margin = 0.6): Box {
  const m = crop.size * margin;
  const x0 = Math.max(0, Math.floor(crop.x - m));
  const y0 = Math.max(0, Math.floor(crop.y - m));
  const x1 = Math.min(width, Math.ceil(crop.x + crop.size + m));
  const y1 = Math.min(height, Math.ceil(crop.y + crop.size + m));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The smallest frame allowed (the most zoom) for a picture whose automatic frame is `base`. */
export const minFrame = (base: Square) => base.size / MAX_ZOOM;

/** Keep a frame inside the picture: no bigger than its short side, no smaller than `min`. */
export function clampFrame(f: Square, pic: Size, min: number): Square {
  const size = clamp(f.size, Math.min(min, pic.w, pic.h), Math.min(pic.w, pic.h));
  // Zoom keeps the centre.
  const cx = f.x + f.size / 2;
  const cy = f.y + f.size / 2;
  return { x: clamp(cx - size / 2, 0, pic.w - size), y: clamp(cy - size / 2, 0, pic.h - size), size };
}

/** The photo moved by (`dx`, `dy`) shares of the frame's side (right/down positive). */
export function panFrame(f: Square, dx: number, dy: number, pic: Size, min: number): Square {
  return clampFrame({ x: f.x - dx * f.size, y: f.y - dy * f.size, size: f.size }, pic, min);
}

/** Zoom by `factor` (> 1 = closer) around the point (`ax`, `ay`) of the frame (0…1 shares). */
export function zoomFrame(f: Square, factor: number, pic: Size, min: number, ax = 0.5, ay = 0.5): Square {
  if (!(factor > 0)) return f;
  const size = clamp(f.size / factor, Math.min(min, pic.w, pic.h), Math.min(pic.w, pic.h));
  const px = f.x + ax * f.size;
  const py = f.y + ay * f.size;
  const next = { x: px - ax * size, y: py - ay * size, size };
  // clampFrame keeps the centre; the size is already in range.
  return clampFrame(next, pic, min);
}

/** How close a frame is compared with the automatic one (1 = as made, 2 = twice as close). */
export const zoomOf = (base: Square, f: Square) => base.size / f.size;

/** The frame with zoom `z` (relative to `base`), keeping its centre. */
export function withZoom(f: Square, base: Square, z: number, pic: Size): Square {
  const size = base.size / z;
  return clampFrame({ x: f.x + (f.size - size) / 2, y: f.y + (f.size - size) / 2, size }, pic, minFrame(base));
}

/** Where the whole picture lies when the frame fills a 1×1 slot (for drawing a preview). */
export function pictureBox(f: Square, pic: Size): Box {
  return { x: -f.x / f.size, y: -f.y / f.size, w: pic.w / f.size, h: pic.h / f.size };
}

export const sameFrame = (a: Square, b: Square) =>
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.size - b.size) < 0.5;
