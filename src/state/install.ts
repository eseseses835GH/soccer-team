// "Add to home screen" (v6): when to offer it, and which instructions fit this browser.
//
// Per-phone only: the flags live in `kochot:install` (localStorage), never in a group's state,
// the backup or the cloud. Everything here is pure; the UI glue is in ui/InstallPrompt.tsx.

export const INSTALL_KEY = 'kochot:install';
/** Opening the app again at least this long after the previous use counts as a new use. */
export const USE_GAP_MS = 12 * 3600 * 1000;
/** "אחר כך" asks again after this long. */
export const SNOOZE_MS = 7 * 864e5;

export interface InstallFlags {
  v: 1;
  /** Separate uses of the app on this phone (with players in the roster), see `recordUse`. */
  uses: number;
  /** When the current use started (ms), or 0. */
  useAt: number;
  /** "אחר כך": don't offer before this time. */
  snoozeUntil: number;
  /** "לא להציג שוב". */
  never: boolean;
  /** The browser said the app was installed (`appinstalled`). */
  installed: boolean;
}

export const NO_FLAGS: InstallFlags = { v: 1, uses: 0, useAt: 0, snoozeUntil: 0, never: false, installed: false };

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);

export function sanitizeFlags(raw: unknown): InstallFlags {
  if (!raw || typeof raw !== 'object') return NO_FLAGS;
  const r = raw as Partial<Record<keyof InstallFlags, unknown>>;
  return { v: 1, uses: Math.floor(num(r.uses)), useAt: num(r.useAt), snoozeUntil: num(r.snoozeUntil), never: r.never === true, installed: r.installed === true };
}

/**
 * The app was opened (or came back to the foreground) with players in the roster. A new use starts
 * when there was none yet, or the current one began 12+ hours ago, so one long evening (or a match
 * that runs past midnight) is a single use, and the next game day is the second.
 * A clock that went backwards also starts a new use, so a bad date can't freeze the count.
 */
export function recordUse(f: InstallFlags, now: number): InstallFlags {
  if (f.useAt && now >= f.useAt && now - f.useAt < USE_GAP_MS) return f;
  return { ...f, uses: f.uses + 1, useAt: now };
}

export interface OfferContext {
  now: number;
  /** Already running from the home screen (display-mode standalone / navigator.standalone). */
  standalone: boolean;
  /** This browser can install: a captured `beforeinstallprompt`, or iOS (manual steps). */
  canOffer: boolean;
  /** The main screen is showing (not teams, match, settings…). */
  onHome: boolean;
  /** A match clock is running. */
  clockRunning: boolean;
}

/**
 * Show the gentle "add to home screen" card? From the second use on, only on the main screen,
 * never while a match clock runs, never once installed, and not after "לא להציג שוב" or within
 * a week of "אחר כך".
 */
export function shouldOfferInstall(f: InstallFlags, c: OfferContext): boolean {
  if (c.standalone || f.installed || f.never || !c.canOffer) return false;
  if (!c.onHome || c.clockRunning) return false;
  if (f.uses < 2) return false;
  return c.now >= f.snoozeUntil;
}

export const snooze = (f: InstallFlags, now: number): InstallFlags => ({ ...f, snoozeUntil: now + SNOOZE_MS });
export const neverAgain = (f: InstallFlags): InstallFlags => ({ ...f, never: true });

/**
 * Which instructions fit:
 * - `ios`: Safari (or another iOS browser) on iPhone/iPad: share → "הוספה למסך הבית".
 * - `ios-inapp`: an app's built-in browser on iOS (Instagram, Facebook…): open in Safari first.
 * - `android`: Android without an install prompt (Samsung Internet, Firefox, or Chrome before it fires).
 * - `other`: desktop and everything else.
 */
export type InstallPlatform = 'ios' | 'ios-inapp' | 'android' | 'other';

export interface PlatformInfo {
  platform: InstallPlatform;
  /** iPad (the share button is at the top) rather than iPhone. */
  ipad: boolean;
  /** Safari itself on iOS (vs Chrome/Firefox/Edge for iOS, which share via the address bar). */
  safari: boolean;
  /** The in-app browser's name in Hebrew, when it could be recognised. */
  inApp: string | null;
}

/** In-app browsers on iOS that mark their user agent. (WhatsApp opens links in a Safari view without a mark.) */
const IN_APP: [RegExp, string][] = [
  [/Instagram/i, 'אינסטגרם'],
  [/FBAN|FBAV|FBIOS|FB_IAB|MessengerForiOS/i, 'פייסבוק'],
  [/WhatsApp/i, 'וואטסאפ'],
  [/\bLine\//i, 'Line'],
  [/Telegram/i, 'טלגרם'],
  [/Snapchat/i, 'סנאפצ׳ט'],
  [/musical_ly|TikTok|BytedanceWebview/i, 'טיקטוק'],
  [/LinkedInApp/i, 'לינקדאין'],
  [/Twitter/i, 'X'],
  [/GSA\//i, 'אפליקציית גוגל'],
];

export function detectPlatform(ua: string, maxTouchPoints = 0): PlatformInfo {
  // iPadOS 13+ says "Macintosh"; a Mac has no touch screen.
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  const ios = ipad || /iPhone|iPod/.test(ua);
  if (ios) {
    const hit = IN_APP.find(([re]) => re.test(ua));
    if (hit) return { platform: 'ios-inapp', ipad, safari: false, inApp: hit[1] };
    const safari = !/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo/i.test(ua);
    return { platform: 'ios', ipad, safari, inApp: null };
  }
  if (/Android/i.test(ua)) return { platform: 'android', ipad: false, safari: false, inApp: null };
  return { platform: 'other', ipad: false, safari: false, inApp: null };
}
