import { describe, expect, it } from 'vitest';
import type { EveningRecord } from '../state/history';
import { canReview, eveningPlayerIds, parseReview, REVIEW_WINDOW_MS, reviewable, reviewList, reviewPayload } from './reviews';

const H = 3600e3;
const NOW = Date.UTC(2026, 10, 22, 20);
const rec = (id: string, endedAt: number, extra: Partial<EveningRecord> = {}): EveningRecord => ({
  id,
  v: 1,
  startedAt: endedAt - 2 * H,
  endedAt,
  teamSize: 2,
  players: [
    { id: 'p1', name: 'אבי' },
    { id: 'p2', name: 'בני' },
    { id: 'p3', name: 'גיל' },
  ],
  teams: [
    { bib: 'red', ids: ['p1', 'p2'] },
    { bib: 'blue', ids: ['p3', 'g1'] },
  ],
  subIds: ['p4'],
  matches: [],
  ...extra,
});

describe('who reviews what (v37)', () => {
  it('everyone who was there: players, teams, bench', () => {
    expect(eveningPlayerIds(rec('e', NOW)).sort()).toEqual(['g1', 'p1', 'p2', 'p3', 'p4']);
  });

  it('only someone who played, for 48 hours after the end', () => {
    expect(canReview(rec('e', NOW - H), 'p1', NOW)).toBe(true);
    expect(canReview(rec('e', NOW - H), 'p4', NOW)).toBe(true);
    expect(canReview(rec('e', NOW - H), 'p9', NOW)).toBe(false);
    expect(canReview(rec('e', NOW - H), null, NOW)).toBe(false);
    expect(canReview(rec('e', NOW - REVIEW_WINDOW_MS + 60e3), 'p1', NOW)).toBe(true);
    expect(canReview(rec('e', NOW - REVIEW_WINDOW_MS), 'p1', NOW)).toBe(false);
    expect(canReview(rec('e', NOW + 3 * H), 'p1', NOW)).toBe(false);
  });

  it('the newest open evening that this phone did not put off', () => {
    const hist = [rec('old', NOW - 60 * H), rec('a', NOW - 30 * H), rec('b', NOW - 2 * H)];
    expect(reviewable(hist, 'p1', NOW)?.id).toBe('b');
    expect(reviewable(hist, 'p1', NOW, (id) => id === 'b')?.id).toBe('a');
    expect(reviewable(hist, 'p1', NOW, () => true)).toBeNull();
    expect(reviewable(hist, 'p9', NOW)).toBeNull();
    expect(reviewable([], 'p1', NOW)).toBeNull();
  });

  it('the list: everyone but me, names at the time (guests from the roster)', () => {
    const list = reviewList(rec('e', NOW), 'p1', [{ id: 'g1', name: 'אורח' }, { id: 'p2', name: 'בני חדש' }]);
    expect(list).toEqual([
      { id: 'p2', name: 'בני' },
      { id: 'p3', name: 'גיל' },
      { id: 'g1', name: 'אורח' },
    ]);
  });

  it('payload: given votes only, players of that evening only', () => {
    expect(reviewPayload({ p2: 1, p3: -1, x: 0 }, ['p2', 'p3', 'g1'])).toEqual([
      { player_id: 'p2', value: 1 },
      { player_id: 'p3', value: -1 },
    ]);
  });

  it('parses my votes', () => {
    expect(parseReview({ p2: 1, p3: 0, p4: -1, p5: 2, p6: '1' })).toEqual({ p2: 1, p3: 0, p4: -1 });
    expect(parseReview(null)).toEqual({});
    expect(parseReview([1])).toEqual({});
  });
});
