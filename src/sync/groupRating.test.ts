// Group rating mode and the 3-rater minimum (DECISIONS → "Group rating mode and a 3-rater minimum (v18)").
import { describe, expect, it } from 'vitest';
import { applyCards } from '../state/cards';
import { defaultAttrs, type Player } from '../state/model';
import { MIN_RATERS, ratedLevel } from '../state/votes';
import { playerShareText, ratingProgress } from './organizer';
import { applyPlayerVotes, effectiveCanRate, levelFromVotes, parseMembers, parseRatingMode, playerAtLevel, type VoteRow } from './players';

const O1 = '00000000-0000-4000-8000-0000000000a1';
const O2 = '00000000-0000-4000-8000-0000000000a2';
const P1 = '00000000-0000-4000-8000-0000000000b1';
const P2 = '00000000-0000-4000-8000-0000000000b2';
const P3 = '00000000-0000-4000-8000-0000000000b3';
const row = (rater: string, level: number, playerId = 'x'): VoteRow => ({ rater, playerId, level });
const pl = (level: number, levelVotes?: Record<string, number>): Player => ({ id: 'x', name: 'X', attrs: defaultAttrs(level), canGK: false, cards: [], ...(levelVotes ? { levelVotes } : {}) });

describe('MIN_RATERS: the average needs 3 distinct raters', () => {
  it('is one constant, 3', () => expect(MIN_RATERS).toBe(3));
  it('0 voters: the level stays', () => {
    expect(levelFromVotes(undefined, [], 'x')).toBeNull();
    const p = pl(6);
    expect(applyPlayerVotes([p], [])[0]).toBe(p);
  });
  it('1–2 players only: the organizer\'s level stays', () => {
    const p = pl(6);
    expect(applyPlayerVotes([p], [row(P1, 9)])[0]).toBe(p);
    expect(applyPlayerVotes([p], [row(P1, 9), row(P2, 10)])[0]).toBe(p);
  });
  it('under 3 with organizers\' votes: the organizers\' average (v9), players ignored', () => {
    expect(levelFromVotes({ [O1]: 4 }, [row(P1, 10)], 'x')).toBe(4);
    expect(levelFromVotes({ [O1]: 4, [O2]: 5 }, [], 'x')).toBe(5); // 4.5 → 5
  });
  it('3+ voters: plain average of everyone, one vote each', () => {
    expect(levelFromVotes(undefined, [row(P1, 9), row(P2, 8), row(P3, 4)], 'x')).toBe(7);
    expect(levelFromVotes({ [O1]: 4 }, [row(P1, 10), row(P2, 10)], 'x')).toBe(8);
    expect(applyPlayerVotes([pl(6, { [O1]: 4 })], [row(P1, 10), row(P2, 10)])[0].attrs).toEqual(applyCards(8, []));
  });
  it('votes on other players do not count', () => {
    expect(levelFromVotes({ [O1]: 4 }, [row(P1, 10), row(P2, 10, 'y')], 'x')).toBe(4);
  });
  it('one login counts once (an organizer who also has a player vote)', () => {
    expect(levelFromVotes({ [O1]: 4 }, [row(O1, 10), row(P1, 10)], 'x')).toBe(4); // 2 logins, not 3
    expect(levelFromVotes({ [O1]: 4 }, [row(O1, 10), row(P1, 10), row(P2, 10)], 'x')).toBe(8); // doc wins for O1
  });
  it('an organizer\'s tap: his vote; the average only from 3', () => {
    expect(playerAtLevel(pl(5), 7, O1, [row(P1, 1)]).attrs.overall).toBe(7);
    expect(playerAtLevel(pl(5), 7, O1, [row(P1, 1), row(P2, 1)]).attrs.overall).toBe(3);
    expect(playerAtLevel(pl(5), 7, null, [row(P1, 1), row(P2, 1)]).attrs.overall).toBe(7); // local group
  });
  it('ratedLevel', () => {
    expect(ratedLevel({ [P1]: 9, [P2]: 9 }, undefined)).toBeNull();
    expect(ratedLevel({ [P1]: 9, [P2]: 9, [O1]: 3 }, { [O1]: 3 })).toBe(7);
  });
});

describe('who may rate', () => {
  it('mode + override', () => {
    expect(effectiveCanRate('player', null, 'organizers')).toBe(false);
    expect(effectiveCanRate('player', true, 'organizers')).toBe(true);
    expect(effectiveCanRate('player', null, 'everyone')).toBe(true);
    expect(effectiveCanRate('player', false, 'everyone')).toBe(false);
    expect(effectiveCanRate('organizer', true, 'everyone')).toBe(false);
  });
  it('mode parsing defaults to organizers', () => {
    expect(parseRatingMode('everyone')).toBe('everyone');
    expect(parseRatingMode(undefined)).toBe('organizers');
    expect(parseRatingMode('x')).toBe('organizers');
  });
});

describe('organizer sheet', () => {
  it('share text per mode', () => {
    expect(playerShareText('שישי', 'organizers')).toBe('הצטרפו לקבוצה ״שישי״ בכוחות');
    expect(playerShareText('שישי', 'everyone')).toBe('הצטרפו לכוחות ודרגו את החברים. הדירוג אנונימי');
  });
  it('progress: players with a vote / players who joined', () => {
    const members = parseMembers([
      { user_id: O1, role: 'organizer', can_rate: false },
      { user_id: P1, role: 'player', can_rate: true },
      { user_id: P2, role: 'player', can_rate: true },
      { user_id: P3, role: 'player', can_rate: false },
    ]);
    expect(ratingProgress(members, [row(P1, 5), row(P1, 6, 'y'), row(O1.toUpperCase(), 4)])).toBe('דירגו: 1 מתוך 3');
    expect(ratingProgress(members, [])).toBe('דירגו: 0 מתוך 3');
  });
});
