// Names for the roster from WhatsApp (DECISIONS → "WhatsApp import and quick rating (v14)"):
// an exported group chat (.txt, or the .zip WhatsApp makes), a participants CSV, or a pasted chat.
// Pure functions, no React. Phone numbers never leave this file: a sender with no name is only
// counted (`unnamed`), and the number itself is dropped.

export interface PickedNames {
  /** Distinct names, most messages first (file order for a CSV). */
  names: { name: string; count: number }[];
  /** Senders shown by WhatsApp as a phone number only (no saved name). Counted, never kept. */
  unnamed: number;
}

const MAX_NAME = 24;
/** Direction marks and isolates WhatsApp wraps names and numbers in, and the BOM. */
const MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** The name as shown: no direction marks, no "~ " (a sender not in the contacts), single spaces. */
export function cleanName(raw: string): string {
  return raw
    .replace(MARKS, '')
    .replace(/[\s\u00a0\u202f]+/g, ' ')
    .trim()
    .replace(/^~\s*/, '')
    .trim();
}

/** Comparison key: case, spaces and direction marks don't matter. */
export const nameKey = (raw: string) => cleanName(raw).normalize('NFC').toLowerCase().replace(/\s+/g, '');

export const isPhone = (raw: string) => /^\+?\d{7,15}$/.test(cleanName(raw).replace(/[\s\u2010\u2011\-–().]/g, ''));

// ---------- exported chat ----------

const DATE = String.raw`\d{1,4}[./-]\d{1,2}[./-]\d{1,4}`;
const TIME = String.raw`\d{1,2}[:.]\d{2}(?:[:.]\d{2})?`;
const AMPM = String.raw`(?:[\s\u00a0\u202f]*(?:[AaPp]\.?\s?[Mm]\.?|לפנה["״]צ|אחה["״]צ))?`;
/** iPhone: "[21/10/2026, 20:15:03] דני: …" */
const IOS = new RegExp(String.raw`^\[(${DATE}),?\s+${TIME}${AMPM}\]\s*(.*)$`);
/** Android: "21/10/2026, 20:15 - דני: …" (also 12h, dots, other date orders). */
const ANDROID = new RegExp(String.raw`^(${DATE}),?\s+${TIME}${AMPM}\s+[-–]\s+(.*)$`);
/** iPhone puts group notices under the group's name, after a direction mark; these bodies are real messages. */
const MEDIA = /omitted|הושמט|<attached|<מצורף|deleted|נמחק|^poll:|^סקר:|location:|מיקום:|\.vcf|https?:/i;
const ENCRYPTED = /end-to-end encrypted|מוצפנות מקצה לקצה/i;

function header(line: string): { ios: boolean; rest: string } | null {
  const l = line.replace(/^[\u200e\u200f\ufeff\s]+/, '');
  const m = IOS.exec(l);
  if (m) return { ios: true, rest: m[2] };
  const a = ANDROID.exec(l);
  return a ? { ios: false, rest: a[2] } : null;
}

/** The sender of a message line, or null for a system notice (joined, left, created, encrypted…). */
function senderOf(rest: string): string | null {
  // "name: message". A notice has no "name: " (Android) — or a quote/long text before a colon in its body.
  const m = /^(.+?):(?:\s|$)([\s\S]*)$/.exec(rest);
  if (!m) return null;
  const [, who, body] = m;
  if (/["“”«»]/.test(who) || who.length > 40 || who.trim().split(/\s+/).length > 5) return null;
  if (ENCRYPTED.test(body)) return null;
  // iPhone notices: "[…] Group name: <LRM>דני הצטרף/ה…" — a direction mark first, and not a media line.
  if (/^\u200e/.test(body) && !MEDIA.test(body.replace(MARKS, ''))) return null;
  return who;
}

/** True when the text looks like a WhatsApp chat export (one of its first lines is a message header). */
export function isWhatsAppChat(text: string): boolean {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 5)
    .some((l) => header(l) !== null);
}

function collect(raw: string[]): PickedNames {
  const byKey = new Map<string, { name: string; count: number; at: number }>();
  const phones = new Set<string>();
  raw.forEach((r, i) => {
    if (isPhone(r)) {
      phones.add(cleanName(r).replace(/\D/g, ''));
      return;
    }
    const name = cleanName(r).slice(0, MAX_NAME).trim();
    if (!name) return;
    const k = nameKey(name);
    const have = byKey.get(k);
    if (have) have.count++;
    else byKey.set(k, { name, count: 1, at: i });
  });
  return {
    names: [...byKey.values()].sort((a, b) => b.count - a.count || a.at - b.at).map(({ name, count }) => ({ name, count })),
    unnamed: phones.size,
  };
}

/** Senders of an exported chat: system notices and continuation lines of multi-line messages are skipped. */
export function parseWhatsAppChat(text: string): PickedNames {
  const senders: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const h = header(line);
    if (!h) continue; // a continuation of the message above
    const who = senderOf(h.rest);
    if (who !== null) senders.push(who);
  }
  return collect(senders);
}

// ---------- participants CSV (WhatsApp Web export extensions) ----------

