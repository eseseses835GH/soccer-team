import { goalsEvery } from './i18n';

/** Right-to-left mark: pins the direction of each line in WhatsApp even when a name is in Latin letters. */
const RLM = '‏';

export interface ShareTeam {
  name: string;
  emoji: string;
  names: string[];
  /** Keeper rotation (names), first starts in goal. */
  keepers?: string[];
  /** How many players this team borrows from the losing team. */
  borrows?: number;
}

export interface ShareInput {
  teams: ShareTeam[];
  subs?: string[];
  score: number;
  gkSwitchGoals?: number;
  date?: Date;
}

export function buildShareText({ teams, subs = [], score, gkSwitchGoals, date = new Date() }: ShareInput): string {
  const d = date.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' });
  const lines: string[] = [`${RLM}⚽ הכוחות להיום – ${d}`, ''];
  teams.forEach((t) => {
    const extra = t.borrows ? ` · משלימים ${t.borrows} מהמפסידה` : '';
    lines.push(`${RLM}${t.emoji} *${t.name}* (${t.names.length}${extra})`);
    t.names.forEach((n, j) => lines.push(`${RLM}${j + 1}. ${n}${RLM}`));
    if (t.keepers?.length) {
      const every = gkSwitchGoals ? ` (מתחלפים ${goalsEvery(gkSwitchGoals)})` : '';
      lines.push(`${RLM}🧤 בשער: ${t.keepers.join(' ← ')}${every}${RLM}`);
    }
    lines.push('');
  });
  if (subs.length) lines.push(`${RLM}🔁 מחליפים: ${subs.join(', ')}${RLM}`, '');
  lines.push(`${RLM}מדד איזון: ${score}/100`);
  return lines.join('\n');
}

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
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
  try {
    const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
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

export interface EveningShareInput {
  date: Date;
  matches: number;
  goals: number;
  minutes?: number | null;
  /** "🔴 אדומים" of the team that won the evening, if there was a clear one. */
  champion?: string;
  /** Standings, best first: "🔴 אדומים 4 נ׳ · 1 ת׳ · 1 ה׳". */
  table: string[];
  /** Highlight lines, e.g. "👑 מלך השערים: אבי (4)". */
  highlights: string[];
}

/** Short recap of an evening for the group chat: no ratings, names only. */
export function buildEveningShareText({ date, matches, goals, minutes, champion, table, highlights }: EveningShareInput): string {
  const d = date.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' });
  const totals = [`${matches} משחקים`, `${goals} שערים`, ...(minutes ? [`${minutes} דקות`] : [])].join(' · ');
  const lines = [`${RLM}⚽ סיכום הערב – ${d}`, `${RLM}${totals}`, ''];
  if (champion) lines.push(`${RLM}🏆 ${champion} לקחו את הערב`, '');
  table.forEach((t, i) => lines.push(`${RLM}${i + 1}. ${t}${RLM}`));
  if (highlights.length) lines.push('', ...highlights.map((h) => `${RLM}${h}${RLM}`));
  return lines.join('\n');
}
