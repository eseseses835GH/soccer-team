import { describe, expect, it } from 'vitest';
import { liveFromState } from '../sync/live';
import { settingsFromLive } from '../sync/control';
import { parsePublic } from '../sync/players';
import { publicToState } from '../sync/playerGroup';
import { parseEvening, withEvening } from './evening';
import { DEFAULT_SETTINGS, INITIAL_STATE, sanitizeSettings } from './model';

describe('runner evening settings', () => {
  it('parseEvening keeps the five match rules of the right type only', () => {
    expect(parseEvening(null)).toBeNull();
    expect(parseEvening([])).toBeNull();
    expect(parseEvening({ matchMinutes: 9, matchNoLimit: true, drawExtraMinutes: 1, gkMode: 'fixed', gkSwitchGoals: 2, weights: {}, theme: 'dark' })).toEqual({
      matchMinutes: 9,
      matchNoLimit: true,
      drawExtraMinutes: 1,
      gkMode: 'fixed',
      gkSwitchGoals: 2,
    });
    expect(parseEvening({ matchMinutes: '9', matchNoLimit: 1, gkMode: 'x', gkSwitchGoals: NaN })).toEqual({});
    // Outside what the app's sanitizer accepts: dropped (the group's value stays).
    expect(parseEvening({ matchMinutes: 0, drawExtraMinutes: 11, gkSwitchGoals: 6 })).toEqual({});
    expect(parseEvening({ matchMinutes: 60, drawExtraMinutes: 0, gkSwitchGoals: 5 })).toEqual({ matchMinutes: 60, drawExtraMinutes: 0, gkSwitchGoals: 5 });
  });

  it('withEvening goes through sanitizeSettings, keeps the base for bad values and leaves the rest alone', () => {
    const base = { ...DEFAULT_SETTINGS, theme: 'dark' as const, hasBibs: true, matchMinutes: 9 };
    const s = withEvening(base, { matchMinutes: 12.4, drawExtraMinutes: 3, gkSwitchGoals: 2.6 });
    expect(s).toEqual(sanitizeSettings({ ...base, matchMinutes: 12.4, drawExtraMinutes: 3, gkSwitchGoals: 2.6 }));
    expect(s).toMatchObject({ matchMinutes: 12, drawExtraMinutes: 3, gkSwitchGoals: 3, theme: 'dark', hasBibs: true, weights: base.weights });
    expect(withEvening(base, { matchMinutes: 0, drawExtraMinutes: 50 })).toMatchObject({ matchMinutes: 9, drawExtraMinutes: base.drawExtraMinutes });
  });

  it("the live snapshot carries tonight's rules, and another runner's phone takes them", () => {
    const settings = withEvening(DEFAULT_SETTINGS, { matchMinutes: 12, drawExtraMinutes: 3, gkMode: 'fixed', gkSwitchGoals: 2 });
    const result = { playerIds: ['a', 'b', 'c', 'd'], subIds: [], teamSize: 2, numTeams: 2, sizes: [2, 2], assignment: [0, 0, 1, 1], generated: [0, 0, 1, 1], pool: [], shown: [], gkOrder: [['a', 'b'], ['c', 'd']], createdAt: 1 };
    const players = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id }));
    const live = liveFromState({ result, match: null, players, settings, now: 5 })!;
    expect(live.rules).toEqual({ gkRotate: false, gkEvery: 2, matchMs: 12 * 60_000, drawExtraMinutes: 3 });
    const next = settingsFromLive(DEFAULT_SETTINGS, live);
    expect(next).toMatchObject({ gkMode: 'fixed', gkSwitchGoals: 2, matchMinutes: 12, matchNoLimit: false, drawExtraMinutes: 3 });
    const off = liveFromState({ result, match: null, players, settings: withEvening(settings, { matchNoLimit: true }), now: 5 })!;
    expect(off.rules?.matchMs).toBeNull();
  });

  it("a player's phone starts from the group's rules in the public copy (none before the migration)", () => {
    const raw = { groupId: 'g', name: 'x', players: [], history: [], me: { role: 'player' }, settings: { matchMinutes: 14, gkMode: 'fixed', weights: { pace: 1 } } };
    const pub = parsePublic(raw)!;
    expect(pub.settings).toEqual({ matchMinutes: 14, gkMode: 'fixed' });
    const st = publicToState({ ...INITIAL_STATE, settings: { ...INITIAL_STATE.settings, theme: 'dark' } }, pub);
    expect(st.settings).toMatchObject({ matchMinutes: 14, gkMode: 'fixed', theme: 'dark' });
    const old = parsePublic({ ...raw, settings: undefined })!;
    expect(old.settings).toBeUndefined();
    expect(publicToState(INITIAL_STATE, old).settings).toEqual(INITIAL_STATE.settings);
  });
});
