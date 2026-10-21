// "Login most of the time" (v13): what a logged-out phone may do, when a local group goes to the
// cloud by itself, and the server's caps in Hebrew. Pure (no React), so it is unit-tested.
import type { GroupMeta } from '../state/groups';
import type { Player } from '../state/model';

/** Own (non-sample) players a logged-out phone may have. Change here only. */
export const FREE_PLAYERS = 4;
/** Players per group, as the server allows (`players_limit`). */
export const MAX_PLAYERS = 200;

export const isSample = (id: string) => id.startsWith('sample-');
export const ownCount = (players: Pick<Player, 'id'>[]) => players.filter((p) => !isSample(p.id)).length;

export type LoginGate = 'players' | 'group';
export type GateResult = 'ok' | LoginGate | 'full';

/**
 * Adding `added` to `players`: fine, needs a login (logged out and own players would pass
 * FREE_PLAYERS), or the group is full. Sample players never count; a phone that already had more
 * than FREE_PLAYERS keeps them and only can't add more.
 */
export function gatePlayers(loggedOut: boolean, players: Pick<Player, 'id'>[], added: Pick<Player, 'id'>[]): GateResult {
  const have = new Set(players.map((p) => p.id));
  const fresh = added.filter((p) => !have.has(p.id));
  if (!fresh.length) return 'ok';
  if (players.length + fresh.length > MAX_PLAYERS) return 'full';
  const ownAdded = fresh.filter((p) => !isSample(p.id)).length;
  if (loggedOut && ownAdded > 0 && ownCount(players) + ownAdded > FREE_PLAYERS) return 'players';
  return 'ok';
}

/** Logged out: one group only ("+ קבוצה חדשה" asks to log in). */
export function gateNewGroup(loggedOut: boolean): GateResult {
  return loggedOut ? 'group' : 'ok';
}

/**
 * Logged in: the open local group goes to the cloud by itself — once it has own players, or when it
 * was created while logged in (`upload`). Never a player's group, never while an invite is being
 * joined (that login is for the invite, and the phone's empty default group isn't wanted on the server).
 */
export function shouldAutoUpload(o: { loggedIn: boolean; meta: GroupMeta | undefined; app: { players: Pick<Player, 'id'>[] }; pendingJoin: boolean }): boolean {
  const m = o.meta;
  if (!o.loggedIn || !m || m.synced || m.role === 'player' || o.pendingJoin) return false;
  return !!m.upload || ownCount(o.app.players) > 0;
}

/** What to do once the login sheet succeeds (one at a time; closing the sheet drops it). */
export function afterLoginQueue() {
  let next: (() => void) | null = null;
  return {
    set(fn: (() => void) | null) {
      next = fn;
    },
    clear() {
      next = null;
    },
    /** Runs and forgets it. */
    run() {
      const fn = next;
      next = null;
      fn?.();
      return !!fn;
    },
  };
}

/** The server's caps (SQLSTATE 54000; the message names the cap). See the `limits` migration. */
export const LIMIT_TEXT: Record<string, string> = {
  groups_limit: 'אפשר לפתוח עד 20 קבוצות בחשבון',
  memberships_limit: 'אפשר להיות בעד 50 קבוצות',
  group_full: 'הקבוצה מלאה',
  invites_limit: 'יותר מדי קישורים. בטלו אחד ונסו שוב',
  data_limit: 'הקבוצה גדולה מדי לסנכרון',
  players_limit: `עד ${MAX_PLAYERS} שחקנים בקבוצה`,
};

export function limitText(message: string | undefined): string {
  const key = Object.keys(LIMIT_TEXT).find((k) => message?.includes(k));
  return key ? LIMIT_TEXT[key] : 'הגעתם למגבלה של השרת';
}
