/**
 * MediaPipe Tasks Vision (Apache-2.0), loaded only when a photo is taken: this module is imported
 * dynamically, and it pulls the library, its wasm and the two small models from pinned URLs.
 * Everything runs on the phone; the photo never leaves it.
 */
import type { FaceDetector, ImageSegmenter } from '@mediapipe/tasks-vision';
import type { Box } from './crop';

/** Must match package.json (a unit test checks). */
export const TASKS_VISION_VERSION = '1.2.2';
export const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
export const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
export const SEGMENT_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite';

export interface Vision {
  /** The most prominent face (pixels of `img`), or null. */
  face(img: HTMLCanvasElement): Box | null;
  /** Person confidence per pixel, at the canvas's size, or null. */
  person(img: HTMLCanvasElement): Float32Array | null;
}

let loading: Promise<Vision> | null = null;

/** Load once; a failure (offline) is forgotten so the next photo tries again. */
export function loadVision(): Promise<Vision> {
  loading ??= load().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

async function load(): Promise<Vision> {
  const mp = await import('@mediapipe/tasks-vision');
  const files = await mp.FilesetResolver.forVisionTasks(WASM_BASE);
  const [fd, seg] = await Promise.all([
    mp.FaceDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.5,
    }),
    mp.ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: SEGMENT_MODEL, delegate: 'CPU' },
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    }),
  ]);
  return { face: (img) => bestFace(fd, img), person: (img) => personMask(seg, img) };
}

function bestFace(fd: FaceDetector, img: HTMLCanvasElement): Box | null {
  const { detections } = fd.detect(img);
  let best: Box | null = null;
  let bestScore = 0;
  for (const d of detections) {
    const b = d.boundingBox;
    if (!b) continue;
    // Big and confident wins (the player, not someone in the back).
    const s = b.width * b.height * (d.categories[0]?.score ?? 0.5);
    if (s > bestScore) {
      bestScore = s;
      best = { x: b.originX, y: b.originY, w: b.width, h: b.height };
    }
  }
  return best;
}

function personMask(seg: ImageSegmenter, img: HTMLCanvasElement): Float32Array | null {
  const res = seg.segment(img);
  try {
    const m = res.confidenceMasks?.[res.confidenceMasks.length - 1];
    if (!m) return null;
    const a = m.getAsFloat32Array();
    if (m.width === img.width && m.height === img.height) return new Float32Array(a);
    return resize(a, m.width, m.height, img.width, img.height);
  } finally {
    res.close();
  }
}

/** Bilinear resize of a one-channel mask. */
function resize(a: Float32Array, w: number, h: number, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, ((y + 0.5) * h) / H - 0.5);
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(h - 1, y0 + 1);
    const ty = Math.max(0, fy - y0);
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1, ((x + 0.5) * w) / W - 0.5);
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(w - 1, x0 + 1);
      const tx = Math.max(0, fx - x0);
      const top = a[y0 * w + x0] * (1 - tx) + a[y0 * w + x1] * tx;
      const bot = a[y1 * w + x0] * (1 - tx) + a[y1 * w + x1] * tx;
      out[y * W + x] = top * (1 - ty) + bot * ty;
    }
  }
  return out;
}
