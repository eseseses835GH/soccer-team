// "הדף שלי" (DECISIONS → "My page (v17)"): who is logged in, and one claimed player's numbers
// across the history this phone already has. Pure; the screen is ui/MeScreen.tsx.
import { MIN_GAMES_FOR_PCT, sideIds, type EveningRecord } from './history';
import { matchWinner } from '../match/match';

export interface Profile {
  name: string;
  email: string;
  /** Google profile picture (https only), or null: show the first letter. */
  avatar: string | null;
  google: boolean;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** From a Supabase user: name (full_name / name / the email's local part), picture, provider. */
export function profileOf(user: { email?: string; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> } | null | undefined): Profile | null {
  if (!user) return null;
  const meta = user.user_metadata ?? {};
  const app = user.app_metadata ?? {};
  const email = str(user.email);
  const name = (str(meta.full_name) || str(meta.name) || email.split('@')[0] || '?').slice(0, 40);
  const pic = str(meta.avatar_url) || str(meta.picture);
  const providers = Array.isArray(app.providers) ? app.providers : [];
  return {
    name,
    email,
    avatar: /^(https:|data:image\/)/.test(pic) ? pic : null,
    google: app.provider === 'google' || providers.includes('google'),
  };
}

/** The circle's letter when there is no picture. */
export const initialOf = (name: string) => [...name.trim()][0]?.toUpperCase() ?? '?';

export interface MyStats {
  evenings: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals: number;
}

export const EMPTY_STATS: MyStats = { evenings: 0, played: 0, won: 0, drawn: 0, lost: 0, goals: 0 };

/** Which side of a match I was on (sides first, so a borrowed player counts for the team he played for). */
function mySide(rec: EveningRecord, mt: EveningRecord['matches'][number], id: string): number | null {
  if (sideIds(rec, mt, 0).includes(id)) return mt.a;
  if (sideIds(rec, mt, 1).includes(id)) return mt.b;
  return null;
}

/** Was I there that evening (any team, the bench, a match side or a goal)? */
export function attended(rec: EveningRecord, id: string): boolean {
  return (
    rec.players.some((p) => p.id === id) ||
    rec.subIds.includes(id) ||
    rec.teams.some((t) => t.ids.includes(id)) ||
    rec.matches.some((mt) => mySide(rec, mt, id) !== null || mt.goals.some((g) => g.by === id))
  );
}

/** One evening, for me. */
export function eveningFor(rec: EveningRecord, id: string): MyStats {
  const s = { ...EMPTY_STATS, evenings: attended(rec, id) ? 1 : 0 };
  for (const mt of rec.matches) {
    for (const g of mt.goals) if (g.by === id) s.goals++;
    const side = mySide(rec, mt, id);
    if (side === null) continue;
    s.played++;
    const w = matchWinner(mt);
    if (w === null) s.drawn++;
    else if (w === side) s.won++;
    else s.lost++;
  }
  return s;
}

export function addStats(a: MyStats, b: MyStats): MyStats {
  return { evenings: a.evenings + b.evenings, played: a.played + b.played, won: a.won + b.won, drawn: a.drawn + b.drawn, lost: a.lost + b.lost, goals: a.goals + b.goals };
}

/** All of one group's history, for its claimed player. */
export function myStats(history: EveningRecord[], id: string): MyStats {
  return history.reduce((s, rec) => addStats(s, eveningFor(rec, id)), EMPTY_STATS);
}

/** Win %, only from 5 matches up (as the all-time table). */
export function myPct(s: MyStats, min = MIN_GAMES_FOR_PCT): number | null {
  return s.played >= min ? Math.round((100 * s.won) / s.played) : null;
}

export interface RecentEvening {
  groupId: string;
  rec: EveningRecord;
  stats: MyStats;
}

/** The last evenings I played in (at least one match), newest first, across groups. */
export function recentEvenings(groups: { groupId: string; history: EveningRecord[]; playerId: string }[], n = 3): RecentEvening[] {
  return groups
    .flatMap((g) => g.history.map((rec) => ({ groupId: g.groupId, rec, stats: eveningFor(rec, g.playerId) })))
    .filter((x) => x.stats.played > 0)
    .sort((a, b) => b.rec.startedAt - a.rec.startedAt)
    .slice(0, n);
}
