import { CARDS, applyCards, sanitizeCards, type CardId } from './cards';
import { parsePositionWords } from './positions';
import { isPhone } from './whatsapp';
import { newId, sanitizePlayer, sanitizeSettings, type Player, type Settings } from './model';
import type { Constraints } from '../engine';
import { sanitizeHistory, type EveningRecord } from './history';

// ---------- plain-text / CSV roster ----------

export interface ParsedRoster {
  players: Player[];
  skipped: { line: string; reason: string }[];
}

// "טוב בשער" (the 🧤 chip's label) is read through its second word.
const GK_WORDS = ['שוער', 'בשער', 'gk', 'goalkeeper', 'כן'];
const HEADER_WORDS = ['שם', 'name'];

/**
 * Parse a roster typed or pasted by hand, one player per line:
 *   "אבי 8", "אבי, 8", "דני הקטן, 6, שוער, גורילה", "נועם 7 הגנה קישור", "יוסי" (level 5).
 * Works with CSV (comma/semicolon/tab) as exported from Excel or Sheets.
 */
export function parseRoster(text: string, existingNames: string[] = []): ParsedRoster {
  const taken = new Set(existingNames.map((n) => n.trim()));
  const players: Player[] = [];
  const skipped: ParsedRoster['skipped'] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // A bare phone number is never a name (and never stored).
    if (isPhone(line.split(/[,;\t|]/)[0])) {
      skipped.push({ line: 'מספר טלפון', reason: 'בלי שם' });
      continue;
    }
    let name = '';
    let level = 5;
    let rest = '';
    if (/[,;\t|]/.test(line)) {
      const fields = line.split(/[,;\t|]/).map((f) => f.trim());
      name = fields[0];
      const lv = fields.slice(1).find((f) => /^\d{1,2}$/.test(f));
      if (lv) level = Number(lv);
      rest = fields.slice(1).join(' ');
    } else {
      const m = line.match(/^(.*?)\s+(\d{1,2})(?:\s+(.*))?$/);
      if (m) {
        name = m[1];
        level = Number(m[2]);
        rest = m[3] ?? '';
      } else name = line;
    }
    name = name.replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 24);
    if (!name || HEADER_WORDS.includes(name.toLowerCase())) continue;
    if (level < 1 || level > 10) {
      skipped.push({ line, reason: 'רמה חייבת להיות 1–10' });
      continue;
    }
    if (taken.has(name)) {
      skipped.push({ line, reason: 'השם כבר קיים' });
      continue;
    }
    const words = rest.toLowerCase().split(/\s+/);
    const canGK = GK_WORDS.some((w) => words.includes(w));
    const positions = parsePositionWords(words);
    const cards = parseCardNames(rest);
    taken.add(name);
    players.push({ id: newId(), name, attrs: applyCards(level, cards), canGK, cards, ...(positions.length ? { positions } : {}) });
  }
  return { players, skipped };
}

export const ROSTER_TEMPLATE =
  '\uFEFFשם,רמה,טוב בשער,עמדות,כרטיסיות\nאבי,8,,קישור,כוכב\nדני,5,כן,הגנה,איטי\nנועם,7,,התקפה,קוסם עצלן\nליאור,6,,הגנה קישור,גורילה\nגיל,3,,,מתחיל\n';

/**
 * Card names (or short aliases) in the order they appear in the text. Longer terms are
 * matched first and blanked out, so a short name inside a longer one can't match twice.
 * Opposites and the card limit apply as if the cards were tapped in that order.
 */
export function parseCardNames(text: string): CardId[] {
  const terms = CARDS.flatMap((c) => [c.name, ...(c.aliases ?? [])].map((term) => ({ id: c.id, term }))).sort((a, b) => b.term.length - a.term.length);
  let rest = text;
  const found: { id: CardId; at: number }[] = [];
  for (const { id, term } of terms) {
    const at = rest.indexOf(term);
    if (at < 0) continue;
    found.push({ id, at });
    rest = rest.slice(0, at) + ' '.repeat(term.length) + rest.slice(at + term.length);
  }
  return sanitizeCards(found.sort((a, b) => a.at - b.at).map((f) => f.id));
}

// ---------- full backup (file / link) ----------

export interface Backup {
  app: 'kochot';
  v: 2;
  exportedAt: number;
  players: Player[];
  constraints: Constraints;
  settings: Settings;
  /** Past evenings. In the backup file only: the link leaves them out to stay short. */
  history?: EveningRecord[];
}

