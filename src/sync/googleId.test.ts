import { describe, expect, it } from 'vitest';
import { googleMode, makeNonce, sha256Hex } from './googleId';

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
