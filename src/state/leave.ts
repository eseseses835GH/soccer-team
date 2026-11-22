/**
 * "עזב באמצע": a player leaves in the middle of the evening. The mirror of a
 * late arrival (late.ts): nobody is reshuffled. He leaves his team (or the
 * bench), the keeper rotation, any borrow and today's attendance; matches
 * already played keep him in their `sides`. Then at most a small fix is
 * offered: the best-fitting sub comes in, or (no subs) one or two swaps.
 */
import { suggestSwaps, type Constraints, type EngineOptions, type SwapSuggestion } from '../engine';
import { buildProblem, cost } from '../engine/cost';
import { keeperIndex, rotation, shiftFor, shiftOf, withShift, type MatchState } from '../match/match';
import { stampSides, teamMembers } from './history';
import type { GameResult, Player } from './model';

/** Fewer than this on a team and it can't play (same minimum as the split). */
export const MIN_LEFT = 2;

export type LeaveOutcome =
  /** He was a sub: he just leaves the bench. */
  | 'sub'
  /** His team plays one short (a sub or a swap may be offered). */
  | 'short'
  /** His team would have dropped below 2: the best sub came in right away. */
  | 'subIn'
  /** The short team waiting outside is now too small for the format: its players wait as subs. */
  | 'toBench'
  /** Not possible: a team would have fewer than 2 and nothing can fill it (re-split instead). */
  | 'blocked';

export interface LeaveCtx {
  players: Player[];
  options: EngineOptions;
  constraints: Constraints;
  /** Keepers rotate (every `every` goals conceded); otherwise the first in the order stays in goal. */
  rotate: boolean;
  every: number;
  /** Players marked "לא בשער": skipped by the rotation. */
  noGK?: ReadonlySet<string>;
}

export interface Leave {
  outcome: LeaveOutcome;
  /** His team (null if he was a sub). */
  team: number | null;
  result: GameResult;
  match: MatchState | null;
  /** With 'subIn': who came in. */
  subId?: string;
}

export type LeaveSuggestion =
  | { kind: 'sub'; team: number; subId: string; before: number; after: number }
  | { kind: 'swaps'; swaps: SwapSuggestion };

const countsOf = (r: GameResult) => {
  const c = new Array<number>(r.numTeams).fill(0);
  r.assignment.forEach((t) => c[t]++);
  return c;
};

/** A match is under way: the clock has run or someone scored. Its two teams aren't reshuffled. */
export function inProgress(m: MatchState | null): boolean {
  return !!m && (m.clock.running || m.clock.elapsedMs > 0 || m.goals.length > 0);
}

/**
 * A team's roster changed from `prev` to `next` (both in keeper order): the keeper shift that keeps
 * whoever is in goal now in goal (if he left, the next one in the rotation takes over). The order
 * itself is never turned: newcomers stay last. Returns `shift` unchanged when nobody fits.
 */
export function keepKeeper(
  prev: string[],
  next: string[],
  conceded: number,
  every: number,
  rotate: boolean,
  noGK?: ReadonlySet<string>,
  shift = 0,
  /** "לא בשער" before the change, when it changed too (default: same as `noGK`). */
  prevNoGK: ReadonlySet<string> | undefined = noGK,
): number {
  const pr = rotation(prev, prevNoGK);
  const nr = rotation(next, noGK);
  if (!pr.length || !nr.length) return shift;
  const ci = keeperIndex(rotate ? conceded : 0, every, pr.length, shift);
  for (let s = 0; s < pr.length; s++) {
    const id = pr[(ci + s) % pr.length];
    if (nr.includes(id)) return shiftFor(next, id, conceded, every, rotate, noGK) ?? shift;
  }
  return shift;
}

/**
 * After any roster change (late, left, sub, swap, keeper order): each team keeps its keeper in
 * goal, by moving its shift (the orders stay as they are). No match session: nothing to keep.
 */
