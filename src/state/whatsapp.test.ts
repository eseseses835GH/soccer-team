import { describe, expect, it } from 'vitest';
import ios from '../../scripts/fixtures/wa-chat-ios.txt?raw';
import android from '../../scripts/fixtures/wa-chat-android.txt?raw';
import english from '../../scripts/fixtures/wa-chat-android-en.txt?raw';
import participants from '../../scripts/fixtures/wa-participants.csv?raw';
import { parseRoster } from './io';
import { cleanName, fromNames, isPhone, isWhatsAppChat, isZip, nameKey, parseContactsCsv, parseWhatsAppChat, pickNames, readFileText, readZipText } from './whatsapp';

const names = (t: string) => parseWhatsAppChat(t).names.map((n) => n.name);
// The last digits of every number in the fixtures.
const DIGITS = /4567|4321|0134|2222|4444|6666|8888/;

describe('WhatsApp chat export', () => {
  it('iPhone, Hebrew: senders by message count, notices under the group name left out', () => {
    const r = parseWhatsAppChat(ios);
    expect(r.names).toEqual([
      { name: 'אלי', count: 3 },
      { name: 'דני', count: 2 },
      { name: 'Ben', count: 2 },
      { name: 'יוסי כהן', count: 1 },
      { name: 'אבי', count: 1 },
      { name: 'נועם', count: 1 },
      { name: 'ליאור', count: 1 },
      { name: 'עומר', count: 1 },
    ]);
    expect(r.unnamed).toBe(2);
  });

  it('Android, Hebrew 24h: no-sender notices, quotes with a colon, continuation lines', () => {
    const r = parseWhatsAppChat(android);
    expect(r.names.map((n) => n.name)).toEqual(['שחר', 'אלי', 'תומר', 'רז']);
    expect(r.unnamed).toBe(1);
  });

  it('Android, English 12h (PM, a.m., narrow spaces), US date order', () => {
    const r = parseWhatsAppChat(english);
    expect(r.names).toEqual([
      { name: 'Dan', count: 2 },
      { name: 'Sarah Levi', count: 2 },
      { name: 'Eli', count: 1 },
    ]);
    expect(r.unnamed).toBe(1);
  });

  it('other date orders and separators', () => {
    const t = [
      '[20.10.26, 18:05:03] Anna: hallo',
      '2026-10-20 18:05 - Kim: hi',
      '20/10/2026 18:05 - Lee: no comma',
      '[10/20/26, 6:05:03 PM] Max: hey',
      '20/10/2026, 6:05 אחה"צ - רון: שלום',
    ].join('\n');
    expect(names(t)).toEqual(['Anna', 'Kim', 'Lee', 'Max', 'רון']);
  });

  it('system notices in Hebrew and English never become names', () => {
    const t = [
      '20/10/2026, 18:01 - Messages and calls are end-to-end encrypted.',
      '20/10/2026, 18:01 - You created group "A: B"',
      '20/10/2026, 18:01 - Eli changed this group\'s icon',
      '20/10/2026, 18:01 - Eli changed the group description',
      '20/10/2026, 18:01 - Dan left',
      '20/10/2026, 18:01 - Eli removed Dan',
      '20/10/2026, 18:01 - Your security code with Dan changed. Tap to learn more.',
      '20/10/2026, 18:01 - אלי שינה/תה את סמל הקבוצה',
      '20/10/2026, 18:01 - דני עזב/ה',
      '20/10/2026, 18:01 - אלי הסיר/ה את דני',
      '[20/10/2026, 18:01:00] הקבוצה: \u200eYou\'re now an admin',
      '[20/10/2026, 18:01:00] הקבוצה: \u200eאלי הצמיד/ה הודעה',
      '[20/10/2026, 18:01:00] Eli: real message',
    ].join('\n');
    expect(names(t)).toEqual(['Eli']);
  });

  it('direction marks, "~ " and spacing/case don\'t split a person', () => {
    const t = ['[1/1/26, 1:00:00] \u202a~\u202fDan Cohen\u202c: a', '[1/1/26, 1:00:00] dan  cohen: b', '[1/1/26, 1:00:00] \u200fDAN COHEN\u200f: c'].join('\n');
    expect(parseWhatsAppChat(t).names).toEqual([{ name: 'Dan Cohen', count: 3 }]);
    expect(cleanName('\u202a~ דני\u202c')).toBe('דני');
    expect(nameKey(' Dan\u00a0Cohen ')).toBe(nameKey('dan cohen'));
  });

  it('phone-only senders are counted, never kept', () => {
    const r = parseWhatsAppChat(ios + android + english);
    expect(r.unnamed).toBe(3); // +972 52-123-4567 is in two chats: still one
    expect(JSON.stringify(r)).not.toMatch(DIGITS);
    expect(isPhone('\u202a+972 52\u2011123\u20114567\u202c')).toBe(true);
    expect(isPhone('+1 (415) 555-0134')).toBe(true);
    expect(isPhone('דני 2')).toBe(false);
  });

  it('names are cut to 24 characters', () => {
    expect(names('[1/1/26, 1:00:00] אבגדהוזחטיכלמנסעפצקרשתאבגדה: x')[0]).toHaveLength(24);
  });

  it('is told apart from a typed roster', () => {
    expect(isWhatsAppChat(ios)).toBe(true);
    expect(isWhatsAppChat(english)).toBe(true);
    expect(isWhatsAppChat('אבי 8\nדני, 6')).toBe(false);
    expect(pickNames('שם,רמה\nאבי,8')).toBeNull();
  });
});

