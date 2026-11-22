/**
 * A phone photo → a card-ready portrait: face-centred head-and-shoulders square, auto-enhanced,
 * plus the same framing with the background removed. All in the browser (canvas + MediaPipe).
 */
import { centerFace, cropBox, mapBox, type Box } from './crop';
import { applyEnhance, enhanceParams, featherMask, measure } from './enhance';
import { loadVision, type Vision } from './vision';

export const OUT = 512;
/** Work on at most this many pixels per side (memory on phones, model speed). */
const WORK = 1600;
const MAX_PORTRAIT = 120_000;
/** Give up on the models after this long (slow network): the enhanced crop is used alone. */
const MODEL_TIMEOUT = 25_000;

export interface Processed {
  /** Square 512, face-centred, enhanced (WebP; JPEG where WebP can't be encoded). */
  portrait: Blob;
  /** Same framing, transparent background (WebP or PNG); null when the models couldn't load. */
  cutout: Blob | null;
  /** A face was found (false: centre crop). */
  face: boolean;
}

export interface ProcessOptions {
  /** false: skip the models (offline, tests). */
  models?: boolean;
}

export async function processPhoto(file: File | Blob, opts: ProcessOptions = {}): Promise<Processed> {
  const src = await decode(file);
  const vision = opts.models === false ? null : await withTimeout(loadVision(), MODEL_TIMEOUT).catch(() => null);

  let faceBox: Box | null = null;
  if (vision) faceBox = safe(() => vision.face(src));
  const crop = cropBox(src.width, src.height, faceBox);
  const canvas = makeCanvas(OUT);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, crop.x, crop.y, crop.size, crop.size, 0, 0, OUT, OUT);

  const face = faceBox ? mapBox(faceBox, crop, OUT) : centerFace(OUT);
  const img = ctx.getImageData(0, 0, OUT, OUT);
  const whole = measure(img.data, OUT, OUT, { x: 0, y: 0, w: OUT, h: OUT });
  applyEnhance(img.data, OUT, OUT, enhanceParams(measure(img.data, OUT, OUT, face), OUT / crop.size, whole));
  ctx.putImageData(img, 0, 0);
  const portrait = await encodeSmall(canvas);

  const cutout = vision ? await cutoutOf(vision, canvas, img, face) : null;
  return { portrait, cutout, face: !!faceBox };
}

async function cutoutOf(vision: Vision, canvas: HTMLCanvasElement, img: ImageData, face: Box): Promise<Blob | null> {
  const conf = safe(() => vision.person(canvas));
  if (!conf) return null;
  const alpha = featherMask(conf, OUT, OUT, face);
  let any = 0;
  const out = new ImageData(new Uint8ClampedArray(img.data), OUT, OUT);
  for (let j = 0, i = 3; j < alpha.length; j++, i += 4) {
    out.data[i] = alpha[j];
    any += alpha[j] > 128 ? 1 : 0;
  }
  // Nobody found (a photo of a wall): no cutout rather than an empty picture.
  if (any < OUT * OUT * 0.03) return null;
  const c = makeCanvas(OUT);
  c.getContext('2d')!.putImageData(out, 0, 0);
  const webp = await toBlob(c, 'image/webp', 0.86);
  return webp?.type === 'image/webp' ? webp : toBlob(c, 'image/png');
}

/** WebP under ~120KB (lower quality until it fits); JPEG where the browser can't write WebP. */
async function encodeSmall(c: HTMLCanvasElement): Promise<Blob> {
  for (const q of [0.86, 0.78, 0.68, 0.56]) {
    const b = await toBlob(c, 'image/webp', q);
    if (!b) break;
    if (b.type !== 'image/webp') {
      const j = await toBlob(c, 'image/jpeg', q);
      if (j && (j.size <= MAX_PORTRAIT || q === 0.56)) return j;
      continue;
    }
    if (b.size <= MAX_PORTRAIT || q === 0.56) return b;
  }
  const last = await toBlob(c, 'image/jpeg', 0.6);
  if (!last) throw new Error('encode');
  return last;
}

/** Decode with the photo's orientation, scaled down to WORK px per side. */
async function decode(file: Blob): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap | HTMLImageElement;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bmp = await loadImage(file);
  }
  const w = bmp.width;
  const h = bmp.height;
  if (!w || !h) throw new Error('not an image');
  const k = Math.min(1, WORK / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  if ('close' in bmp) bmp.close();
  return c;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('not an image'));
    };
    img.src = url;
  });
}

function makeCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, q));

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
