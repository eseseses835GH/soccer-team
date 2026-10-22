import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gisUxMode, googleMode, makeNonce, saveGsiNonce, sha256Hex, takeGsiNonce } from './googleId';

describe('google sign-in nonce', () => {
  it('hashes like Supabase expects (SHA-256, lowercase hex)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('makes a fresh random nonce whose hash is what Google gets', async () => {
    const a = await makeNonce();
    const b = await makeNonce();
    expect(a.raw).not.toBe(b.raw);
    expect(a.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.hashed).toBe(await sha256Hex(a.raw));
    expect(a.hashed).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('which Google flow', () => {
  const ok = { clientId: 'x.apps.googleusercontent.com', secure: true, iosHomeScreen: false, provider: true as boolean | null, gis: 'ready' as const };
  it('uses our own page when everything is in place', () => {
    expect(googleMode(ok)).toBe('gis');
    expect(googleMode({ ...ok, provider: null })).toBe('gis');
    expect(googleMode({ ...ok, gis: 'loading' })).toBe('loading');
  });
  it('falls back to the redirect through Supabase', () => {
    expect(googleMode({ ...ok, clientId: '' })).toBe('redirect');
    expect(googleMode({ ...ok, secure: false })).toBe('redirect');
    expect(googleMode({ ...ok, iosHomeScreen: true })).toBe('redirect');
    expect(googleMode({ ...ok, gis: 'failed' })).toBe('redirect');
  });
  it('is off when the project has no Google', () => {
    expect(googleMode({ ...ok, provider: false })).toBe('off');
    expect(googleMode({ ...ok, provider: false, clientId: '' })).toBe('off');
  });
});

describe('popup or redirect (v16)', () => {
  const UA = {
    iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
    ipadOs: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36',
    instagram: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0',
    desktopChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  };
  it('redirects on iPhone/iPad (Safari, Chrome iOS, iPadOS) and in in-app browsers', () => {
    expect(gisUxMode(UA.iosSafari, 5)).toBe('redirect');
    expect(gisUxMode(UA.iosChrome, 5)).toBe('redirect');
    expect(gisUxMode(UA.ipadOs, 5)).toBe('redirect');
    expect(gisUxMode(UA.androidWebView, 5)).toBe('redirect');
    expect(gisUxMode(UA.instagram, 5)).toBe('redirect');
  });
  it('keeps the popup on Android Chrome and desktop', () => {
    expect(gisUxMode(UA.android, 5)).toBe('popup');
    expect(gisUxMode(UA.desktopChrome, 0)).toBe('popup');
    expect(gisUxMode(UA.ipadOs, 0)).toBe('popup'); // a real Mac's Safari
    expect(gisUxMode(UA.windows, 0)).toBe('popup');
  });
});

describe('the nonce across the Google redirect', () => {
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('is read once, with the screen to return to', () => {
    saveGsiNonce('raw-1', '#settings', 1000);
    expect(takeGsiNonce(2000)).toEqual({ raw: 'raw-1', back: '#settings' });
    expect(takeGsiNonce(2000)).toBeNull();
  });
  it('expires after 15 minutes, and ignores junk', () => {
    saveGsiNonce('raw-1', '#home', 0);
    expect(takeGsiNonce(16 * 60_000)).toBeNull();
    mem.set('kochot:gsi', '{bad');
    expect(takeGsiNonce()).toBeNull();
    saveGsiNonce('raw-2', 'javascript:x', 0);
    expect(takeGsiNonce(1)).toEqual({ raw: 'raw-2', back: '' });
  });
});
