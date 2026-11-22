// Turn a picked/taken picture into the small square the bucket takes (≤ 300 KB webp).
// For now: center-square crop, 256 px. The card maker replaces this with smarter processing;
// keep the whole step behind preparePhoto().

export const PHOTO_SIZE = 256;

async function decode(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall back to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function preparePhoto(file: Blob): Promise<Blob> {
  const img = await decode(file);
  const side = Math.min(img.width, img.height);
  if (!side) throw new Error('empty image');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PHOTO_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  for (const q of [0.85, 0.7, 0.5]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', q));
    // Safari before 17 has no webp encoder (it gives a png): the bucket takes webp/jpeg only.
    if (blob && blob.type === 'image/webp' && blob.size <= 300 * 1024) return blob;
    if (blob && blob.type !== 'image/webp') break;
  }
  const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
  if (!jpeg) throw new Error('encode failed');
  return jpeg;
}
