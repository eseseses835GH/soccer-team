import { describe, expect, it } from 'vitest';
import { buildShareText, whatsappUrl } from './share';

describe('share text', () => {
  it('lists teams, keepers, borrowers and subs in Hebrew with RTL marks', () => {
    const t = buildShareText({
      teams: [
        { name: 'אדומים', emoji: '🔴', names: ['אבי', 'Ben'], keepers: ['Ben', 'אבי'] },
        { name: 'כחולים', emoji: '🔵', names: ['גל'], borrows: 1 },
      ],
      subs: ['רון'],
      score: 91,
      gkSwitchGoals: 2,
      date: new Date(2026, 9, 17),
    });
    expect(t).toContain('*אדומים* (2)');
    expect(t).toContain('*כחולים* (1 · משלימים 1 מהמפסידה)');
    expect(t).toContain('2. Ben');
    expect(t).toContain('🧤 בשער: Ben ← אבי (מתחלפים כל 2 גולים)');
    expect(t).toContain('מחליפים: רון');
    expect(t).toContain('מדד איזון: 91/100');
    for (const line of t.split('\n').filter(Boolean)) expect(line.startsWith('‏')).toBe(true);
  });
  it('builds an encoded wa.me link', () => {
    expect(whatsappUrl('שלום 1')).toBe('https://wa.me/?text=%D7%A9%D7%9C%D7%95%D7%9D%201');
  });
});
