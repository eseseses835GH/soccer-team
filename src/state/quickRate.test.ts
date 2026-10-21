import { describe, expect, it } from 'vitest';
import { applyCards } from './cards';
import type { Player } from './model';
import { nextStep, rateStep, roundDone, startRound } from './quickRate';
import { FREE_PLAYERS, gatePlayers } from '../sync/gate';
import { fromNames, parseWhatsAppChat } from './whatsapp';
import ios from '../../scripts/fixtures/wa-chat-ios.txt?raw';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const fresh = (id: string, name = id): Player => ({ id, name, attrs: applyCards(5, []), canGK: false, cards: [] });

describe('quick rating round', () => {
  it('walks the new players one by one, passing over one deleted meanwhile', () => {
    const roster = [fresh('a'), fresh('c')];
    let r = startRound(['a', 'b', 'c']);
    expect(r.at).toBe(0);
    r = nextStep(r, roster);
    expect(r.at).toBe(2); // 'b' is gone
    expect(roundDone(r)).toBe(false);
    r = nextStep(r, roster);
    expect(roundDone(r)).toBe(true);
  });

  it('a level tap sets the level and the chips; skip leaves 5 and nothing marked', () => {
    const p = rateStep(fresh('a'), 8, true, ['att'], null, []);
    expect(p.attrs).toEqual(applyCards(8, []));
    expect(p.canGK).toBe(true);
    expect(p.positions).toEqual(['att']);
    expect(p.levelVotes).toBeUndefined();
    const skipped = fresh('b');
    expect(skipped.attrs.overall).toBe(5);
    expect(rateStep(fresh('c'), 3, false, [], null, []).positions).toBeUndefined();
  });

  it("in a synced group the tap is the organizer's vote, averaged like the edit sheet", () => {
    const p = rateStep({ ...fresh('a'), levelVotes: { [OTHER]: 4 } }, 8, false, [], ME, []);
    expect(p.levelVotes).toEqual({ [OTHER]: 4, [ME]: 8 });
    expect(p.attrs.overall).toBe(6);
    // Players allowed to rate count too (v10).
    expect(rateStep(fresh('b'), 9, false, [], ME, [{ playerId: 'b', rater: OTHER, level: 5 }]).attrs.overall).toBe(7);
  });
});

describe('import and the free limit (v13)', () => {
  const chat = parseWhatsAppChat(ios).names.map((n, i) => fresh(`w${i}`, n.name));

  it('a whole chat import past 4 asks to log in once; logged in it just goes', () => {
    expect(chat.length).toBeGreaterThan(FREE_PLAYERS);
    expect(gatePlayers(true, [], chat)).toBe('players');
    expect(gatePlayers(true, [], chat.slice(0, FREE_PLAYERS))).toBe('ok');
    expect(gatePlayers(true, [fresh('own')], chat.slice(0, FREE_PLAYERS))).toBe('players');
    expect(gatePlayers(false, [], chat)).toBe('ok');
  });

  it('contacts are the same', () => {
    const list = fromNames(['א', 'ב', 'ג', 'ד', 'ה']).names.map((n, i) => fresh(`c${i}`, n.name));
    expect(gatePlayers(true, [], list)).toBe('players');
  });
});
