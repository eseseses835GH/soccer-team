// The split-teams edge function, minus Deno I/O (DECISIONS → "Players start an evening (v20)").
// Any member of a synced group may make teams; a player's phone never gets anyone's level, so the
// split runs here on the group's real ratings with the app's own code (splitCore + the engine), and
// only the teams go back: ids per team, keeper order, subs, and ONE total per team.
// Bundled into supabase/functions/split-teams/core.js by scripts/build-edge.mjs (committed).
import { keyOf, MAX_TEAM_SIZE, MIN_TEAM_SIZE, pickReroll, randomSeed, search, createRng } from '../engine';
import { DEFAULT_SETTINGS, type Settings } from '../state/model';
import { applyPlayerVotes, effectiveCanRate, parseRatingMode, parseVoteRows, type MemberRole } from '../state/playerVotes';
import { finishSplit, prepareSplit, teamTotals, type SplitSource } from '../state/splitCore';
import { sanitizeDoc } from '../sync/doc';

export interface SplitRequest {
  groupId: string;
  /** Roster ids here tonight. */
  present: string[];
  /** Players per team (3–7). */
  teamSize: number;
  /** Re-roll: the seed of the first split (same subs, same order) and the assignments already shown. */
  seed?: number;
  shown?: number[][];
}

/** How the group runs matches (the organizer's settings; nothing about players). */
export interface PlayRules {
  gkMode: Settings['gkMode'];
  gkSwitchGoals: number;
  matchMinutes: number;
  matchNoLimit: boolean;
  drawExtraMinutes: number;
  hasBibs: boolean;
  bibs: Settings['bibs'];
}

export interface SplitReply {
  playerIds: string[];
  subIds: string[];
  sizes: number[];
  teamSize: number;
  assignment: number[];
  gkOrder: string[][];
  /** One strength per team (sum of weighted levels, rounded). Never per player. */
  totals: number[];
  seed: number;
  rules: PlayRules;
}

export interface MemberRow {
  user_id: string;
  role: string;
  can_rate: boolean | null;
}

/** Everything the handler reads; the Deno side backs it with supabase-js (service role). */
export interface SplitDeps {
  /** The caller's login from the Authorization header (null = missing or invalid). */
  userId(): Promise<string | null>;
  role(groupId: string, userId: string): Promise<string | null>;
  group(groupId: string): Promise<{ data: unknown; rating_mode: unknown } | null>;
  members(groupId: string): Promise<MemberRow[]>;
  /** rating_votes rows: { rater, player_id, level }. */
  votes(groupId: string): Promise<unknown[]>;
  seed?(): number;
}

export type SplitError = 'auth' | 'denied' | 'invalid' | 'few' | 'gone';
export type SplitResult = { status: 200; body: SplitReply } | { status: 400 | 401 | 403 | 404; body: { error: SplitError } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** A request body, checked; null when it isn't one. */
export function parseSplitRequest(raw: unknown): SplitRequest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.groupId !== 'string' || !UUID.test(r.groupId)) return null;
  if (!Array.isArray(r.present) || r.present.length > 200 || !r.present.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 100)) return null;
  if (!isInt(r.teamSize, MIN_TEAM_SIZE, MAX_TEAM_SIZE)) return null;
  const out: SplitRequest = { groupId: r.groupId.toLowerCase(), present: [...new Set(r.present as string[])], teamSize: r.teamSize };
  if (r.seed !== undefined) {
    if (!isInt(r.seed, 0, 0xffffffff)) return null;
    out.seed = r.seed;
  }
  if (r.shown !== undefined) {
    if (!Array.isArray(r.shown) || r.shown.length > 100 || !r.shown.every((a) => Array.isArray(a) && a.length <= 200 && a.every((t) => isInt(t, 0, 7)))) return null;
    out.shown = r.shown as number[][];
  }
  return out;
}

const err = (status: 400 | 401 | 403 | 404, error: SplitError): SplitResult => ({ status, body: { error } });

export async function handleSplit(raw: unknown, deps: SplitDeps): Promise<SplitResult> {
  const uid = await deps.userId();
  if (!uid) return err(401, 'auth');
  const req = parseSplitRequest(raw);
  if (!req) return err(400, 'invalid');
  const role = await deps.role(req.groupId, uid);
  if (role !== 'organizer' && role !== 'player') return err(403, 'denied');
  const [g, members, voteRows] = await Promise.all([deps.group(req.groupId), deps.members(req.groupId), deps.votes(req.groupId)]);
  if (!g) return err(404, 'gone');

  // The roster exactly as the organizer's app has it: the doc, then players' votes on top (v18:
  // only raters allowed now count, MIN_RATERS before an average replaces the organizers' level).
  const doc = sanitizeDoc(g.data);
  const mode = parseRatingMode(g.rating_mode);
  const allowed = new Set(
    members.filter((m) => typeof m.user_id === 'string' && effectiveCanRate(m.role as MemberRole, m.can_rate ?? null, mode)).map((m) => m.user_id.toLowerCase()),
  );
  const rows = parseVoteRows(voteRows).filter((r) => allowed.has(r.rater));
  const players = applyPlayerVotes(doc.players, rows);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...doc.settings };
  const src: SplitSource = { players, presentIds: req.present, teamSize: req.teamSize, settings, constraints: doc.constraints };

  const seed = req.seed ?? deps.seed?.() ?? randomSeed();
  const prep = prepareSplit(src, seed);
  if (!prep) return err(400, 'few');
  const r = prep.req;
  const res = search(r.players, r.k, r.options, r.constraints, { seed: r.seed, sizes: r.sizes });
  let asg = res.best.assignment;
  const shown = (req.shown ?? []).filter((a) => a.length === prep.onTeams.length);
  if (shown.length && res.pool.length >= 2) {
    // Re-roll: a different near-optimal split, like the organizer's "הגרלה מחדש".
    const next = pickReroll(res.pool, shown, createRng(deps.seed?.() ?? randomSeed()));
    if (keyOf(next.assignment) !== keyOf(shown[shown.length - 1])) asg = next.assignment;
    else asg = shown[shown.length - 1];
  }
  const teams = finishSplit(src, prep, asg, seed);
  const k = teams.sizes.length;
  // Built field by field: nothing of a player but his id leaves the server.
  return {
    status: 200,
    body: {
      playerIds: teams.playerIds,
      subIds: teams.subIds,
      sizes: teams.sizes,
      teamSize: teams.teamSize,
      assignment: teams.assignment,
      gkOrder: teams.gkOrder,
      totals: teamTotals(teams.playerIds, teams.assignment, k, players, settings.weights),
      seed,
      rules: {
        gkMode: settings.gkMode,
        gkSwitchGoals: settings.gkSwitchGoals,
        matchMinutes: settings.matchMinutes,
        matchNoLimit: settings.matchNoLimit,
        drawExtraMinutes: settings.drawExtraMinutes,
        hasBibs: settings.hasBibs,
        bibs: settings.bibs,
      },
    },
  };
}

/** The app's origins (and local dev); anything else gets no CORS grant. */
export const ALLOWED_ORIGINS = ['https://www.kadoregel.com', 'https://kadoregel.com', 'https://soccer-team-tau.vercel.app'];

export function corsHeaders(origin: string | null): Record<string, string> {
  const ok = !!origin && (ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin! } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
