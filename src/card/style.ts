/** The player card's look: shirt colours (a preset), pattern, number, and the metal tier. */

export type ShirtPattern = 'plain' | 'stripes' | 'halves' | 'sash';
export type CardPosition = 'def' | 'mid' | 'att' | 'gk';

export interface CardStyle {
  /** A preset id from SHIRTS. */
  shirt: string;
  pattern: ShirtPattern;
  /** 1–99. */
  number?: number;
}

export interface Shirt {
  id: string;
  name: string;
  /** Main colour, second colour. */
  colors: [string, string];
}

/** Generic colour combos (no club names). */
export const SHIRTS: Shirt[] = [
  { id: 'red', name: 'אדום', colors: ['#d7263d', '#ffffff'] },
  { id: 'blue', name: 'כחול', colors: ['#1d47b8', '#ffffff'] },
  { id: 'sky', name: 'תכלת', colors: ['#62b0ec', '#ffffff'] },
  { id: 'white', name: 'לבן', colors: ['#f3f2ec', '#c9ccd3'] },
  { id: 'black-white', name: 'שחור-לבן', colors: ['#18181a', '#f3f2ec'] },
  { id: 'red-blue', name: 'אדום-כחול', colors: ['#d7263d', '#1d47b8'] },
  { id: 'yellow-green', name: 'צהוב-ירוק', colors: ['#f5cd00', '#12924a'] },
  { id: 'green-white', name: 'ירוק-לבן', colors: ['#12924a', '#ffffff'] },
  { id: 'black-red', name: 'שחור-אדום', colors: ['#18181a', '#d7263d'] },
  { id: 'yellow-blue', name: 'צהוב-כחול', colors: ['#f5cd00', '#1d47b8'] },
  { id: 'orange-black', name: 'כתום-שחור', colors: ['#f2700d', '#18181a'] },
  { id: 'maroon-sky', name: 'בורדו-תכלת', colors: ['#7a1630', '#62b0ec'] },
];

export const PATTERNS: { id: ShirtPattern; name: string }[] = [
  { id: 'plain', name: 'חלק' },
  { id: 'stripes', name: 'פסים' },
  { id: 'halves', name: 'חצי-חצי' },
  { id: 'sash', name: 'אלכסון' },
];

export const POSITION_NAMES: Record<CardPosition, string> = { gk: 'שוער', def: 'הגנה', mid: 'קישור', att: 'התקפה' };

export const DEFAULT_STYLE: CardStyle = { shirt: 'red', pattern: 'plain' };

export const shirtOf = (id: string): Shirt => SHIRTS.find((s) => s.id === id) ?? SHIRTS[0];

/** Anything (stored JSON, a form) → a valid style. Unknown values fall back to the defaults. */
export function sanitizeStyle(raw: unknown): CardStyle {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const shirt = typeof o.shirt === 'string' && SHIRTS.some((s) => s.id === o.shirt) ? o.shirt : DEFAULT_STYLE.shirt;
  const pattern = PATTERNS.some((p) => p.id === o.pattern) ? (o.pattern as ShirtPattern) : DEFAULT_STYLE.pattern;
  const n = typeof o.number === 'string' && o.number.trim() !== '' ? Number(o.number) : o.number;
  const number = typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 99 ? n : undefined;
  return number === undefined ? { shirt, pattern } : { shirt, pattern, number };
}

export type Tier = 'gold' | 'silver' | 'bronze' | 'team';

/** Score 70–99 picks the metal; no score: the frame takes the shirt colour. */
export function tierOf(score?: number): Tier {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'team';
  if (score >= 85) return 'gold';
  if (score >= 78) return 'silver';
  return 'bronze';
}

/** Gradient stops (light → dark → light…) for the frame. */
export function metalStops(tier: Tier, shirt: Shirt): string[] {
  switch (tier) {
    case 'gold':
      return ['#fff4c9', '#e6c15b', '#9c6f17', '#f6d983', '#b98a2a', '#7a5410'];
    case 'silver':
      return ['#ffffff', '#d3d8de', '#7f8893', '#eef1f4', '#a7aeb7', '#5d646d'];
    case 'bronze':
      return ['#ffe3c6', '#d58f55', '#7f421c', '#eab07d', '#a9622f', '#5f2f12'];
    default: {
      const c = shirt.colors[0];
      return [mix(c, '#ffffff', 0.7), mix(c, '#ffffff', 0.2), mix(c, '#000000', 0.45), mix(c, '#ffffff', 0.5), c, mix(c, '#000000', 0.6)];
    }
  }
}

/** Ink on the metal (score, number badge). */
export const metalInk = (tier: Tier, shirt: Shirt): string =>
  tier === 'team' ? (luma(shirt.colors[0]) > 0.6 ? '#1b1c20' : '#ffffff') : tier === 'silver' ? '#23272d' : tier === 'gold' ? '#3d2a05' : '#3a1c08';

function hex(c: string): [number, number, number] {
  const v = c.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

/** Mix colour `a` toward `b` by `t` (0…1). */
export function mix(a: string, b: string, t: number): string {
  const x = hex(a);
  const y = hex(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** Relative brightness 0…1. */
export function luma(c: string): number {
  const [r, g, b] = hex(c);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
