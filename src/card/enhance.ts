/**
 * Auto-enhance and mask maths on raw RGBA pixels (pure, no DOM): measure the face, derive
 * levels / gamma / white balance / saturation / sharpening, apply them; soften a person mask.
 */
import type { Box } from './crop';

export interface Stats {
  /** Luminance histogram (256 bins). */
  hist: Uint32Array;
  count: number;
  /** Mean R, G, B (0–255). */
  mean: [number, number, number];
  /** Mean chroma (max − min) / 255. */
  chroma: number;
}

export interface Params {
  black: number;
  white: number;
  gamma: number;
  /** Per-channel gains (white balance), applied first. */
  gain: [number, number, number];
  saturation: number;
  sharpen: number;
}

export const IDENTITY: Params = { black: 0, white: 255, gamma: 1, gain: [1, 1, 1], saturation: 1, sharpen: 0 };

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Measure the pixels of `box` (clipped to the image). */
export function measure(data: Uint8ClampedArray, width: number, height: number, box: Box): Stats {
  const x0 = clamp(Math.floor(box.x), 0, width - 1);
  const y0 = clamp(Math.floor(box.y), 0, height - 1);
  const x1 = clamp(Math.ceil(box.x + box.w), x0 + 1, width);
  const y1 = clamp(Math.ceil(box.y + box.h), y0 + 1, height);
  const hist = new Uint32Array(256);
  let r = 0;
  let g = 0;
  let b = 0;
  let c = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const R = data[i];
      const G = data[i + 1];
      const B = data[i + 2];
      hist[Math.round(lum(R, G, B))]++;
      r += R;
      g += G;
      b += B;
      c += Math.max(R, G, B) - Math.min(R, G, B);
      n++;
    }
  }
  return { hist, count: n, mean: [r / n, g / n, b / n], chroma: c / n / 255 };
}

/** The luminance value below which `p` (0…1) of the pixels fall. */
export function percentile(hist: Uint32Array, count: number, p: number): number {
  const target = count * p;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

/** Mean luminance of a histogram. */
export function meanOf(hist: Uint32Array, count: number): number {
  let s = 0;
  for (let v = 0; v < 256; v++) s += v * hist[v];
  return count ? s / count : 0;
}

/** Skin seen under neutral light, relative to green (R/G, B/G): the white balance aims a little toward it. */
const SKIN_RG = 1.22;
const SKIN_BG = 0.86;

/**
 * Enhancement parameters. Levels (black / white point) from the whole picture `all`, brightness
 * (gamma) and colour from the face `s`. Gentle on purpose: a well-lit face gets almost nothing, a
 * dark / backlit one is lifted toward the mid tones. `upscale` > 1 when the crop was enlarged
 * (more sharpening).
 */
export function enhanceParams(s: Stats, upscale = 1, all: Stats = s): Params {
  if (!s.count || !all.count) return IDENTITY;
  const lo = percentile(all.hist, all.count, 0.01);
  const hi = percentile(all.hist, all.count, 0.99);
  // Levels: pull a raised black down and a low white up, partly (never clip hard).
  const black = lo > 4 ? Math.min(lo * 0.75, 40) : 0;
  const white = hi < 250 ? Math.max(hi + (255 - hi) * 0.25, 150) : 255;
  // Gamma: a face darker than 0.4 (after the levels) moves most of the way to 0.46, a glaring one
  // above 0.68 a little down; in between it is left alone.
  const m = clamp((meanOf(s.hist, s.count) - black) / (white - black), 0.02, 0.98);
  const target = m < 0.4 ? m + (0.46 - m) * 0.65 : m > 0.68 ? m - (m - 0.62) * 0.5 : m;
  const gamma = clamp(Math.log(target) / Math.log(m), 0.5, 1.3);
  // White balance: nudge the face's colour ratios toward neutral-light skin, mildly.
  const [r, g, b] = s.mean.map((v) => Math.max(v, 1));
  let gr = clamp((SKIN_RG / (r / g)) ** 0.35, 0.88, 1.14);
  let gb = clamp((SKIN_BG / (b / g)) ** 0.35, 0.88, 1.14);
  // Keep the brightness: scale all three so the face's luminance doesn't move.
  const k = lum(r, g, b) / lum(r * gr, g, b * gb);
  gr *= k;
  gb *= k;
  const gain: [number, number, number] = [gr, k, gb];
  const saturation = s.chroma < 0.1 ? 1.16 : s.chroma < 0.22 ? 1.1 : s.chroma < 0.32 ? 1.04 : 1;
  // A strongly lifted (dark) photo is noisy: sharpen less so the grain doesn't grow.
  const sharpen = clamp(0.35 + (upscale - 1) * 0.25, 0.35, 0.8) * (gamma < 0.8 ? 0.5 : 1);
  return { black, white, gamma, gain, saturation, sharpen };
}

/** One lookup table per channel: gain → levels → gamma. */
export function luts(p: Params): [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] {
  const span = Math.max(1, p.white - p.black);
  return p.gain.map((gain) => {
    const t = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      const x = clamp((v * gain - p.black) / span, 0, 1);
      t[v] = Math.round(255 * x ** p.gamma);
    }
    return t;
  }) as [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray];
}

