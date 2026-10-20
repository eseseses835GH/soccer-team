import { describe, expect, it } from 'vitest';
import { NO_FLAGS, SNOOZE_MS, USE_GAP_MS, detectPlatform, neverAgain, recordUse, sanitizeFlags, shouldOfferInstall, snooze, type OfferContext } from './install';

const T0 = Date.UTC(2026, 9, 20, 18);
const H = 3600 * 1000;
const ctx = (over: Partial<OfferContext> = {}): OfferContext => ({ now: T0, standalone: false, canOffer: true, onHome: true, clockRunning: false, ...over });

describe('recordUse', () => {
  it('counts the first open as the first use', () => {
    expect(recordUse(NO_FLAGS, T0)).toMatchObject({ uses: 1, useAt: T0 });
  });
  it('keeps one long evening (past midnight) as one use', () => {
    let f = recordUse(NO_FLAGS, T0);
    f = recordUse(f, T0 + 2 * H);
    f = recordUse(f, T0 + 7 * H);
    expect(f).toMatchObject({ uses: 1, useAt: T0 });
  });
  it('starts a second use 12 hours after the first one began', () => {
    const f = recordUse(recordUse(NO_FLAGS, T0), T0 + USE_GAP_MS);
    expect(f).toMatchObject({ uses: 2, useAt: T0 + USE_GAP_MS });
  });
  it('a clock that went backwards starts a new use', () => {
    expect(recordUse(recordUse(NO_FLAGS, T0), T0 - H).uses).toBe(2);
  });
});

describe('shouldOfferInstall', () => {
  const first = recordUse(NO_FLAGS, T0);
  const second = recordUse(first, T0 + 13 * H);
  const at = (over: Partial<OfferContext> = {}) => ctx({ now: T0 + 13 * H, ...over });

  it('never on the first use (even hours later the same evening)', () => {
    expect(shouldOfferInstall(NO_FLAGS, ctx())).toBe(false);
    expect(shouldOfferInstall(first, ctx({ now: T0 + 5 * H }))).toBe(false);
  });
  it('from the second use on, on the main screen', () => {
    expect(shouldOfferInstall(second, at())).toBe(true);
  });
  it('never while a match clock runs, or off the main screen', () => {
    expect(shouldOfferInstall(second, at({ clockRunning: true }))).toBe(false);
    expect(shouldOfferInstall(second, at({ onHome: false }))).toBe(false);
  });
  it('never once installed or running from the home screen', () => {
    expect(shouldOfferInstall(second, at({ standalone: true }))).toBe(false);
    expect(shouldOfferInstall({ ...second, installed: true }, at())).toBe(false);
  });
  it('only where installing is possible (prompt captured or iOS)', () => {
    expect(shouldOfferInstall(second, at({ canOffer: false }))).toBe(false);
  });
  it('"later" waits a week, "never" is for good', () => {
    const s = snooze(second, T0 + 13 * H);
    expect(shouldOfferInstall(s, at({ now: T0 + 14 * H }))).toBe(false);
    expect(shouldOfferInstall(s, at({ now: T0 + 13 * H + SNOOZE_MS }))).toBe(true);
    const n = neverAgain(second);
    expect(shouldOfferInstall(n, at({ now: T0 + 100 * SNOOZE_MS }))).toBe(false);
  });
});

describe('sanitizeFlags', () => {
  it('repairs junk', () => {
    expect(sanitizeFlags(null)).toEqual(NO_FLAGS);
    expect(sanitizeFlags('x')).toEqual(NO_FLAGS);
    expect(sanitizeFlags({ uses: -3, useAt: 'x', snoozeUntil: NaN, never: 'yes', installed: 1 })).toEqual(NO_FLAGS);
    expect(sanitizeFlags({ uses: 2.7, useAt: 5, snoozeUntil: 9, never: true, installed: true })).toEqual({ v: 1, uses: 2, useAt: 5, snoozeUntil: 9, never: true, installed: true });
  });
});

describe('detectPlatform', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
  const ipadOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
  const insta = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0.0';
  const fb = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22F76 [FBAN/FBIOS;FBAV/500.0.0.0]';
  const crios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1';
  const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

  it('iPhone Safari', () => expect(detectPlatform(iphone, 5)).toEqual({ platform: 'ios', ipad: false, safari: true, inApp: null }));
  it('iPad that says Macintosh, but not a real Mac', () => {
    expect(detectPlatform(ipadOS, 5)).toMatchObject({ platform: 'ios', ipad: true });
    expect(detectPlatform(ipadOS, 0).platform).toBe('other');
  });
  it('in-app browsers on iOS', () => {
    expect(detectPlatform(insta, 5)).toMatchObject({ platform: 'ios-inapp', inApp: 'אינסטגרם' });
    expect(detectPlatform(fb, 5)).toMatchObject({ platform: 'ios-inapp', inApp: 'פייסבוק' });
  });
  it('Chrome on iOS is iOS, not Safari', () => expect(detectPlatform(crios, 5)).toMatchObject({ platform: 'ios', safari: false }));
  it('Android', () => expect(detectPlatform(android, 5).platform).toBe('android'));
});
