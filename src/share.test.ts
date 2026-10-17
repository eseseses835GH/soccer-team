import { describe, expect, it } from 'vitest';
import { buildShareText, whatsappUrl } from './share';

describe('share text', () => {
  it('lists teams in Hebrew with RTL marks', () => {
    const t = buildShareText([{ names: ['אבי', 'Ben'] }, { names: ['גל'] }], 91, new Date(2026, 9, 17));
    expect(t).toContain('אדומים');
    expect(t).toContain('כחולים');
    expect(t).toContain('1. אבי');
    expect(t).toContain('2. Ben');
    expect(t).toContain('מאזן: 91/100');
    for (const line of t.split('\n').filter(Boolean)) expect(line.startsWith('‏')).toBe(true);
  });
  it('builds an encoded wa.me link', () => {
    expect(whatsappUrl('שלום 1')).toBe('https://wa.me/?text=%D7%A9%D7%9C%D7%95%D7%9D%201');
  });
});