/** Apply `p` in place (RGBA). */
export function applyEnhance(data: Uint8ClampedArray, width: number, height: number, p: Params): void {
  const [lr, lg, lb] = luts(p);
  const n = width * height;
  const L = new Float32Array(n);
  for (let j = 0, i = 0; j < n; j++, i += 4) {
    let r = lr[data[i]];
    let g = lg[data[i + 1]];
    let b = lb[data[i + 2]];
    const y = lum(r, g, b);
    if (p.saturation !== 1) {
      r = y + (r - y) * p.saturation;
      g = y + (g - y) * p.saturation;
      b = y + (b - y) * p.saturation;
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    L[j] = y;
  }
  if (p.sharpen <= 0) return;
  // Unsharp mask on luminance: add back the detail lost by a small blur (same to all channels: no colour fringes).
  const blur = boxBlur(boxBlur(L, width, height, 1), width, height, 1);
  for (let j = 0, i = 0; j < n; j++, i += 4) {
    const d = clamp((L[j] - blur[j]) * p.sharpen, -24, 24);
    data[i] += d;
    data[i + 1] += d;
    data[i + 2] += d;
  }
}

/** Separable box blur of radius `r` (edges clamp). */
export function boxBlur(src: Float32Array, width: number, height: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const k = 2 * r + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += src[row + clamp(x + d, 0, width - 1)];
      tmp[row + x] = s / k;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += tmp[clamp(y + d, 0, height - 1) * width + x];
      out[y * width + x] = s / k;
    }
  }
  return out;
}

const smooth = (e0: number, e1: number, v: number) => {
  const t = clamp((v - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * The person's confidence (0…1 per pixel) → alpha 0…255 with a soft (feathered) edge. If the mask
 * comes the other way round (higher outside the face than on it), it's flipped.
 */
export function featherMask(conf: Float32Array, width: number, height: number, face: Box): Uint8ClampedArray {
  const inner = meanIn(conf, width, height, { x: face.x + face.w * 0.25, y: face.y + face.h * 0.25, w: face.w * 0.5, h: face.h * 0.5 });
  const border = meanBorder(conf, width, height);
  const flip = inner < border;
  const hard = new Float32Array(conf.length);
  for (let i = 0; i < conf.length; i++) hard[i] = smooth(0.3, 0.7, flip ? 1 - conf[i] : conf[i]);
  const r = Math.max(1, Math.round(width / 256));
  const soft = boxBlur(boxBlur(hard, width, height, r), width, height, r);
  const out = new Uint8ClampedArray(conf.length);
  // A slight squeeze after the blur: soft edge, but no wide halo of background.
  for (let i = 0; i < conf.length; i++) out[i] = Math.round(255 * smooth(0.12, 0.88, soft[i]));
  return out;
}

function meanIn(a: Float32Array, width: number, height: number, b: Box): number {
  const x0 = clamp(Math.floor(b.x), 0, width - 1);
  const y0 = clamp(Math.floor(b.y), 0, height - 1);
  const x1 = clamp(Math.ceil(b.x + b.w), x0 + 1, width);
  const y1 = clamp(Math.ceil(b.y + b.h), y0 + 1, height);
  let s = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += a[y * width + x];
  return s / ((x1 - x0) * (y1 - y0));
}

/** Mean along the top and side edges (the bottom is usually the body). */
function meanBorder(a: Float32Array, width: number, height: number): number {
  let s = 0;
  let n = 0;
  for (let x = 0; x < width; x++) {
    s += a[x];
    n++;
  }
  for (let y = 0; y < height * 0.6; y++) {
    s += a[y * width] + a[y * width + width - 1];
    n += 2;
  }
  return s / n;
}
