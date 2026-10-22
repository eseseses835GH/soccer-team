// Logins that come back to the app through its address (v16):
// - email link (magic link / "Confirm your email") and the Google fallback through Supabase:
//   implicit flow, so the session is in the hash: `#access_token=…&refresh_token=…` (or `#error=…`).
//   Self-contained, so it works in whatever browser the mail app opens (PKCE needed the browser
//   that asked).
// - Google in redirect mode (iPhone): api/gsi.ts sends `#gsi=<id token>` (or `#gsi_error=…`).
// - an invite waiting for the login rides along as `?join=<token>` in the email link.
// The address is read and cleaned before the app renders (main.tsx), so the tokens stay in the
// URL for a moment only; the session is made once Supabase's library has loaded (SyncProvider).
import { takeGsiNonce } from './googleId';
import { JOIN_HASH } from './organizers';

export type AuthArrival =
  | { kind: 'tokens'; access_token: string; refresh_token: string }
  | { kind: 'gsi'; credential: string }
  | { kind: 'code'; code: string } // a PKCE link from before v16
  | { kind: 'error'; code: string };

const AUTH_HASH_KEYS = ['access_token', 'refresh_token', 'error', 'error_code', 'error_description', 'gsi', 'gsi_error'];
const AUTH_QUERY_KEYS = ['code', 'error', 'error_code', 'error_description', 'join'];
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * What the address brings, and the address to replace it with (null = leave it).
 * `gsiBack`: the screen to return to after a Google redirect (saved before leaving).
 */
export function parseAuthUrl(href: string, gsiBack = ''): { arrival: AuthArrival | null; join: string | null; clean: string | null } {
  const url = new URL(href);
  const raw = url.hash.slice(1);
  // Our own hashes (#home, #join=…, #players?import=shared) are never auth hashes.
  const h = /^[a-z_]+=/.test(raw) ? new URLSearchParams(raw) : new URLSearchParams();
  const authHash = [...h.keys()].some((k) => AUTH_HASH_KEYS.includes(k));
  const q = url.searchParams;
  const authQuery = AUTH_QUERY_KEYS.some((k) => q.has(k));
  if (!authHash && !authQuery) return { arrival: null, join: null, clean: null };

  let arrival: AuthArrival | null = null;
  if (authHash) {
    const err = h.get('error_code') || h.get('error') || (h.has('error_description') ? 'unknown' : '');
    const gsi = h.get('gsi') ?? '';
    if (err) arrival = { kind: 'error', code: err };
    else if (h.has('gsi_error')) arrival = { kind: 'error', code: `gsi_${h.get('gsi_error') || 'bad'}` };
    else if (gsi) arrival = JWT.test(gsi) ? { kind: 'gsi', credential: gsi } : { kind: 'error', code: 'gsi_bad' };
    else if (h.get('access_token') && h.get('refresh_token')) arrival = { kind: 'tokens', access_token: h.get('access_token')!, refresh_token: h.get('refresh_token')! };
    else arrival = { kind: 'error', code: 'unknown' };
  }
  if (!arrival) {
    const err = q.get('error_code') || q.get('error') || (q.has('error_description') ? 'unknown' : '');
    if (err) arrival = { kind: 'error', code: err };
    else if (q.get('code')) arrival = { kind: 'code', code: q.get('code')! };
  }
  const join = q.get('join') || null;

  for (const k of AUTH_QUERY_KEYS) q.delete(k);
  const search = q.toString() ? `?${q}` : '';
  const fromGoogle = arrival?.kind === 'gsi' || (arrival?.kind === 'error' && arrival.code.startsWith('gsi_'));
  const hash = join ? `${JOIN_HASH}${encodeURIComponent(join)}` : authHash ? (fromGoogle ? gsiBack : '') : url.hash;
  return { arrival, join, clean: `${url.pathname}${search}${hash}` };
}

let pending: AuthArrival | null = null;

/** Called once in main.tsx, before the first render: keep what the address brought, clean it. */
export function captureAuthArrival(): void {
  if (typeof location === 'undefined') return;
  const isGsi = /^#gsi(_error)?=/.test(location.hash);
  const back = isGsi ? (takeGsiNonceBack() ?? '') : '';
  const { arrival, clean } = parseAuthUrl(location.href, back);
  if (clean !== null) history.replaceState(history.state, '', clean);
  if (arrival) pending = arrival;
}

// The nonce itself stays until the token is sent; only "where to return" is needed this early.
let gsiNonce: string | null = null;
function takeGsiNonceBack(): string | null {
  const n = takeGsiNonce();
  gsiNonce = n?.raw ?? null;
  return n?.back ?? null;
}

export const hasArrival = () => pending !== null;

/** For tests. */
export function setArrival(a: AuthArrival | null, nonce: string | null = null): void {
  pending = a;
  gsiNonce = nonce;
}

interface AuthLike {
  setSession(t: { access_token: string; refresh_token: string }): Promise<{ error: unknown }>;
  signInWithIdToken(c: { provider: 'google'; token: string; nonce?: string }): Promise<{ error: unknown }>;
  exchangeCodeForSession(code: string): Promise<{ error: unknown }>;
}

export const LINK_EXPIRED = 'הקישור פג תוקף או שכבר השתמשו בו. שלחו קישור חדש';
export const GOOGLE_FAILED = 'ההתחברות עם Google לא הצליחה. נסו שוב, או התחברו עם מייל';
export const LOGIN_FAILED = 'ההתחברות לא הצליחה, נסו שוב';

/** Turn what the address brought into a session. Returns a Hebrew message when it didn't work. */
export async function finishArrival(auth: AuthLike, offline = false): Promise<string | null> {
  const a = pending;
  const nonce = gsiNonce;
  pending = null;
  gsiNonce = null;
  if (!a) return null;
  const said = (e: unknown, text: string) => {
    if (!e) return null;
    const msg = String((e as { message?: string })?.message ?? '');
    return offline || /fetch|network|load failed/i.test(msg) ? 'אין חיבור לאינטרנט' : text;
  };
  try {
    if (a.kind === 'error') {
      if (a.code.startsWith('gsi_')) return GOOGLE_FAILED;
      return /expired|otp|invalid|access_denied/.test(a.code) ? LINK_EXPIRED : LOGIN_FAILED;
    }
    if (a.kind === 'tokens') return said((await auth.setSession({ access_token: a.access_token, refresh_token: a.refresh_token })).error, LINK_EXPIRED);
    if (a.kind === 'gsi') return said((await auth.signInWithIdToken({ provider: 'google', token: a.credential, ...(nonce ? { nonce } : {}) })).error, GOOGLE_FAILED);
    return said((await auth.exchangeCodeForSession(a.code)).error, LOGIN_FAILED);
  } catch (e) {
    return said(e ?? new Error('x'), a.kind === 'gsi' ? GOOGLE_FAILED : LOGIN_FAILED);
  }
}

/** The email link's return address: this app, plus the invite waiting for this login. */
export function emailRedirect(base: string, join: string | null): string {
  return join ? `${base}?join=${encodeURIComponent(join)}` : base;
}

/** VITE_EMAIL_CODE=1: the email has a 6-digit code (custom SMTP + a template with {{ .Token }}). */
export const emailCodes = (env: Record<string, unknown> = import.meta.env) => env.VITE_EMAIL_CODE === '1';
