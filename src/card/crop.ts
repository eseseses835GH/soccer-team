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
