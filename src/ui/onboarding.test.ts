import { describe, expect, it } from 'vitest';
import { availableSteps, bubbleAt, NEW_GROUP_MS, ORG_STEPS, PLAYER_STEPS, shouldInviteCard, shouldOfferTour, spotBox, type CardInviteContext, type TourOfferContext } from './onboarding';

const org: TourOfferContext = { kind: 'org', seen: false, matchOn: false, players: 12, uses: 1, groupAge: 0 };
const player: TourOfferContext = { kind: 'player', seen: false, matchOn: false, players: 0, uses: 0, groupAge: 60_000 };

describe('shouldOfferTour', () => {
  it('a new organizer with a roster, once', () => {
    expect(shouldOfferTour(org)).toBe(true);
    expect(shouldOfferTour({ ...org, uses: 0 })).toBe(true);
    expect(shouldOfferTour({ ...org, seen: true })).toBe(false);
  });
  it('not on an empty roster (the welcome sheet is there) nor for someone who used the app before', () => {
    expect(shouldOfferTour({ ...org, players: 0 })).toBe(false);
    expect(shouldOfferTour({ ...org, uses: 2 })).toBe(false);
  });
  it('a player in a group he just got, not an old one', () => {
    expect(shouldOfferTour(player)).toBe(true);
    expect(shouldOfferTour({ ...player, groupAge: NEW_GROUP_MS + 1 })).toBe(false);
    expect(shouldOfferTour({ ...player, seen: true })).toBe(false);
  });
  it('never during a match', () => {
    expect(shouldOfferTour({ ...org, matchOn: true })).toBe(false);
    expect(shouldOfferTour({ ...player, matchOn: true })).toBe(false);
  });
});

describe('shouldInviteCard', () => {
  const c: CardInviteContext = { synced: true, playerId: 'p1', hasPhoto: false, answered: false, tourSession: false, matchOn: false };
  it('a claimed player without a photo in a cloud group', () => {
    expect(shouldInviteCard(c)).toBe(true);
  });
  it.each<[string, Partial<CardInviteContext>]>([
    ['local group', { synced: false }],
    ['no claim', { playerId: null }],
    ['claim unknown', { playerId: undefined }],
    ['has a photo', { hasPhoto: true }],
    ['answered before', { answered: true }],
    ['tour in this session', { tourSession: true }],
    ['match running', { matchOn: true }],
  ])('not when: %s', (_, x) => {
    expect(shouldInviteCard({ ...c, ...x })).toBe(false);
  });
});

describe('steps', () => {
  it('keeps only the steps on the page, in order', () => {
    const on = new Set(['attend', 'split', 'group']);
    expect(availableSteps(ORG_STEPS, (t) => on.has(t)).map((s) => s.target)).toEqual(['attend', 'split', 'group']);
    expect(availableSteps(PLAYER_STEPS, () => false)).toEqual([]);
  });
  it('short lines, unique targets', () => {
    for (const steps of [ORG_STEPS, PLAYER_STEPS]) {
      expect(new Set(steps.map((s) => s.target)).size).toBe(steps.length);
      for (const s of steps) expect(s.text.length).toBeLessThanOrEqual(40);
    }
  });
});

describe('placement', () => {
  it('the spotlight stays on screen and at most 45% high', () => {
    const b = spotBox({ top: -50, left: -10, width: 500, height: 2000 }, 360, 800);
    expect(b.top).toBeGreaterThanOrEqual(0);
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.left + b.width).toBeLessThanOrEqual(360);
    expect(b.height).toBeLessThanOrEqual(800 * 0.45);
  });
  it('the bubble fits a 360px phone, below or above the spot', () => {
    const below = bubbleAt({ top: 10, left: 300, width: 44, height: 44 }, 360, 740, 110);
    expect(below.left).toBeGreaterThanOrEqual(16);
    expect(below.left + below.width).toBeLessThanOrEqual(344);
    expect(below.top).toBe(66);
    const above = bubbleAt({ top: 640, left: 20, width: 320, height: 60 }, 360, 740, 110);
    expect(above.top).toBe(640 - 12 - 110);
    expect(above.left).toBe(30); // centred on the spot
  });
});
