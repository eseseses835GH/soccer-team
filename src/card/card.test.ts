import pkgSource from '../../package.json?raw';
import { describe, expect, it } from 'vitest';
import { FACE_SHARE, FACE_TOP, cropBox, mapBox } from './crop';
import { applyEnhance, enhanceParams, featherMask, measure, type Stats } from './enhance';
import { SHIRTS, sanitizeStyle, tierOf } from './style';
import { FACE_MODEL, SEGMENT_MODEL, TASKS_VISION_VERSION, WASM_BASE } from './vision';

/** Stats of a flat patch: every pixel `rgb` (plus a spread of ±`spread` in luminance). */
function stats(rgb: [number, number, number], spread = 20): Stats {
  const n = 1000;
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const d = Math.round(((i % 41) / 40 - 0.5) * 2 * spread);
    data.set([rgb[0] + d, rgb[1] + d, rgb[2] + d, 255], i * 4);
  }
  return measure(data, n, 1, { x: 0, y: 0, w: n, h: 1 });
}
const lumOf = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
/** The patch's mean luminance after the enhancement. */
function after(rgb: [number, number, number], spread = 20) {
  const n = 41;
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const d = Math.round((i / 40 - 0.5) * 2 * spread);
    data.set([rgb[0] + d, rgb[1] + d, rgb[2] + d, 255], i * 4);
  }
  const p = enhanceParams(stats(rgb, spread));
  applyEnhance(data, n, 1, { ...p, sharpen: 0 });
  let s = 0;
  for (let i = 0; i < n; i++) s += lumOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  return { mean: s / n, p };
}

describe('crop box from a face', () => {
  it('head and shoulders: the face takes about a third, centred, a little above the middle', () => {
    const face = { x: 900, y: 600, w: 300, h: 340 };
    const c = cropBox(2000, 3000, face);
    expect(c.size).toBeCloseTo(300 / FACE_SHARE, -1);
    expect(c.x + c.size / 2).toBeCloseTo(1050, -1);
    expect(c.y + c.size * FACE_TOP).toBeCloseTo(770, -1);
    const m = mapBox(face, c, 512);
    expect(m.x + m.w / 2).toBeCloseTo(256, 0);
  });
  it('stays inside the image (face near an edge, face too big)', () => {
    const c = cropBox(1000, 800, { x: 10, y: 5, w: 200, h: 220 });
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    const big = cropBox(600, 900, { x: 50, y: 100, w: 500, h: 560 });
    expect(big.size).toBe(600);
    expect(big.x).toBe(0);
    expect(big.y + big.size).toBeLessThanOrEqual(900);
  });
  it('no face: centre crop; a tall photo leans up', () => {
    expect(cropBox(1200, 800, null)).toEqual({ x: 200, y: 0, size: 800 });
    expect(cropBox(800, 1200, undefined)).toEqual({ x: 0, y: 100, size: 800 });
  });
});

describe('enhancement parameters from the histogram', () => {
  it('a dark (backlit) face is lifted toward the mid tones', () => {
    const { mean, p } = after([60, 45, 38]);
    expect(p.gamma).toBeLessThan(0.95);
    expect(mean).toBeGreaterThan(lumOf(60, 45, 38) + 25);
  });
  it('a well-lit face is left nearly alone', () => {
    const rgb: [number, number, number] = [200, 150, 125];
    const { mean, p } = after(rgb, 50);
    expect(Math.abs(p.gamma - 1)).toBeLessThan(0.15);
    expect(Math.abs(mean - lumOf(...rgb))).toBeLessThan(14);
    expect(p.saturation).toBeLessThanOrEqual(1.1);
  });
  it('a flat, washed-out picture gets its levels stretched', () => {
    const p = enhanceParams(stats([170, 160, 150], 15), 1, stats([160, 160, 160], 40));
    expect(p.black).toBeGreaterThan(20);
    expect(p.white).toBeLessThan(255);
  });
  it('white balance: an orange cast is cooled, a blue cast warmed, mildly', () => {
    const warm = enhanceParams(stats([200, 120, 60]));
    expect(warm.gain[0]).toBeLessThan(warm.gain[2]);
    const cold = enhanceParams(stats([120, 130, 150]));
    expect(cold.gain[0]).toBeGreaterThan(cold.gain[2]);
    for (const g of [...warm.gain, ...cold.gain]) expect(Math.abs(g - 1)).toBeLessThan(0.25);
  });
  it('a dull face gets more saturation; an enlarged crop more sharpening', () => {
    expect(enhanceParams(stats([128, 125, 122])).saturation).toBeGreaterThan(enhanceParams(stats([210, 120, 70])).saturation);
    expect(enhanceParams(stats([128, 125, 122]), 3).sharpen).toBeGreaterThan(enhanceParams(stats([128, 125, 122]), 1).sharpen);
  });
});

