import { teamSizes } from './sizes';

export const MIN_TEAM_SIZE = 3;
export const MAX_TEAM_SIZE = 11;
export const MAX_TEAMS = 8;

export interface FormatPlan {
  /** Team sizes, largest first. Teams 0 and 1 start on the pitch. */
  sizes: number[];
  /** Players left out as substitutes (not on any team). */
  subs: number;
  /** True when there weren't enough players for the chosen size (e.g. 8 for 5-a-side → 4v4). */
  reduced: boolean;
  /** True when the last team is short and borrows players from the losing team. */
  shortWaiting: boolean;
}

/**
 * Plan teams for "winner stays" pickup games, given the chosen players per team.
 *
 * - Fill as many full teams as possible.
 * - A remainder that is close to a full team (missing at most 2 players, and
 *   at least 2 players) becomes a short "waiting" team that borrows from the
 *   team that loses: 14 players, 5-a-side → 5 · 5 · 4.
 * - A smaller remainder stays out as substitutes: 11 players, 5-a-side → 5 · 5 + 1 sub.
 * - With fewer than two full teams, split everyone into two even teams instead.
 */
export function planFormat(n: number, size: number): FormatPlan | null {
  if (n < 4) return null;
  const s = Math.min(MAX_TEAM_SIZE, Math.max(MIN_TEAM_SIZE, Math.round(size)));
  let full = Math.floor(n / s);
  let r = n % s;
  if (full < 2) return { sizes: teamSizes(n, 2), subs: 0, reduced: true, shortWaiting: false };
  if (full > MAX_TEAMS) {
    r += (full - MAX_TEAMS) * s;
    full = MAX_TEAMS;
    return { sizes: new Array(full).fill(s), subs: r, reduced: false, shortWaiting: false };
  }
  const sizes = new Array<number>(full).fill(s);
  if (r === 0) return { sizes, subs: 0, reduced: false, shortWaiting: false };
  if (r >= Math.max(2, s - 2) && full < MAX_TEAMS) {
    return { sizes: [...sizes, r], subs: 0, reduced: false, shortWaiting: true };
  }
  return { sizes, subs: r, reduced: false, shortWaiting: false };
}

/** Hebrew one-liner, e.g. "5 נגד 5 · 4 מחכים" / "5 נגד 5 + מחליף". */
export function describePlan(p: FormatPlan): string {
  const [a, b, ...rest] = p.sizes;
  let s = `${a} נגד ${b}`;
  if (rest.length === 1) s += ` · ${rest[0] === a ? 'קבוצה' : `${rest[0]}`} בחוץ`;
  else if (rest.length > 1) s += ` · ${rest.length} קבוצות בחוץ`;
  if (p.subs === 1) s += ' + מחליף';
  else if (p.subs > 1) s += ` + ${p.subs} מחליפים`;
  return s;
}
