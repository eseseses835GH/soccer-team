import { describe, expect, it } from 'vitest';
import { buildShareText } from './share';
import { hexOf, inkOn, layoutImage, W, wrapText, type Measure } from './shareImage';

describe('share text', () => {
  it('is one line per team plus the subs, with RTL marks', () => {
    const t = buildShareText({
      teams: [
        { name: 'קבוצה 1', emoji: '🔵', names: ['אבי', 'Ben'] },
        { name: 'קבוצה 2', emoji: '🟠', names: ['גל'] },
      ],
      subs: ['רון'],
    });
    const lines = t.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe('‏🔵 *קבוצה 1*: אבי, Ben‏');
    expect(lines[3]).toContain('מחליפים: רון');
    for (const line of lines) expect(line.startsWith('‏')).toBe(true);
  });
  it('has no subs line without subs', () => {
    expect(buildShareText({ teams: [{ name: 'אדומים', emoji: '🔴', names: ['א'] }] }).split('\n')).toHaveLength(2);
  });
});

// 10px per character, whatever the font.
const measure: Measure = (t) => Array.from(t).length * 10;

describe('share image layout', () => {
  it('wraps by words and breaks words longer than a line', () => {
    expect(wrapText('אבי בן חיים', 70, '', measure)).toEqual(['אבי בן', 'חיים']);
    expect(wrapText('abcdefghij', 40, '', measure)).toEqual(['abcd', 'efgh', 'ij']);
  });
  it('puts team 1 on the right, cards in a row share a height', () => {
    const L = layoutImage(
      {
        teams: [
          { name: 'קבוצה 1', color: 'var(--bib-blue)', names: ['א', 'ב', 'ג'], keeper: true },
          { name: 'קבוצה 2', color: 'var(--bib-orange)', names: ['ד'] },
          { name: 'קבוצה 3', sub: 'בחוץ', color: 'var(--bib-purple)', names: ['ה', 'ו'] },
        ],
        subs: ['ז'],
      },
      measure,
    );
    expect(L.width).toBe(W);
    const [a, b, c] = L.cards;
    expect(a.x).toBeGreaterThan(b.x);
    expect(b.x).toBeGreaterThan(c.x);
    expect(a.x + a.w).toBeLessThanOrEqual(W);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(new Set(L.cards.map((x) => x.h)).size).toBe(1);
    expect(a.rows[0].lines[0]).toBe('🧤 א');
    expect(b.rows[0].lines[0]).toBe('ד');
    expect(L.subs!.y).toBeGreaterThan(a.y + a.h);
    expect(L.height).toBeGreaterThan(L.footerY);
  });
  it('four or more teams go in rows of two', () => {
    const teams = [1, 2, 3, 4, 5].map((n) => ({ name: `קבוצה ${n}`, color: '#000000', names: ['א'] }));
    const L = layoutImage({ teams }, measure);
    expect(L.cards[0].y).toBe(L.cards[1].y);
    expect(L.cards[2].y).toBeGreaterThan(L.cards[0].y);
    expect(L.cards[4].x).toBe(L.cards[0].x);
    expect(L.subs).toBeNull();
  });
  it('resolves bib colours and picks readable ink', () => {
    expect(hexOf('var(--bib-red)')).toBe('#e0362c');
    expect(inkOn(hexOf('var(--bib-yellow)'))).toBe('#151613');
    expect(inkOn(hexOf('var(--bib-white)'))).toBe('#151613');
    expect(inkOn(hexOf('var(--bib-blue)'))).toBe('#ffffff');
    expect(inkOn(hexOf('var(--bib-black)'))).toBe('#ffffff');
  });
});
