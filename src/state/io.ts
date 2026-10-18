import { CARDS, type CardId, applyCards } from './cards';
import { newId, sanitizePlayer, sanitizeSettings, type Player, type Settings } from './model';
import type { Constraints } from '../engine';
import { sanitizeHistory, type EveningRecord } from './history';

// ---------- plain-text / CSV roster ----------

export interface ParsedRoster {
  players: Player[];
  skipped: { line: string; reason: string }[];
}

const GK_WORDS = ['שוער', 'gk', 'goalkeeper', 'כן'];
const HEADER_WORDS = ['שם', 'name'];

/**
 * Parse a roster typed or pasted by hand, one player per line:
 *   "אבי 8", "אבי, 8", "דני הקטן, 6, שוער, החיה", "יוסי" (level 5).
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
    const lower = rest.toLowerCase();
    const canGK = GK_WORDS.some((w) => lower.split(/\s+/).includes(w));
    const cards = CARDS.filter((c) => rest.includes(c.name))
      .map((c) => c.id)
      .slice(0, 2) as CardId[];
    taken.add(name);
    players.push({ id: newId(), name, attrs: applyCards(level, cards), canGK, cards });
  }
  return { players, skipped };
}

export const ROSTER_TEMPLATE = '﻿שם,רמה,שוער,כרטיסיות\nאבי,8,,הקפטן\nדני,5,שוער,\nנועם,7,,הקוסם\nליאור,6,,החיה\n';

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
