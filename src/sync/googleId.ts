// "המשך עם Google" with Google Identity Services (GIS) on our own page, so Google's screen names
// this site instead of the Supabase project. GIS hands us an ID token; Supabase turns it into a
// session (signInWithIdToken). The script is loaded only when the login sheet opens.

export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const LOAD_TIMEOUT_MS = 8000;

export interface GisButtonOptions {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: number;
  locale?: string;
}

export interface GisId {
  initialize(config: {
    client_id: string;
    callback?: (r: { credential?: string }) => void;
    nonce?: string;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    ux_mode?: 'popup' | 'redirect';
    login_uri?: string;
    use_fedcm_for_button?: boolean;
  }): void;
  renderButton(parent: HTMLElement, options: GisButtonOptions): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GisId } };
  }
}

/** How the Google button works on this page. */
export type GoogleMode = 'off' | 'loading' | 'gis' | 'redirect';

/**
 * - off: Google isn't enabled in the Supabase project (the sheet says so).
 * - gis: our own page talks to Google (needs a client id and a secure context for the nonce hash).
 * - redirect: the old flow through Supabase's domain (no client id, insecure context, GIS failed,
 *   or the app runs from the iPhone home screen, where Google's popup can't report back).
 * - loading: GIS is still loading; the button waits.
 */
export function googleMode(o: { clientId: string; secure: boolean; iosHomeScreen: boolean; provider: boolean | null; gis: 'loading' | 'ready' | 'failed' }): GoogleMode {
  if (o.provider === false) return 'off';
  if (!o.clientId || !o.secure || o.iosHomeScreen || o.gis === 'failed') return 'redirect';
  return o.gis === 'ready' ? 'gis' : 'loading';
}

/** Can this page hash a nonce (crypto.subtle exists only on https and localhost)? */
export function secureForGis(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && !!globalThis.crypto?.subtle;
}

/** Opened from the iOS home screen (Safari's `navigator.standalone`). */
export function iosHomeScreen(): boolean {
  return typeof navigator !== 'undefined' && (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * How Google's button reports back. Popup everywhere it works; a full-page redirect where the popup
 * can't talk to our page: every browser on iPhone/iPad (all WebKit: Safari's popup + ITP left a white
 * accounts.google.com page) and in-app browsers (WhatsApp, Instagram, Facebook, Android WebView).
 * The redirect lands on our own /api/gsi (api/gsi.ts), which hands the token back to the app.
 */
export function gisUxMode(ua: string, maxTouchPoints = 0): 'popup' | 'redirect' {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1); // iPadOS says "Macintosh"
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|; wv\)/.test(ua);
  return ios || inApp ? 'redirect' : 'popup';
}

/** Where Google posts the token in redirect mode (must be in the client's Authorized redirect URIs). */
export const gsiLoginUri = () => `${location.origin}/api/gsi`;

const GSI_KEY = 'kochot:gsi';
const GSI_TTL_MS = 15 * 60_000;

/** Before Google's page opens: the raw nonce (Supabase checks it) and where to come back to. */
export function saveGsiNonce(raw: string, back: string, now = Date.now()): void {
  try {
    sessionStorage.setItem(GSI_KEY, JSON.stringify({ raw, back, at: now }));
  } catch {
    /* storage off: Supabase will refuse the token, and the app says so */
  }
}

/** Read once, when the token comes back. */
export function takeGsiNonce(now = Date.now()): { raw: string; back: string } | null {
  try {
    const v = sessionStorage.getItem(GSI_KEY);
    sessionStorage.removeItem(GSI_KEY);
    const o = v ? (JSON.parse(v) as { raw?: unknown; back?: unknown; at?: unknown }) : null;
    if (!o || typeof o.raw !== 'string' || typeof o.at !== 'number' || now - o.at > GSI_TTL_MS) return null;
    return { raw: o.raw, back: typeof o.back === 'string' && o.back.startsWith('#') ? o.back : '' };
  } catch {
    return null;
  }
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** A fresh nonce: `raw` goes to Supabase, its SHA-256 (hex) `hashed` goes to Google (Supabase's documented pattern). */
export async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { raw, hashed: await sha256Hex(raw) };
}

let loadP: Promise<GisId> | null = null;

/** Loads Google's script once. Rejects after a timeout or a load error (and a later call tries again). */
export function loadGis(): Promise<GisId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  loadP ??= new Promise<GisId>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    const timer = window.setTimeout(() => done(new Error('gis timeout')), LOAD_TIMEOUT_MS);
    const done = (err?: Error) => {
      window.clearTimeout(timer);
      const id = window.google?.accounts?.id;
      if (!err && id) return resolve(id);
      loadP = null;
      s.remove();
      reject(err ?? new Error('gis missing'));
    };
    s.onload = () => done();
    s.onerror = () => done(new Error('gis load error'));
    document.head.appendChild(s);
  });
  return loadP;
}
