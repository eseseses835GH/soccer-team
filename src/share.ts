/** Right-to-left mark: pins the direction of each line in WhatsApp even when a name is in Latin letters. */
const RLM = '\u200f';

/** The one line that goes with the picture. */
export const TEAMS_TITLE = 'הכוחות להערב ⚽';

export interface ShareTeam {
  name: string;
  emoji: string;
  names: string[];
}

/** Short text: one line per team, then the subs. No ratings, keepers or score. */
export function buildShareText({ teams, subs = [] }: { teams: ShareTeam[]; subs?: string[] }): string {
  const lines = [`${RLM}${TEAMS_TITLE}`];
  teams.forEach((t) => lines.push(`${RLM}${t.emoji} *${t.name}*: ${t.names.join(', ')}${RLM}`));
  if (subs.length) lines.push(`${RLM}🔁 מחליפים: ${subs.join(', ')}${RLM}`);
  return lines.join('\n');
}

/**
 * Shares a picture through the native share sheet when it can take files.
 * 'shared' (or cancelled by the user), or 'unsupported'.
 */
export async function shareFile(file: File, text?: string): Promise<'shared' | 'unsupported'> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || !navigator.canShare?.({ files: [file] })) return 'unsupported';
  try {
    await navigator.share({ files: [file], ...(text ? { text } : {}) });
  } catch (e) {
    if ((e as Error)?.name !== 'AbortError') return 'unsupported';
  }
  return 'shared';
}

/** Save a file (an image, a backup) to the device. */
export function downloadBlob(filename: string, blob: Blob): void {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* ignore */
  }
}

/** Native share sheet if available. Returns false if not supported or cancelled. */
export async function nativeShare(data: { text?: string; url?: string; title?: string }): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share(data);
      return true;
    }
  } catch {
    /* cancelled or not allowed */
  }
  return false;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Save text as a file (backup / template). */
export function downloadText(filename: string, text: string, type = 'text/plain'): void {
  downloadBlob(filename, new Blob([text], { type: `${type};charset=utf-8` }));
}

export interface EveningShareInput {
  date: Date;
  /** "🔴 האדומים לקחו את הערב" / "🔵 קבוצה 1 לקחה את הערב", if one team clearly won the evening. */
  champion?: string;
  /** Standings, best first: "🔴 אדומים 4 נ׳ · 1 ת׳ · 1 ה׳". */
  table: string[];
  /** Highlight lines, e.g. "👑 מלך השערים: אבי (4)". */
  highlights: string[];
}

/** Short recap of an evening for the group chat: no ratings, names only. */
export function buildEveningShareText({ date, champion, table, highlights }: EveningShareInput): string {
  const d = date.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' });
  const lines = [`${RLM}⚽ סיכום הערב – ${d}`];
  if (champion) lines.push(`${RLM}🏆 ${champion}`);
  lines.push(...table.map((t) => `${RLM}${t}${RLM}`), ...highlights.map((h) => `${RLM}${h}${RLM}`));
  return lines.join('\n');
}