/** Minimal CSV: quotes, doubled quotes, the given delimiter. */
function csvRows(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

const NAME_COLS = ['name', 'שם', 'full name', 'שם מלא', 'contact name', 'saved name', 'display name', 'public name', 'pushname', 'push name'];
const PHONE_COL = /phone|number|mobile|טלפון|מספר|נייד/;

/**
 * A participants CSV: a header with a name column and a phone/number column. Takes the name (the
 * first name column with a value), never the number; rows without a name are skipped. Null when
 * the header doesn't look like that (then it's an ordinary roster CSV).
 */
export function parseContactsCsv(text: string): PickedNames | null {
  const t = text.replace(/^\ufeff/, '');
  const first = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t'].reduce((best, s) => (first.split(s).length > first.split(best).length ? s : best), ',');
  const rows = csvRows(t, sep);
  const head = (rows[0] ?? []).map((h) => cleanName(h).toLowerCase());
  // A roster with levels (our template, or one with a phone column) is read as a roster.
  if (!head.some((h) => PHONE_COL.test(h)) || head.some((h) => h === 'רמה' || h === 'level')) return null;
  const exact = NAME_COLS.flatMap((n) => head.flatMap((h, i) => (h === n ? [i] : [])));
  const loose = head.flatMap((h, i) => (!exact.includes(i) && !PHONE_COL.test(h) && /name|שם/.test(h) ? [i] : []));
  const cols = [...exact, ...loose];
  // Numbers only: nothing to take (and never the numbers themselves).
  if (!cols.length) return { names: [], unnamed: 0 };
  const names: string[] = [];
  for (const r of rows.slice(1)) {
    const v = cols.map((i) => r[i] ?? '').find((x) => cleanName(x) && !isPhone(x));
    if (v) names.push(v);
  }
  return fromNames(names);
}

/** A plain list of names (the phone's contact picker): cleaned, deduped, in order; numbers dropped. */
export function fromNames(list: string[]): PickedNames {
  return { names: collect(list).names.map((n) => ({ name: n.name, count: 0 })), unnamed: 0 };
}

/** Names from a chat export or a participants CSV; null for anything else (a typed roster). */
export function pickNames(text: string): PickedNames | null {
  if (isWhatsAppChat(text)) return parseWhatsAppChat(text);
  return parseContactsCsv(text);
}

// ---------- zip (WhatsApp's "export chat" on iPhone, and with media) ----------

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export const isZip = (b: Uint8Array) => b.length > 4 && u32(b, 0) === 0x04034b50;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The chat's text from a zip: reads the central directory, picks the .txt (`_chat.txt` first) and
 * inflates it with the browser's own DecompressionStream. Stored or deflated entries only, no zip64.
 */
export async function readZipText(b: Uint8Array): Promise<string | null> {
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (u32(b, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = u16(b, end + 10);
  let p = u32(b, end + 16);
  const entries: { name: string; method: number; size: number; local: number }[] = [];
  for (let n = 0; n < count && u32(b, p) === 0x02014b50; n++) {
    const nameLen = u16(b, p + 28);
    entries.push({
      method: u16(b, p + 10),
      size: u32(b, p + 20),
      local: u32(b, p + 42),
      name: new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen)),
    });
    p += 46 + nameLen + u16(b, p + 30) + u16(b, p + 32);
  }
  const txt = entries.filter((e) => /\.txt$/i.test(e.name) && !e.name.startsWith('__MACOSX'));
  const e = txt.find((x) => /_chat\.txt$/i.test(x.name)) ?? txt.find((x) => /chat/i.test(x.name)) ?? txt[0];
  if (!e || u32(b, e.local) !== 0x04034b50) return null;
  const start = e.local + 30 + u16(b, e.local + 26) + u16(b, e.local + 28);
  const data = b.subarray(start, start + e.size);
  const raw = e.method === 0 ? data : e.method === 8 ? await inflateRaw(data) : null;
  return raw ? new TextDecoder().decode(raw) : null;
}

/** A file's text: a zip is opened to its chat .txt; the BOM is dropped. */
export async function readFileText(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = isZip(bytes) ? await readZipText(bytes) : new TextDecoder().decode(bytes);
  if (text === null) throw new Error('zip');
  return text.replace(/^\ufeff/, '');
}

// ---------- Android share target (see public/sw.js) ----------

/** Where the service worker leaves a chat shared to the installed app, until the app reads it. */
export const SHARE_CACHE = 'kochot-share';
export const SHARE_PATH = './__share';
export const SHARED_HASH = 'import=shared';

/** The shared file (or text) once, then it's deleted: the chat holds phone numbers, so it isn't kept. */
export async function takeShared(): Promise<Blob | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const url = new URL(SHARE_PATH, location.href).href;
    const res = await cache.match(url);
    await caches.delete(SHARE_CACHE);
    return res ? await res.blob() : null;
  } catch {
    return null;
  }
}

/** A share that was never opened is dropped on the next start. */
export function dropShared() {
  if (typeof caches !== 'undefined') caches.delete(SHARE_CACHE).catch(() => {});
}
