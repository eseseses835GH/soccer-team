import type { AttrKey } from './engine';

export const ATTR_LABELS: Record<AttrKey, string> = {
  overall: 'רמה כללית',
  stamina: 'ריצה וכושר',
  coordination: 'קואורדינציה',
  teamwork: 'משחק קבוצתי',
  leadership: 'מנהיגות',
  shooting: 'בעיטה',
  dribbling: 'כדרור',
  goalkeeping: 'שוער',
};

export const ATTR_SHORT: Record<AttrKey, string> = {
  overall: 'כללי',
  stamina: 'כושר',
  coordination: 'קואורד׳',
  teamwork: 'קבוצתי',
  leadership: 'מנהיגות',
  shooting: 'בעיטה',
  dribbling: 'כדרור',
  goalkeeping: 'שוער*',
};

export interface TeamLook {
  name: string;
  emoji: string;
  cls: string;
}

/** Teams are named by bib colour — that's how it works at the pitch. */
export const TEAMS: TeamLook[] = [
  { name: 'אדומים', emoji: '🔴', cls: 'team-red' },
  { name: 'כחולים', emoji: '🔵', cls: 'team-blue' },
  { name: 'ירוקים', emoji: '🟢', cls: 'team-green' },
  { name: 'צהובים', emoji: '🟡', cls: 'team-yellow' },
];

export function scoreLabel(score: number): string {
  if (score >= 85) return 'מאוזן מאוד';
  if (score >= 70) return 'מאוזן';
  if (score >= 50) return 'סביר';
  return 'לא מאוזן';
}

export function playersCount(n: number): string {
  return n === 1 ? 'שחקן אחד' : `${n} שחקנים`;
}
