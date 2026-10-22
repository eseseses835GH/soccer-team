import { describe, expect, it, vi } from 'vitest';
import { GOOGLE_FAILED, LINK_EXPIRED, LOGIN_FAILED, emailCodes, emailRedirect, finishArrival, parseAuthUrl, setArrival } from './authUrl';

const B = 'https://www.kadoregel.com/';

describe('reading a login from the address (v16)', () => {
  it('takes the implicit-flow tokens from the hash and cleans them away', () => {
    const r = parseAuthUrl(`${B}#access_token=AT&expires_at=1&expires_in=3600&refresh_token=RT&token_type=bearer&type=magiclink`);
    expect(r.arrival).toEqual({ kind: 'tokens', access_token: 'AT', refresh_token: 'RT' });
    expect(r.clean).toBe('/');
  });
  it('first-time users (Confirm your email) land the same way', () => {
    expect(parseAuthUrl(`${B}#access_token=AT&refresh_token=RT&type=signup`).arrival?.kind).toBe('tokens');
  });
  it('keeps the invite that rode along in the email link', () => {
    const r = parseAuthUrl(`${B}?join=TOK%2B1#access_token=AT&refresh_token=RT&type=magiclink`);
    expect(r.arrival?.kind).toBe('tokens');
    expect(r.join).toBe('TOK+1');
    expect(r.clean).toBe('/#join=TOK%2B1');
  });
  it('an expired or used link is an error, cleaned', () => {
    const r = parseAuthUrl(`${B}?join=T#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
    expect(r.arrival).toEqual({ kind: 'error', code: 'otp_expired' });
    expect(r.clean).toBe('/#join=T');
    expect(parseAuthUrl(`${B}?error=server_error&error_description=x`).arrival).toEqual({ kind: 'error', code: 'server_error' });
  });
  it('takes the Google token from #gsi= and returns to the saved screen', () => {
    const jwt = 'aaa.bbb_-.ccc';
    const r = parseAuthUrl(`${B}#gsi=${jwt}`, '#settings');
    expect(r.arrival).toEqual({ kind: 'gsi', credential: jwt });
    expect(r.clean).toBe('/#settings');
    expect(parseAuthUrl(`${B}#gsi=not-a-jwt`).arrival).toEqual({ kind: 'error', code: 'gsi_bad' });
    expect(parseAuthUrl(`${B}#gsi_error=csrf`, '#home')).toEqual({ arrival: { kind: 'error', code: 'gsi_csrf' }, join: null, clean: '/#home' });
  });
  it('a PKCE link from before v16 is still tried', () => {
    const r = parseAuthUrl(`${B}?code=abc&x=1#home`);
    expect(r.arrival).toEqual({ kind: 'code', code: 'abc' });
    expect(r.clean).toBe('/?x=1#home');
  });
  it("leaves the app's own addresses alone", () => {
    for (const h of ['', '#home', '#join=T', '#players?import=shared', '#import=eyJ', '#evening/3']) {
      expect(parseAuthUrl(`${B}${h}`)).toEqual({ arrival: null, join: null, clean: null });
    }
  });
});

describe('making the session', () => {
  const auth = (error: unknown = null) => ({
    setSession: vi.fn(async () => ({ error })),
    signInWithIdToken: vi.fn(async () => ({ error })),
    exchangeCodeForSession: vi.fn(async () => ({ error })),
  });
  it('tokens → setSession', async () => {
    const a = auth();
    setArrival({ kind: 'tokens', access_token: 'AT', refresh_token: 'RT' });
    expect(await finishArrival(a)).toBeNull();
    expect(a.setSession).toHaveBeenCalledWith({ access_token: 'AT', refresh_token: 'RT' });
    expect(await finishArrival(a)).toBeNull(); // used once
    expect(a.setSession).toHaveBeenCalledTimes(1);
  });
  it('Google token → signInWithIdToken with the raw nonce', async () => {
    const a = auth();
    setArrival({ kind: 'gsi', credential: 'a.b.c' }, 'RAW');
    expect(await finishArrival(a)).toBeNull();
    expect(a.signInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'a.b.c', nonce: 'RAW' });
  });
  it('says clearly in Hebrew when Supabase refuses (no blank screen)', async () => {
    setArrival({ kind: 'gsi', credential: 'a.b.c' }, 'RAW');
    expect(await finishArrival(auth({ message: 'Nonces mismatch' }))).toBe(GOOGLE_FAILED);
    setArrival({ kind: 'gsi', credential: 'a.b.c' });
    expect(await finishArrival({ ...auth(), signInWithIdToken: async () => Promise.reject(new Error('boom')) })).toBe(GOOGLE_FAILED);
    setArrival({ kind: 'tokens', access_token: 'AT', refresh_token: 'RT' });
    expect(await finishArrival(auth({ message: 'Invalid Refresh Token' }))).toBe(LINK_EXPIRED);
    setArrival({ kind: 'tokens', access_token: 'AT', refresh_token: 'RT' });
    expect(await finishArrival(auth({ message: 'Failed to fetch' }))).toBe('אין חיבור לאינטרנט');
    setArrival({ kind: 'error', code: 'otp_expired' });
    expect(await finishArrival(auth())).toBe(LINK_EXPIRED);
    setArrival({ kind: 'error', code: 'gsi_csrf' });
    expect(await finishArrival(auth())).toBe(GOOGLE_FAILED);
    setArrival({ kind: 'code', code: 'x' });
    expect(await finishArrival(auth({ message: 'code verifier missing' }))).toBe(LOGIN_FAILED);
  });
});

describe('the email link', () => {
  it('carries a waiting invite in the return address', () => {
    expect(emailRedirect(B, null)).toBe(B);
    expect(emailRedirect(B, 'a b')).toBe(`${B}?join=a%20b`);
    expect(parseAuthUrl(`${emailRedirect(B, 'a b')}#access_token=A&refresh_token=R`).join).toBe('a b');
  });
  it('code field only with VITE_EMAIL_CODE=1', () => {
    expect(emailCodes({})).toBe(false);
    expect(emailCodes({ VITE_EMAIL_CODE: '0' })).toBe(false);
    expect(emailCodes({ VITE_EMAIL_CODE: '1' })).toBe(true);
  });
});