export function holdKeepers(
  prev: GameResult,
  prevM: MatchState | null,
  next: GameResult,
  m: MatchState | null,
  ctx: Pick<LeaveCtx, 'rotate' | 'every' | 'noGK'> & { prevNoGK?: ReadonlySet<string> },
): MatchState | null {
  if (!m || !prevM) return m;
  const before = 'prevNoGK' in ctx ? ctx.prevNoGK : ctx.noGK;
  let out = m;
  for (let t = 0; t < Math.min(prev.numTeams, next.numTeams); t++) {
    const a = teamMembers(prev, t);
    const b = teamMembers(next, t);
    const sameGK = a.every((id) => !!before?.has(id) === !!ctx.noGK?.has(id));
    if (sameGK && a.length === b.length && a.every((id, i) => id === b[i]) && shiftOf(prevM, t) === shiftOf(m, t)) continue;
    const s = keepKeeper(a, b, prevM.conceded[t] ?? 0, ctx.every, ctx.rotate, ctx.noGK, shiftOf(prevM, t), before);
    out = withShift(out, t, s, rotation(b, ctx.noGK).length);
  }
  return out;
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Players were marked / unmarked "לא בשער" (here, or from another phone's copy of the group) while a
 * match session is open: whoever is in goal now stays in goal. Only if he himself is now "לא בשער"
 * does the next one in the rotation go in. Returns `after` (same object when nothing moves).
 */
export function holdKeepersOnNoGK<S extends { players: readonly Player[]; result: GameResult | null; match: MatchState | null; settings: { gkMode: string; gkSwitchGoals: number } }>(
  before: Pick<S, 'players' | 'result' | 'match'>,
  after: S,
): S {
  if (!after.match || !after.result || !before.match || !before.result) return after;
  const a = noGKOf(before.players);
  const b = noGKOf(after.players);
  if (sameSet(a, b)) return after;
  const match = holdKeepers(before.result, before.match, after.result, after.match, {
    rotate: after.settings.gkMode === 'rotate',
    every: after.settings.gkSwitchGoals,
    noGK: b,
    prevNoGK: a,
  });
  return match === after.match ? after : { ...after, match };
}
const noGKOf = (players: readonly Player[]) => new Set(players.filter((p) => p.noGK).map((p) => p.id));

function engineRoster(ctx: LeaveCtx, ids: string[]) {
  const byId = new Map(ctx.players.map((p) => [p.id, p]));
  const ps = ids.map((id) => byId.get(id));
  return ps.every(Boolean) ? (ps as Player[]) : null;
}

function costOf(ctx: LeaveCtx, r: GameResult, playerIds = r.playerIds, assignment = r.assignment): number | null {
  const ps = engineRoster(ctx, playerIds);
  if (!ps) return null;
  const c = new Array<number>(r.numTeams).fill(0);
  assignment.forEach((t) => c[t]++);
  return cost(buildProblem(ps, r.numTeams, ctx.options, ctx.constraints, c.sort((a, b) => b - a)), assignment);
}

/** The sub who fits `team` best (lowest balance cost with him in it). Ties: first on the bench. */
export function bestSub(r: GameResult, team: number, ctx: LeaveCtx): { subId: string; before: number; after: number } | null {
  const before = costOf(ctx, r);
  if (before === null) return null;
  let best: { subId: string; before: number; after: number } | null = null;
  for (const id of r.subIds) {
    const after = costOf(ctx, r, [...r.playerIds, id], [...r.assignment, team]);
    if (after !== null && (!best || after < best.after - 1e-9)) best = { subId: id, before, after };
  }
  return best;
}

/** A sub joins `team`, last in its keeper order (`holdKeepers` keeps the keeper in goal). */
export function subIn(r: GameResult, subId: string, team: number): GameResult {
  if (!r.subIds.includes(subId) || team < 0 || team >= r.numTeams) return r;
  const gkOrder = [...r.gkOrder];
  while (gkOrder.length < r.numTeams) gkOrder.push([]);
  gkOrder[team] = [...teamMembers(r, team), subId];
  return {
    ...r,
    playerIds: [...r.playerIds, subId],
    assignment: [...r.assignment, team],
    generated: [...r.generated, team],
    subIds: r.subIds.filter((id) => id !== subId),
    gkOrder,
    pool: [],
    shown: [],
  };
}

/**
 * Remove `id` from tonight's teams. Returns null if he isn't in them. Matches already played
 * keep him in their `sides`; the match on the pitch is credited to whoever finishes it.
 */
export function leaveEarly(r: GameResult, m: MatchState | null, id: string, ctx: LeaveCtx): Leave | null {
  // Old records without `sides` would fall back to the final rosters (without him): stamp them first.
  const match0 = m ? stampSides(m, 0, r) : null;

  if (r.subIds.includes(id)) {
    return { outcome: 'sub', team: null, result: { ...r, subIds: r.subIds.filter((x) => x !== id) }, match: match0 };
  }
  const i = r.playerIds.indexOf(id);
  if (i < 0) return null;
  const t = r.assignment[i];
  const left = countsOf(r)[t] - 1;
  const drop = <T>(arr: T[]) => arr.filter((_, k) => k !== i);
  const prev = teamMembers(r, t);
  const gkOrder = [...r.gkOrder];
  while (gkOrder.length < r.numTeams) gkOrder.push([]);
  gkOrder[t] = prev.filter((x) => x !== id);
  let result: GameResult = {
    ...r,
    playerIds: drop(r.playerIds),
    assignment: drop(r.assignment),
    generated: r.generated.length === r.assignment.length ? drop(r.generated) : drop(r.assignment),
    gkOrder,
    pool: [],
    shown: [],
  };
  let match = match0;
  // A borrowed player who leaves: if nobody is left borrowed, the borrow step asks again.
  if (match?.borrow?.ids.includes(id)) {
    const ids = match.borrow.ids.filter((x) => x !== id);
    match = { ...match, borrow: ids.length ? { ...match.borrow, ids } : null };
  }

  // The short team outside, now smaller than the format allows (a remainder missing more than 2
  // becomes subs, see planFormat): its players wait on the bench. Only the last team, not on the
  // pitch and not in any match yet, so no team changes colour and the history stays as it was.
  const threshold = Math.max(MIN_LEFT, r.teamSize - 2);
  const k = r.numTeams;
  const played = !!m && (m.onPitch.includes(t) || m.history.some((h) => h.a === t || h.b === t));
  if (left < threshold && !r.subIds.length && k > 2 && t === k - 1 && !played) {
    const rest = teamMembers(result, t);
    const keep = result.assignment.map((x) => x !== t);
    result = {
      ...result,
      playerIds: result.playerIds.filter((_, k2) => keep[k2]),
      assignment: result.assignment.filter((_, k2) => keep[k2]),
      generated: result.generated.filter((_, k2) => keep[k2]),
      subIds: [...result.subIds, ...rest],
      numTeams: k - 1,
      sizes: result.sizes.slice(0, k - 1),
      gkOrder: result.gkOrder.slice(0, k - 1),
    };
    if (match) {
      match = {
        ...match,
        queue: match.queue.filter((x) => x !== t),
        streak: match.streak.slice(0, k - 1),
        pitchSince: match.pitchSince.slice(0, k - 1),
        conceded: match.conceded.slice(0, k - 1),
        ...(match.gkShift ? { gkShift: match.gkShift.slice(0, k - 1) } : {}),
        dismissed: match.dismissed?.team === t ? null : match.dismissed,
      };
    }
    return { outcome: 'toBench', team: t, result, match: holdKeepers(r, m, result, match, ctx) };
  }

  if (left < MIN_LEFT) {
    const best = bestSub(result, t, ctx);
    if (!best) return { outcome: 'blocked', team: t, result: r, match: m };
    const joined = subIn(result, best.subId, t);
    return { outcome: 'subIn', team: t, result: joined, match: holdKeepers(r, m, joined, match, ctx), subId: best.subId };
  }
  return { outcome: 'short', team: t, result, match: holdKeepers(r, m, result, match, ctx) };
}

/**
 * Which kind of leave this is, for the confirm step and the follow-up:
 * - 'sub': he was on the bench (he just goes, nothing offered);
 * - 'live': his team is on the pitch in a match under way (a sub may come in now, never a swap);
 * - 'off': his team is outside, or it's between matches (a sub, else at most a swap away from the
 *   pitch and the next team in).
 */
export type LeaveCase = 'sub' | 'live' | 'off';

export function leaveCase(r: GameResult, m: MatchState | null, id: string): LeaveCase | null {
  if (r.subIds.includes(id)) return 'sub';
  const i = r.playerIds.indexOf(id);
  if (i < 0) return null;
  return inProgress(m) && m!.onPitch.includes(r.assignment[i]) ? 'live' : 'off';
}

/**
 * Teams a swap after someone left never touches: once there is a match session, the two on the
 * pitch and the next one to come on (`queue[0]`), and a borrowing team and its lender. Before
 * any session (`m` null) nothing is locked: the evening hasn't started.
 */
export function lockedAfterLeave(m: MatchState | null): number[] {
  if (!m) return [];
  const locked = new Set<number>(m.onPitch);
  if (m.queue.length) locked.add(m.queue[0]);
  if (m.borrow?.ids.length) [m.borrow.team, m.borrow.from].forEach((x) => locked.add(x));
  return [...locked];
}

/**
 * The small fix offered after someone left a team: the best sub for his team (also mid-match:
 * that's what subs are for), otherwise up to two swaps among teams not in `lockedAfterLeave`.
 * His team on the pitch mid-match and no sub: they play one short. Null when there's nothing
 * worth offering.
 */
export function suggestAfterLeave(l: Leave, ctx: LeaveCtx): LeaveSuggestion | null {
  if (l.outcome !== 'short' || l.team === null) return null;
  const r = l.result;
  const t = l.team;
  if (countsOf(r)[t] >= r.teamSize) return null;
  if (r.subIds.length) {
    const best = bestSub(r, t, ctx);
    return best ? { kind: 'sub', team: t, ...best } : null;
  }
  const locked = new Set<number>(lockedAfterLeave(l.match));
  if (locked.has(t) || locked.size >= r.numTeams - 1) return null;
  const ps = engineRoster(ctx, r.playerIds);
  if (!ps) return null;
  const sizes = countsOf(r).sort((a, b) => b - a);
  const swaps = suggestSwaps(ps, r.assignment, r.numTeams, ctx.options, ctx.constraints, sizes, { locked: [...locked] });
  return swaps ? { kind: 'swaps', swaps } : null;
}

/** Several left at once ("N עזבו"): what happened to each, and where things stand after all of them. */
export interface LeaveMany {
  result: GameResult;
  match: MatchState | null;
  /** Who is out (in the order picked). */
  gone: string[];
  /** Who couldn't leave: his team would have dropped below 2 with nobody to fill it (re-split instead). */
  blocked: string[];
  /** Subs who came in on their own because a team dropped below 2. */
  subIns: string[];
  /** The team to offer one small fix for (the shortest team someone left), or null. */
  short: number | null;
}

/**
 * Several players leave in one go: the same rules as one at a time (leaveEarly, in the order
 * picked), then one follow-up at the end for the shortest team they left (suggestAfterLeave on
 * `asLeave`). Nobody is reshuffled.
 */
export function leaveMany(r: GameResult, m: MatchState | null, ids: string[], ctx: LeaveCtx): LeaveMany {
  let result = r;
  let match = m;
  const out: LeaveMany = { result, match, gone: [], blocked: [], subIns: [], short: null };
  const touched = new Set<number>();
  for (const id of [...new Set(ids)]) {
    const l = leaveEarly(result, match, id, ctx);
    if (!l) continue;
    if (l.outcome === 'blocked') {
      out.blocked.push(id);
      continue;
    }
    // A short team outside that went to the bench is gone: team numbers past it don't exist (it's the last one).
    if (l.outcome === 'toBench' && l.team !== null) touched.delete(l.team);
    if (l.outcome === 'short' && l.team !== null) touched.add(l.team);
    if (l.outcome === 'subIn' && l.subId) out.subIns.push(l.subId);
    result = l.result;
    match = l.match;
    out.gone.push(id);
  }
  const counts = countsOf(result);
  const short = [...touched].filter((t) => t < result.numTeams && counts[t] < result.teamSize).sort((a, b) => counts[a] - counts[b] || a - b);
  return { ...out, result, match, short: short[0] ?? null };
}

/** The end of a LeaveMany as one leave, for suggestAfterLeave / subsAfterLeave (null: nothing to offer). */
export function asLeave(l: LeaveMany): Leave | null {
  return l.short === null ? null : { outcome: 'short', team: l.short, result: l.result, match: l.match };
}
