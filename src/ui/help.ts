import { STRENGTHS, WEAKNESSES, type Card } from '../state/cards';
import { ALL_POSITIONS, type PositionInfo } from '../state/positions';
import type { IconName } from './icons';

/**
 * The "שאלות ותשובות" screen (#help), as plain data so the wording is easy to edit.
 * Answers are short paragraphs. The icon legend is built from CARDS and the position list,
 * so it stays right when cards or emojis change (help.test.ts checks it covers all of them).
 */

/** What sits in the legend's first column. */
export type LegendMark =
  | { emoji: string }
  /** `ltr` for marks like "+1" that would flip in an RTL line. */
  | { text: string; ltr?: boolean }
  | { icon: IconName }
  /** The sync dot next to the group name (classes `sync-dot tone-…`). */
  | { dot: 'ok' | 'busy' | 'warn' | 'bad' };

export interface LegendRow {
  mark: LegendMark;
  name: string;
  text?: string;
}

export interface HelpItem {
  /** Stable, used in `#help/<id>` links from other screens. */
  id: string;
  q: string;
  a?: string[];
  legend?: LegendRow[];
}

export interface HelpSection {
  id: string;
  title: string;
  items: HelpItem[];
}

const POSITION_TEXT: Record<string, string> = {
  gk: 'טוב בשער (לא חייב לעמוד בשער).',
  def: 'חזק בהגנה.',
  mid: 'חזק בקישור.',
  att: 'חזק בהתקפה.',
};
const positionRow = (p: PositionInfo): LegendRow => ({
  mark: { emoji: p.emoji },
  name: p.name,
  text: POSITION_TEXT[p.id] ?? `חזק ב${p.name}.`,
});
const cardRow = (c: Card): LegendRow => ({ mark: { emoji: c.emoji }, name: c.name, text: c.blurb });

export const HELP: HelpSection[] = [
  {
    id: 'rating',
    title: 'דירוג שחקנים',
    items: [
      {
        id: 'level',
        q: 'איך נותנים רמה מ־1 עד 10?',
        a: ['ביחס לחבר׳ה שלכם: 1 = רק התחיל · 5 = באמצע · 10 = הכי טוב אצלנו. מספיק שהסדר נכון.'],
      },
      {
        id: 'icons-positions',
        q: 'עמדות',
        a: ['החלוקה מפזרת את העמדות בין הקבוצות.'],
        legend: ALL_POSITIONS.map(positionRow),
      },
      {
        id: 'icons-strengths',
        q: 'חוזקות',
        legend: STRENGTHS.map(cardRow),
      },
      {
        id: 'icons-weaknesses',
        q: 'חולשות',
        a: ['מופיעות רק במסך השחקנים, לא מול כולם.'],
        legend: WEAKNESSES.map(cardRow),
      },
    ],
  },
  {
    id: 'more',
    title: 'עוד',
    items: [
      {
        id: 'score',
        q: 'מה זה הציון מ־0 עד 100?',
        a: ['כמה הקבוצות שוות. בדרך כלל יוצא בין 80 ל־95. נמוך? ״הגרלה מחדש״ או החלפת שחקנים.'],
      },
      {
        id: 'rules',
        q: 'מה זה ״כללים בין שחקנים״?',
        a: ['״לא באותה קבוצה״ (למשל שני החזקים) או ״תמיד ביחד״ (למשל שניים שבאו באותו אוטו). מגדירים בהגדרות.'],
      },
      {
        id: 'draw',
        q: 'מה קורה בתיקו?',
        a: ['כשהזמן נגמר בתיקו יש שריקה ו־2 דקות תוספת. עדיין תיקו? בוחרים מי ניצחה בפנדלים.'],
      },
      {
        id: 'privacy',
        q: 'מי רואה את הדירוגים?',
        a: ['רק המארגנים. בקבוצות ובהודעה לוואטסאפ יש רק שמות.'],
      },
      {
        id: 'install',
        q: 'למה להוסיף למסך הבית?',
        a: ['באייפון, בלי זה ספארי עלול למחוק את הנתונים אחרי כשבוע. בהגדרות ← ״גישה מהירה״.'],
      },
    ],
  },
];

export const HELP_ITEMS: HelpItem[] = HELP.flatMap((s) => s.items);

/** All the words of a question, its answer and its legend, for the search box. */
export function helpText(item: HelpItem): string {
  return [item.q, ...(item.a ?? []), ...(item.legend ?? []).flatMap((r) => [r.name, r.text ?? '', 'emoji' in r.mark ? r.mark.emoji : ''])].join(' ');
}

/** Sections with only the items that contain every word of the query (empty query = everything). */
export function searchHelp(query: string): HelpSection[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return HELP;
  return HELP.map((s) => ({
    ...s,
    items: s.items.filter((i) => {
      const t = helpText(i).toLowerCase();
      return words.every((w) => t.includes(w));
    }),
  })).filter((s) => s.items.length > 0);
}
