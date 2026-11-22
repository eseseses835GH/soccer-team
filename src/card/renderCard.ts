/** The card as a PNG (for sharing): the SVG drawn on a canvas, the text drawn with the page's fonts. */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { FONT, PlayerCard, VIEW_H, VIEW_W, cardTexts, type PlayerCardProps } from './PlayerCard';

/** `width` px wide (default 900). */
export async function renderCardPng(props: PlayerCardProps, width = 900): Promise<Blob> {
  const [cutout, portrait] = await Promise.all([inline(props.cutout), inline(props.portrait)]);
  const p = { ...props, cutout, portrait };
  const host = document.createElement('div');
  const root = createRoot(host);
  flushSync(() => root.render(createElement(PlayerCard, { ...p, textless: true, size: VIEW_W })));
  const svg = host.innerHTML;
  root.unmount();

  const k = width / VIEW_W;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round(VIEW_H * k);
  const ctx = canvas.getContext('2d')!;
  const img = await loadSvg(svg);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const texts = cardTexts(p);
  await Promise.all([...new Set(texts.map((t) => `${t.weight} ${Math.round(t.size * k)}px Heebo`))].map((f) => document.fonts?.load(f).catch(() => null)));
  ctx.textAlign = 'center';
  ctx.direction = 'rtl';
  for (const t of texts) {
    ctx.save();
    ctx.font = `${t.weight} ${t.size * k}px ${FONT}`;
    if ('letterSpacing' in ctx && t.spacing) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${t.spacing * k}px`;
    ctx.globalAlpha = t.opacity ?? 1;
    if (t.shadow || t.outline) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = (t.outline ? 2.2 : 3) * k;
      ctx.strokeStyle = t.outline ?? 'rgba(0,0,0,0.45)';
      ctx.strokeText(t.text, t.x * k, t.y * k);
    }
    ctx.fillStyle = t.fill;
    ctx.fillText(t.text, t.x * k, t.y * k);
    ctx.restore();
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png'));
}

/** blob:/http URLs → data URLs (an SVG drawn as an image can't load anything). */
async function inline(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function loadSvg(markup: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('svg'));
    };
    img.src = url;
  });
}
