/**
 * A phone photo → a card-ready portrait: face-centred head-and-shoulders square, auto-enhanced,
 * plus the same framing with the background removed. All in the browser (canvas + MediaPipe).
 */
import { centerFace, cropBox, extendBox, type Box, type Square } from './crop';
import { applyEnhance, enhanceParams, featherMask, measure } from './enhance';
import { loadVision, type Vision } from './vision';

export const OUT = 512;
/** Work on at most this many pixels per side (memory on phones, model speed). */
const WORK = 1600;
const MAX_PORTRAIT = 120_000;
const MAX_CUTOUT = 450_000;
/** Give up on the models after this long (slow network): the enhanced crop is used alone. */
const MODEL_TIMEOUT = 25_000;

export interface Processed {
  /** Square 512, face-centred, enhanced (WebP; JPEG where WebP can't be encoded). */
  portrait: Blob;
  /** Same framing, transparent background (WebP or PNG); null when the models couldn't load. */
  cutout: Blob | null;
  /** A face was found (false: centre crop). */
  face: boolean;
  /** The enhanced picture around the framing, kept in memory so the photo can be moved (`renderFramed`). */
  source: Source;
}

export interface Source {
  /** Enhanced, a wider area than the frame. */
  portrait: HTMLCanvasElement;
  /** The same with the background removed; null without the models. */
  cutout: HTMLCanvasElement | null;
  /** The automatic frame, in the source's pixels. */
  base: Square;
}

export interface ProcessOptions {
  /** false: skip the models (offline, tests). */
  models?: boolean;
}

/** Pixels the automatic frame gets in the source (room to zoom in), and the source's longest side. */
const FRAME_PX = 640;
const SOURCE_MAX = 1400;

export async function processPhoto(file: File | Blob, opts: ProcessOptions = {}): Promise<Processed> {
  const src = await decode(file);
  const vision = opts.models === false ? null : await withTimeout(loadVision(), MODEL_TIMEOUT).catch(() => null);

  let faceBox: Box | null = null;
  if (vision) faceBox = safe(() => vision.face(src));
  const crop = cropBox(src.width, src.height, faceBox);

  // A wider area around the crop, enhanced and cut out once; any frame inside it is drawn from it.
  const area = extendBox(crop, src.width, src.height);
  const k = Math.min(FRAME_PX / crop.size, SOURCE_MAX / Math.max(area.w, area.h));
  const W = Math.max(1, Math.round(area.w * k));
  const H = Math.max(1, Math.round(area.h * k));
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, area.x, area.y, area.w, area.h, 0, 0, W, H);
  const base: Square = { x: (crop.x - area.x) * k, y: (crop.y - area.y) * k, size: crop.size * k };

  const face = faceBox
    ? { x: (faceBox.x - area.x) * k, y: (faceBox.y - area.y) * k, w: faceBox.w * k, h: faceBox.h * k }
    : offsetBox(centerFace(base.size), base);
  const img = ctx.getImageData(0, 0, W, H);
  const whole = measure(img.data, W, H, { x: base.x, y: base.y, w: base.size, h: base.size });
  applyEnhance(img.data, W, H, enhanceParams(measure(img.data, W, H, face), OUT / crop.size, whole));
  ctx.putImageData(img, 0, 0);

  const cut = vision ? cutoutSource(vision, canvas, img, face, base) : null;
  const source: Source = { portrait: canvas, cutout: cut, base };
  const out = await renderFramed(source, base);
  return { ...out, face: !!faceBox, source };
}

/** The portrait and cutout files for a frame of the source (512 square each). */
export async function renderFramed(source: Source, frame: Square): Promise<{ portrait: Blob; cutout: Blob | null }> {
  const portrait = await encodeSmall(drawFrame(source.portrait, frame));
  const cutout = source.cutout ? await encodeCutout(drawFrame(source.cutout, frame)) : null;
  return { portrait, cutout };
}

/** A smaller copy of a source picture for the live preview (object URL). */
export async function previewUrl(c: HTMLCanvasElement, max = 800): Promise<string | null> {
  const k = Math.min(1, max / Math.max(c.width, c.height));
  const s = makeCanvas(Math.round(c.width * k), Math.round(c.height * k));
  const sx = s.getContext('2d')!;
  sx.imageSmoothingQuality = 'high';
  sx.drawImage(c, 0, 0, s.width, s.height);
  const b = (await toBlob(s, 'image/webp', 0.85)) ?? (await toBlob(s, 'image/png'));
  return b ? URL.createObjectURL(b) : null;
}

function drawFrame(from: HTMLCanvasElement, f: Square): HTMLCanvasElement {
  const c = makeCanvas(OUT);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(from, f.x, f.y, f.size, f.size, 0, 0, OUT, OUT);
  return c;
}

const offsetBox = (b: Box, by: Square): Box => ({ x: b.x + by.x, y: b.y + by.y, w: b.w, h: b.h });

function cutoutSource(vision: Vision, canvas: HTMLCanvasElement, img: ImageData, face: Box, base: Square): HTMLCanvasElement | null {
  const conf = safe(() => vision.person(canvas));
  if (!conf) return null;
  const { width: W, height: H } = canvas;
  const alpha = featherMask(conf, W, H, face);
  const out = new ImageData(new Uint8ClampedArray(img.data), W, H);
  for (let j = 0, i = 3; j < alpha.length; j++, i += 4) out.data[i] = alpha[j];
  // Nobody found in the frame (a photo of a wall): no cutout rather than an empty picture.
  let any = 0;
  const x0 = Math.max(0, Math.floor(base.x));
  const y0 = Math.max(0, Math.floor(base.y));
  const x1 = Math.min(W, Math.ceil(base.x + base.size));
  const y1 = Math.min(H, Math.ceil(base.y + base.size));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) any += alpha[y * W + x] > 128 ? 1 : 0;
  if (any < (x1 - x0) * (y1 - y0) * 0.03) return null;
  const c = makeCanvas(W, H);
  c.getContext('2d')!.putImageData(out, 0, 0);
  return c;
}

async function encodeCutout(c: HTMLCanvasElement): Promise<Blob | null> {
  const webp = await toBlob(c, 'image/webp', 0.86);
  if (webp?.type === 'image/webp') return webp;
  // Safari writes no WebP: PNG, smaller when it would pass the bucket's 500 KB.
  const png = await toBlob(c, 'image/png');
  if (!png || png.size <= MAX_CUTOUT) return png;
  const s = makeCanvas(384);
  const sx = s.getContext('2d')!;
  sx.imageSmoothingQuality = 'high';
  sx.drawImage(c, 0, 0, 384, 384);
  const small = await toBlob(s, 'image/png');
  return small && small.size <= MAX_CUTOUT ? small : null;
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

function makeCanvas(w: number, h = w): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
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