describe('participants CSV', () => {
  it('takes the name column (then another name column), never the number; skips rows without a name', () => {
    const r = parseContactsCsv(participants)!;
    expect(r.names.map((n) => n.name)).toEqual(['דני', 'Cohen, Yossi', 'Ronen']);
    expect(JSON.stringify(r)).not.toMatch(DIGITS);
  });

  it('detects Hebrew and other headers and delimiters', () => {
    expect(parseContactsCsv('שם;טלפון\nאבי;0521234567\n;0539999999')!.names.map((n) => n.name)).toEqual(['אבי']);
    expect(parseContactsCsv('Phone\tPublic Name\n+972521234567\tגלעד')!.names.map((n) => n.name)).toEqual(['גלעד']);
    expect(parseContactsCsv('Number\n+972521234567')).toEqual({ names: [], unnamed: 0 });
  });

  it('leaves a roster CSV to the roster parser', () => {
    expect(parseContactsCsv('שם,רמה,טוב בשער\nאבי,8,')).toBeNull();
    expect(parseContactsCsv('שם,רמה,טלפון\nאבי,8,0521234567')).toBeNull();
    expect(parseContactsCsv('אבי 8\nדני 6')).toBeNull();
  });

  it('a pasted bare number is never a player', () => {
    const r = parseRoster('+972 52-123-4567\nאבי 7');
    expect(r.players.map((p) => p.name)).toEqual(['אבי']);
    expect(JSON.stringify(r.skipped)).not.toMatch(DIGITS);
  });

  it('contact picker names: cleaned, deduped, numbers dropped', () => {
    expect(fromNames(['דני', ' דני ', '+972 52-123-4567', '', 'יוסי']).names.map((n) => n.name)).toEqual(['דני', 'יוסי']);
  });
});

// A tiny zip writer for the tests (crc left 0: the reader doesn't check it).
async function zip(entries: { name: string; text: string; deflate: boolean }[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = enc.encode(e.text);
    const data = e.deflate
      ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
      : raw;
    const name = enc.encode(e.name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, e.deflate ? 8 : 0, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(10, e.deflate ? 8 : 0, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const a of all) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

describe('zip', () => {
  it('reads the fixture made by `zip` (scripts/fixtures/wa-chat-ios.zip)', async () => {
    // Node's fs, without Node types in this project.
    const fs = await import(/* @vite-ignore */ ['node', 'fs'].join(':'));
    const b = new Uint8Array(fs.readFileSync(new URL('../../scripts/fixtures/wa-chat-ios.zip', import.meta.url)));
    expect(await readZipText(b)).toBe(ios);
  });

  it('reads the chat .txt (deflated) and skips media and __MACOSX', async () => {
    const b = await zip([
      { name: '__MACOSX/._chat.txt', text: 'junk', deflate: false },
      { name: '00000012-PHOTO.jpg', text: 'jpeg', deflate: false },
      { name: '_chat.txt', text: ios, deflate: true },
    ]);
    expect(isZip(b)).toBe(true);
    expect(await readZipText(b)).toBe(ios);
  });

  it('reads a stored (uncompressed) entry, e.g. "WhatsApp Chat - X.txt"', async () => {
    const b = await zip([{ name: 'WhatsApp Chat - כדורגל.txt', text: android, deflate: false }]);
    expect(await readZipText(b)).toBe(android);
  });

  it('a zip without a .txt, or not a zip at all', async () => {
    expect(await readZipText(await zip([{ name: 'a.jpg', text: 'x', deflate: false }]))).toBeNull();
    expect(await readZipText(new TextEncoder().encode('hello'))).toBeNull();
  });

  it('readFileText: a zip file or a text file, BOM dropped', async () => {
    const z = await zip([{ name: '_chat.txt', text: english, deflate: true }]);
    expect(await readFileText(new Blob([z as BlobPart]))).toBe(english);
    expect(await readFileText(new Blob(['\ufeffאבי 8']))).toBe('אבי 8');
    await expect(readFileText(new Blob([(await zip([{ name: 'a.jpg', text: 'x', deflate: false }])) as BlobPart]))).rejects.toThrow();
  });
});
