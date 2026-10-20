import { describe, expect, it } from 'vitest';
import { CARDS, STRENGTHS, WEAKNESSES } from '../state/cards';
import { ALL_POSITIONS } from '../state/positions';
import { HELP, HELP_ITEMS, searchHelp, type HelpItem } from './help';

const item = (id: string) => HELP_ITEMS.find((i) => i.id === id) as HelpItem;
const rows = (id: string) => (item(id).legend ?? []).map((r) => ({ emoji: 'emoji' in r.mark ? r.mark.emoji : '', name: r.name, text: r.text }));

describe('help screen data', () => {
  it('lists every card, with its emoji and one-liner, under strengths or weaknesses', () => {
    expect(rows('icons-strengths')).toEqual(STRENGTHS.map((c) => ({ emoji: c.emoji, name: c.name, text: c.blurb })));
    expect(rows('icons-weaknesses')).toEqual(WEAKNESSES.map((c) => ({ emoji: c.emoji, name: c.name, text: c.blurb })));
    expect(STRENGTHS.length + WEAKNESSES.length).toBe(CARDS.length);
  });

  it('lists every position with its emoji', () => {
    const shown = rows('icons-positions');
    for (const p of ALL_POSITIONS) expect(shown).toContainEqual(expect.objectContaining({ emoji: p.emoji, name: p.name }));
  });

  it('has unique ids and a non-empty answer or legend everywhere', () => {
    const ids = HELP_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(HELP.map((s) => s.id)).size).toBe(HELP.length);
    for (const i of HELP_ITEMS) {
      expect(i.q.trim()).not.toBe('');
      expect((i.a?.length ?? 0) + (i.legend?.length ?? 0)).toBeGreaterThan(0);
    }
  });

  it('keeps the questions other screens link to', () => {
    expect(item('score')).toBeDefined();
  });

  it('search finds questions by any word, cards included', () => {
    expect(searchHelp('')).toBe(HELP);
    const hits = searchHelp('פנדלים').flatMap((s) => s.items.map((i) => i.id));
    expect(hits).toContain('draw');
    expect(searchHelp(CARDS[0].name).flatMap((s) => s.items.map((i) => i.id))).toContain('icons-strengths');
    expect(searchHelp('zzzz')).toEqual([]);
  });
});
