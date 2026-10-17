import { TEAMS } from './i18n';

/** Right-to-left mark: pins direction of each line in WhatsApp even when a name is in Latin letters. */
const RLM = '‏';

export interface ShareTeam {
  names: string[];
}

export function buildShareText(teams: ShareTeam[], score: number, date = new Date()): string {
  const d = date.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' });
  const lines: string[] = [`${RLM}⚽ הכוחות להיום – ${d}`, ''];
  teams.forEach((t, i) => {
    const look = TEAMS[i] ?? { emoji: '⚪', name: `קבוצה ${i + 1}` };
    lines.push(`${RLM}${look.emoji} *${look.name}* (${t.names.length})`);
    t.names.forEach((n, j) => lines.push(`${RLM}${j + 1}. ${n}${RLM}`));
    lines.push('');
  });
  lines.push(`${RLM}מאזן: ${score}/100`);
  return lines.join('\n');
}

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Native share sheet if available. Returns false if not supported or user cancelled. */
export async function nativeShare(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share({ text });
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
