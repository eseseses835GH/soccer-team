// The guided tour (coach marks) and the "design your card" invite: when to offer them (pure) and the
// per-phone flags. DECISIONS → "v36: tour + card invite".
import { loadJSON, saveJSON } from '../state/storage';

export type TourKind = 'org' | 'player';

/** Per phone: the tour was offered (or taken) once, separately for organizer and player. */
export const tourKey = (k: TourKind) => `kochot:tour:${k}`;
/** Per phone and group: the card invite was answered ("לעצב" / "אחר כך"). */
export const cardInviteKey = (gid: string) => `kochot:card-invite:${gid}`;

/** A player group joined this recently on this phone counts as new (the player tour). */
export const NEW_GROUP_MS = 3 * 864e5;

export interface TourStep {
  /** `data-tour` of the element. */
  target: string;
  text: string;
}

export const ORG_STEPS: TourStep[] = [
  { target: 'attend', text: 'מסמנים מי הגיע היום' },
  { target: 'size', text: 'כמה שחקנים בכל קבוצה' },
  { target: 'split', text: 'לוחצים, ומקבלים קבוצות שוות' },
  { target: 'players', text: 'כאן מוסיפים ועורכים שחקנים' },
  { target: 'cards', text: 'הקלפים של כולם' },
  { target: 'group', text: 'כאן מזמינים חברים ומחליפים קבוצה' },
];

export const PLAYER_STEPS: TourStep[] = [
  { target: 'tonight', text: 'כאן רואים את הערב ואת הקבוצות' },
  { target: 'rate', text: 'מדרגים את החברים, בעילום שם' },
  { target: 'cards', text: 'הקלפים של כולם' },
  { target: 'me', text: 'הדף שלך. כאן מעצבים את הקלף שלך' },
];

export const stepsFor = (k: TourKind) => (k === 'org' ? ORG_STEPS : PLAYER_STEPS);

/** Only the steps whose element is on the page. */
export function availableSteps(steps: TourStep[], has: (target: string) => boolean): TourStep[] {
  return steps.filter((s) => has(s.target));
}

export interface TourOfferContext {
  kind: TourKind;
  /** Offered before on this phone. */
  seen: boolean;
  /** An evening / match is on. */
  matchOn: boolean;
  /** Organizer: players in the roster (the empty roster has the welcome instead). */
  players: number;
  /** Organizer: separate uses of the app on this phone (`kochot:install`). */
  uses: number;
  /** Player: how long ago this phone got the group (ms). */
  groupAge: number;
}

/**
 * Offer "סיור קצר?" once to someone new: an organizer on his first use with a roster (right after the
 * welcome sheet, or a fresh co-organizer), a player in a group he just joined.
 */
export function shouldOfferTour(c: TourOfferContext): boolean {
  if (c.seen || c.matchOn) return false;
  if (c.kind === 'org') return c.players > 0 && c.uses <= 1;
  return c.groupAge >= 0 && c.groupAge < NEW_GROUP_MS;
}

export interface CardInviteContext {
  synced: boolean;
  /** My claimed player in this group (null / undefined: none or unknown). */
  playerId: string | null | undefined;
  hasPhoto: boolean;
  /** "לעצב" / "אחר כך" before, on this phone. */
  answered: boolean;
  /** The tour was offered or taken in this session. */
  tourSession: boolean;
  matchOn: boolean;
}

export function shouldInviteCard(c: CardInviteContext): boolean {
  return c.synced && !!c.playerId && !c.hasPhoto && !c.answered && !c.tourSession && !c.matchOn;
}

const PAD = 6;

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** The spotlight: the element's box with a little air, kept on screen and at most 45% of its height. */
export function spotBox(r: Box, vw: number, vh: number): Box {
  const top = Math.max(4, r.top - PAD);
  const bottom = Math.min(vh - 4, r.top + r.height + PAD, top + vh * 0.45);
  const left = Math.max(4, r.left - PAD);
  const right = Math.min(vw - 4, r.left + r.width + PAD);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

const GUTTER = 16;

/** The bubble: under the spotlight when it fits, else above, else at the bottom; never off a narrow screen. */
export function bubbleAt(box: Box, vw: number, vh: number, h: number): { left: number; top: number; width: number } {
  const width = Math.min(300, vw - GUTTER * 2);
  const cx = box.left + box.width / 2;
  const left = Math.min(Math.max(GUTTER, cx - width / 2), vw - GUTTER - width);
  const below = box.top + box.height + 12;
  const above = box.top - 12 - h;
  const top = below + h <= vh - GUTTER ? below : above >= GUTTER ? above : Math.max(GUTTER, vh - GUTTER - h);
  return { left, top, width };
}

// --- Flags (never throw: storage.ts) ---

let tourSession = false;
export const tourThisSession = () => tourSession;

export const tourSeen = (k: TourKind) => loadJSON<boolean>(tourKey(k)) === true;
export function markTourOffered(k: TourKind) {
  tourSession = true;
  saveJSON(tourKey(k), true);
}

export const cardInviteAnswered = (gid: string) => loadJSON<boolean>(cardInviteKey(gid)) === true;
export const answerCardInvite = (gid: string) => saveJSON(cardInviteKey(gid), true);

// --- Starting the tour from anywhere (the offer card, help) ---

const START = 'kochot:tour-start';
let pending = false;

/** Ask the home screen's tour to start (now, or when home mounts). */
export function startTour() {
  tourSession = true;
  pending = true;
  window.dispatchEvent(new Event(START));
}
export function takePendingTour(): boolean {
  const p = pending;
  pending = false;
  return p;
}
export function onTourStart(f: () => void): () => void {
  window.addEventListener(START, f);
  return () => window.removeEventListener(START, f);
}
