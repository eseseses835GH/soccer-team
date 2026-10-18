import { describe, expect, it } from 'vitest';
import { INITIAL_STATE, sanitize, sanitizeSettings, type AppState } from '../state/model';
import { reducer } from '../state/reducer';
import { announcerText, pickHebrewVoice } from './celebrate';
import { confetti } from './GoalBurst';

describe('goal celebration', () => {
  it('goal sound defaults to on and sanitizes junk', () => {
    expect(INITIAL_STATE.settings.goalSound).toBe('all');
    expect(sanitizeSettings({}).goalSound).toBe('all');
    expect(sanitizeSettings({ goalSound: 'loud' }).goalSound).toBe('all');
    expect(sanitizeSettings({ goalSound: 'crowd' }).goalSound).toBe('crowd');
    expect(sanitize({ version: 2, players: [], settings: { goalSound: 'off' } }).settings.goalSound).toBe('off');
  });

  it('an imported backup keeps this phone’s sound choice', () => {
    const mine: AppState = { ...INITIAL_STATE, settings: { ...INITIAL_STATE.settings, goalSound: 'off' } };
    const next = reducer(mine, { type: 'importPlayers', players: [], settings: { ...INITIAL_STATE.settings, goalSound: 'all' } });
    expect(next.settings.goalSound).toBe('off');
  });

  it('picks a Hebrew voice, preferring an on-device one', () => {
    const v = (lang: string, localService = false) => ({ lang, localService, name: lang + localService });
    expect(pickHebrewVoice([v('en-US', true), v('fr-FR')])).toBeNull();
    expect(pickHebrewVoice([])).toBeNull();
    expect(pickHebrewVoice([v('en-US', true), v('he-IL'), v('he-IL', true)])?.localService).toBe(true);
    expect(pickHebrewVoice([v('iw_IL')])?.lang).toBe('iw_IL');
    expect(pickHebrewVoice([v('hu-HU')])).toBeNull();
  });

  it('the announcer names the scoring team', () => {
    expect(announcerText('אדומים')).toContain('לאדומים');
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