export function makeBackup(players: Player[], constraints: Constraints, settings: Settings, now = Date.now(), history?: EveningRecord[]): Backup {
  return { app: 'kochot', v: 2, exportedAt: now, players, constraints, settings, ...(history?.length ? { history } : {}) };
}

export function parseBackup(raw: unknown): Backup | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Backup>;
  if (r.app !== 'kochot' || !Array.isArray(r.players)) return null;
  const players = r.players.map(sanitizePlayer).filter((p): p is Player => !!p);
  const ids = new Set(players.map((p) => p.id));
  const ok = (pr: unknown): pr is [string, string] => Array.isArray(pr) && pr.length === 2 && ids.has(pr[0]) && ids.has(pr[1]);
  return {
    app: 'kochot',
    v: 2,
    exportedAt: Number(r.exportedAt) || 0,
    players,
    constraints: {
      together: Array.isArray(r.constraints?.together) ? r.constraints.together.filter(ok) : [],
      apart: Array.isArray(r.constraints?.apart) ? r.constraints.apart.filter(ok) : [],
    },
    settings: sanitizeSettings(r.settings),
    ...(r.history ? { history: sanitizeHistory(r.history) } : {}),
  };
}

/**
 * Merge imported players into the roster: same id or same name updates the
 * existing player (ratings travel with the backup), anything else is added.
 */
export function mergePlayers(current: Player[], incoming: Player[]): { players: Player[]; added: number; updated: number; idMap: Map<string, string> } {
  const out = [...current];
  const idMap = new Map<string, string>();
  let added = 0;
  let updated = 0;
  for (const p of incoming) {
    const idx = out.findIndex((c) => c.id === p.id || c.name.trim() === p.name.trim());
    if (idx >= 0) {
      idMap.set(p.id, out[idx].id);
      out[idx] = { ...p, id: out[idx].id };
      updated++;
    } else {
      idMap.set(p.id, p.id);
      out.push(p);
      added++;
    }
  }
  return { players: out, added, updated, idMap };
}

/**
 * Restore a backup file into the roster: players whose name is new are added (with fresh ids), names
 * already here are kept as they are, and the backup's pair rules come along, pointed at the right
 * players. A rule that contradicts one already here (together vs apart) is skipped.
 */
export function restoreBackup(current: Player[], constraints: Constraints, b: Backup): { players: Player[]; constraints: Constraints; added: number } {
  const byName = new Map(current.map((p) => [p.name.trim(), p.id]));
  const idMap = new Map<string, string>();
  const added: Player[] = [];
  for (const p of b.players) {
    const have = byName.get(p.name.trim());
    if (have) idMap.set(p.id, have);
    else {
      const np = { ...p, id: newId() };
      byName.set(p.name.trim(), np.id);
      idMap.set(p.id, np.id);
      added.push(np);
    }
  }
  const same = (x: [string, string], y: [string, string]) => (x[0] === y[0] && x[1] === y[1]) || (x[0] === y[1] && x[1] === y[0]);
  const out: Constraints = { together: [...constraints.together], apart: [...constraints.apart] };
  for (const kind of ['together', 'apart'] as const) {
    const other = kind === 'together' ? 'apart' : 'together';
    for (const [a, c] of b.constraints[kind]) {
      const pr: [string, string] = [idMap.get(a) ?? '', idMap.get(c) ?? ''];
      if (!pr[0] || !pr[1] || pr[0] === pr[1]) continue;
      if (out[kind].some((x) => same(x, pr)) || out[other].some((x) => same(x, pr))) continue;
      out[kind].push(pr);
    }
  }
  return { players: [...current, ...added], constraints: out, added: added.length };
}

// ---------- link encoding (#import=...) ----------

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Compact, URL-safe encoding of a backup: "z." + deflate when supported, "j." + plain otherwise. */
export async function encodeBackup(b: Backup): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(b));
  try {
    if (typeof CompressionStream !== 'undefined') return 'z.' + toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
  } catch {
    /* fall back */
  }
  return 'j.' + toBase64Url(bytes);
}

export async function decodeBackup(s: string): Promise<Backup | null> {
  try {
    const [kind, data] = [s.slice(0, 2), s.slice(2)];
    let bytes = fromBase64Url(data);
    if (kind === 'z.') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    else if (kind !== 'j.') return null;
    return parseBackup(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

export const IMPORT_HASH = '#import=';
