import { describe, expect, it } from 'vitest';
import { INITIAL_STATE, sanitize, sanitizeSettings, type AppState } from '../state/model';
import { reducer } from '../state/reducer';
import { HORN_BLASTS, playWhistle, WHISTLES } from './sounds';
import { confetti } from './GoalBurst';

describe('match sounds', () => {
  it('sound defaults to on, and old values migrate', () => {
    expect(INITIAL_STATE.settings.goalSound).toBe('on');
    expect(sanitizeSettings({}).goalSound).toBe('on');
    expect(sanitizeSettings({ goalSound: 'loud' }).goalSound).toBe('on');
    // v3 values: crowd + announcer / crowd only → on; off stays off.
    expect(sanitizeSettings({ goalSound: 'all' }).goalSound).toBe('on');
    expect(sanitizeSettings({ goalSound: 'crowd' }).goalSound).toBe('on');
    expect(sanitize({ version: 2, players: [], settings: { goalSound: 'off' } }).settings.goalSound).toBe('off');
  });

  it('an imported backup keeps this phone’s sound choice', () => {
    const mine: AppState = { ...INITIAL_STATE, settings: { ...INITIAL_STATE.settings, goalSound: 'off' } };
    const next = reducer(mine, { type: 'importPlayers', players: [], settings: { ...INITIAL_STATE.settings, goalSound: 'on' } });
    expect(next.settings.goalSound).toBe('off');
  });

  it('whistles: short-long at kick-off, short-short-long at full time', () => {
    const shape = (b: readonly (readonly [number, number])[]) => b.map(([, len]) => (len >= 0.5 ? 'long' : 'short'));
    expect(shape(WHISTLES.start)).toEqual(['short', 'long']);
    expect(shape(WHISTLES.end)).toEqual(['short', 'short', 'long']);
    expect(shape(HORN_BLASTS)).toEqual(['short', 'long']);
    for (const b of [WHISTLES.start, WHISTLES.end, HORN_BLASTS]) {
      // Blasts don't overlap and leave an audible gap.
      for (let i = 1; i < b.length; i++) expect(b[i][0] - (b[i - 1][0] + b[i - 1][1])).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('muted, or no audio yet without a tap: the whistle reports it did not sound', () => {
    expect(playWhistle('off', 'start')).toBe(false);
    expect(playWhistle('on', 'end', false)).toBe(false);
  });

  it('confetti stays on a 390px screen', () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pieces = confetti(40, 170, rnd);
    expect(pieces).toHaveLength(40);
    for (const p of pieces) {
      // The overlay clips anyway; this keeps every piece visible (the fall stretches dx by 1.15).
      expect(Math.abs(p.dx) * 1.15).toBeLessThanOrEqual(196);
    }
    expect(new Set(pieces.map((p) => Math.sign(p.dx))).size).toBeGreaterThan(1);
  });
});