describe('mask feather', () => {
  const W = 64;
  const face = { x: 24, y: 16, w: 16, h: 18 };
  const disk = (inside: number, outside: number) => {
    const a = new Float32Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) a[y * W + x] = (x - 32) ** 2 + (y - 32) ** 2 < 20 ** 2 ? inside : outside;
    return a;
  };
  it('solid inside, clear outside, soft at the edge', () => {
    const m = featherMask(disk(0.95, 0.02), W, W, face);
    expect(m[32 * W + 32]).toBe(255);
    expect(m[2 * W + 2]).toBe(0);
    const edge = Array.from({ length: 10 }, (_, k) => m[32 * W + 7 + k]);
    expect(edge.some((v) => v > 10 && v < 245)).toBe(true);
  });
  it('a mask that comes inverted is flipped', () => {
    const m = featherMask(disk(0.02, 0.95), W, W, face);
    expect(m[32 * W + 32]).toBe(255);
    expect(m[2 * W + 2]).toBe(0);
  });
});

describe('card style', () => {
  it('sanitize: known shirt / pattern, number 1–99 only', () => {
    expect(sanitizeStyle({ shirt: 'sky', pattern: 'halves', number: 7 })).toEqual({ shirt: 'sky', pattern: 'halves', number: 7 });
    expect(sanitizeStyle({ shirt: 'barcelona', pattern: 'zigzag', number: 100 })).toEqual({ shirt: 'red', pattern: 'plain' });
    expect(sanitizeStyle({ shirt: 'white', pattern: 'sash', number: '23' })).toEqual({ shirt: 'white', pattern: 'sash', number: 23 });
    expect(sanitizeStyle({ number: 0 })).toEqual({ shirt: 'red', pattern: 'plain' });
    expect(sanitizeStyle({ number: 4.5 }).number).toBeUndefined();
    expect(sanitizeStyle(null)).toEqual({ shirt: 'red', pattern: 'plain' });
    expect(sanitizeStyle('x')).toEqual({ shirt: 'red', pattern: 'plain' });
  });
  it('12 generic presets with unique ids', () => {
    expect(SHIRTS).toHaveLength(12);
    expect(new Set(SHIRTS.map((s) => s.id)).size).toBe(12);
  });
  it('tier by score; no score → the shirt-coloured frame', () => {
    expect(tierOf(92)).toBe('gold');
    expect(tierOf(85)).toBe('gold');
    expect(tierOf(80)).toBe('silver');
    expect(tierOf(70)).toBe('bronze');
    expect(tierOf()).toBe('team');
    expect(tierOf(NaN)).toBe('team');
  });
});

describe('model URLs', () => {
  it('pinned: the wasm version matches package.json; models at fixed versions', () => {
    const pkg = JSON.parse(pkgSource);
    expect(pkg.dependencies['@mediapipe/tasks-vision']).toBe(TASKS_VISION_VERSION);
    expect(WASM_BASE).toContain(`@${TASKS_VISION_VERSION}/`);
    for (const u of [FACE_MODEL, SEGMENT_MODEL]) {
      expect(u).toMatch(/^https:\/\/storage\.googleapis\.com\/mediapipe-models\/.+\/\d+\/[^/]+\.tflite$/);
      expect(u).not.toContain('latest');
    }
  });
});
