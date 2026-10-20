/** The teams as a PNG for the group chat: a coloured card per team, names only, always light. */

export interface ImageTeam {
  name: string;
  /** "בחוץ" / "בתור #2", or nothing for the two that start. */
  sub?: string;
  /** CSS colour of the team (`var(--bib-blue)` or a hex). */
  color: string;
  names: string[];
  /** The first name starts in goal. */
  keeper?: boolean;
}

export interface ImageInput {
  teams: ImageTeam[];
  subs?: string[];
}

export type Measure = (text: string, font: string) => number;

const FAMILY = "Heebo, system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";
export const FONTS = {
  team: `800 46px ${FAMILY}`,
  sub: `500 28px ${FAMILY}`,
  name: `500 40px ${FAMILY}`,
  label: `600 30px ${FAMILY}`,
  footer: `600 28px ${FAMILY}`,
};

export const W = 1080;
const PAD = 48;
const GAP = 24;
const HEAD = 104;
const HEAD_SUB = 132;
const INSET = 28;
const LINE = 54;
const ROW_GAP = 10;

/** Light-theme bib colours (the image ignores the phone's theme). */
const BIB_HEX: Record<string, string> = {
  red: '#e0362c',
  blue: '#2468e0',
  yellow: '#f2c200',
  green: '#17a34a',
  orange: '#f2780c',
  white: '#d9d8d0',
  black: '#2b2b28',
  purple: '#8a4fd8',
  none: '#9a9a92',
};

export function hexOf(color: string): string {
  const m = /--bib-(\w+)/.exec(color);
  return m ? (BIB_HEX[m[1]] ?? BIB_HEX.none) : color;
}

/** Dark ink on light colours (yellow, white), white on the rest. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.4 ? '#151613' : '#ffffff';
}

/** Greedy word wrap; a word longer than the line is broken by characters. */
export function wrapText(text: string, max: number, font: string, measure: Measure): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (measure(next, font) <= max) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    cur = '';
    let part = '';
    for (const ch of Array.from(word)) {
      if (part && measure(part + ch, font) > max) {
        lines.push(part);
        part = '';
      }
      part += ch;
    }
    cur = part;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

export interface CardLayout {
  team: ImageTeam;
  x: number;
  y: number;
  w: number;
  h: number;
  head: number;
  /** Each player's wrapped lines, top y of the first line. */
  rows: { lines: string[]; y: number }[];
}

export interface ImageLayout {
  width: number;
  height: number;
  cards: CardLayout[];
  subs: { y: number; lines: string[] } | null;
  footerY: number;
}

/** Up to three teams side by side, more in rows of two; team 1 on the right (RTL). */
export function layoutImage({ teams, subs = [] }: ImageInput, measure: Measure): ImageLayout {
  const cols = teams.length <= 3 ? Math.max(1, teams.length) : 2;
  const cw = (W - 2 * PAD - (cols - 1) * GAP) / cols;
  const head = teams.some((t) => t.sub) ? HEAD_SUB : HEAD;
  const cards: CardLayout[] = [];
  let y = PAD;
  for (let start = 0; start < teams.length; start += cols) {
    const row = teams.slice(start, start + cols).map((team, c) => {
      let ry = y + head + INSET - 6;
      const rows = team.names.map((n, j) => {
        const lines = wrapText(j === 0 && team.keeper ? `🧤 ${n}` : n, cw - 2 * INSET, FONTS.name, measure);
        const r = { lines, y: ry };
        ry += lines.length * LINE + ROW_GAP;
        return r;
      });
      return { team, x: W - PAD - (c + 1) * cw - c * GAP, y, w: cw, h: ry - y + INSET - ROW_GAP, head, rows };
    });
    const h = Math.max(...row.map((r) => r.h));
    row.forEach((r) => (r.h = h));
    cards.push(...row);
    y += h + GAP;
  }
  y += 8;
  let subsBlock: ImageLayout['subs'] = null;
  if (subs.length) {
    subsBlock = { y, lines: wrapText(`מחליפים: ${subs.join(', ')}`, W - 2 * PAD, FONTS.name, measure) };
    y += subsBlock.lines.length * LINE + 24;
  }
  const footerY = y + 12;
  return { width: W, height: Math.ceil(footerY + 28 + PAD), cards, subs: subsBlock, footerY };
}

function fontsReady(): Promise<unknown> {
  const f = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!f?.load) return Promise.resolve();
  const loads = Promise.all(Object.values(FONTS).map((x) => f.load(x, 'אב').catch(() => null)));
  return Promise.race([loads, new Promise((r) => setTimeout(r, 1500))]);
}

/** Draws the teams and returns a PNG, or null if the canvas isn't available. */
export async function teamsImage(input: ImageInput): Promise<Blob | null> {
  try {
    await fontsReady();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const L = layoutImage(input, (t, font) => {
      ctx.font = font;
      return ctx.measureText(t).width;
    });
    canvas.width = L.width;
    canvas.height = L.height;
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f5f4ef';
    ctx.fillRect(0, 0, L.width, L.height);

    for (const c of L.cards) {
      const hex = hexOf(c.team.color);
      const right = c.x + c.w - INSET;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(c.x, c.y, c.w, c.h, 28);
      ctx.clip();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.fillStyle = hex;
      ctx.fillRect(c.x, c.y, c.w, c.head);
      ctx.fillStyle = inkOn(hex);
      ctx.font = FONTS.team;
      ctx.fillText(c.team.name, right, c.y + 28, c.w - 2 * INSET);
      if (c.team.sub) {
        ctx.globalAlpha = 0.85;
        ctx.font = FONTS.sub;
        ctx.fillText(c.team.sub, right, c.y + 84, c.w - 2 * INSET);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = '#151613';
      ctx.font = FONTS.name;
      for (const r of c.rows) r.lines.forEach((line, i) => ctx.fillText(line, right, r.y + i * LINE));
      ctx.restore();
      ctx.strokeStyle = '#e2e0d7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(c.x + 1, c.y + 1, c.w - 2, c.h - 2, 27);
      ctx.stroke();
    }

    if (L.subs) {
      ctx.fillStyle = '#151613';
      ctx.font = FONTS.name;
      L.subs.lines.forEach((line, i) => ctx.fillText(line, W - PAD, L.subs!.y + i * LINE));
    }
    ctx.fillStyle = '#8b8c83';
    ctx.font = FONTS.footer;
    ctx.textAlign = 'center';
    ctx.fillText('כוחות', W / 2, L.footerY);

    return await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  } catch {
    return null;
  }
}
