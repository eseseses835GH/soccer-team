import type { AttrKey } from './engine';

export const ATTR_LABELS: Record<AttrKey, string> = {
  overall: 'רמה כללית',
  stamina: 'כושר',
  passing: 'מסירה',
  dribbling: 'כדרור',
  shooting: 'בעיטה',
  defense: 'הגנה',
  teamwork: 'משחק קבוצתי',
  leadership: 'מנהיגות',
};

export function scoreLabel(score: number): string {
  if (score >= 85) return 'מאוזן מאוד';
  if (score >= 70) return 'מאוזן';
  if (score >= 50) return 'סביר';
  return 'לא מאוזן';
}

export function playersCount(n: number): string {
  return n === 1 ? 'שחקן אחד' : `${n} שחקנים`;
}

export function goalsEvery(n: number): string {
  return n === 1 ? 'כל גול' : `כל ${n} גולים`;
}
