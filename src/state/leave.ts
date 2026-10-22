/**
 * "עזב באמצע": a player leaves in the middle of the evening. The mirror of a
 * late arrival (late.ts): nobody is reshuffled. He leaves his team (or the
 * bench), the keeper rotation, any borrow and today's attendance; matches
 * already played keep him in their `sides`. Then at most a small fix is
 * offered: the best-fitting sub comes in, or (no subs) one or two swaps.
 */
import { suggestSwaps, type Constraints, type EngineOptions, type SwapSuggestion } from '../engine';
import { buildProblem, cost } from '../engine/cost';
import { keeperIndex, type MatchState } from '../match/match';
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
 * New keeper order for a team whose roster changed, keeping whoever is in goal now in goal
 * (if he left, the next one in the rotation takes over). The rotation index comes from goals
 * conceded, so the list is rotated to put that keeper where the index points.
 */
export function keepKeeper(prev: string[], next: string[], conceded: number, every: number, rotate: boolean): string[] {
  if (!next.length) return next;
  const ci = rotate ? keeperIndex(conceded, every, prev.length) : 0;
  let keeper: string | undefined;
  for (let s = 0; s < prev.length && !keeper; s++) {
    const id = prev[(ci + s) % prev.length];
    if (next.includes(id)) keeper = id;
  }
  if (!keeper) return next;
  const ni = rotate ? keeperIndex(conceded, every, next.length) : 0;
  const shift = next.indexOf(keeper) - ni;
  return next.map((_, i) => next[(((i + shift) % next.length) + next.length) % next.length]);
}

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

/** A sub joins `team` (last in its keeper rotation, the keeper in goal stays). */
export function subIn(r: GameResult, m: MatchState | null, subId: string, team: number, ctx: Pick<LeaveCtx, 'rotate' | 'every'>): GameResult {
  if (!r.subIds.includes(subId) || team < 0 || team >= r.numTeams) return r;
  const prev = teamMembers(r, team);
  const gkOrder = [...r.gkOrder];
  while (gkOrder.length < r.numTeams) gkOrder.push([]);
  gkOrder[team] = keepKeeper(prev, [...prev, subId], m?.conceded[team] ?? 0, ctx.every, ctx.rotate);
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
  gkOrder[t] = keepKeeper(prev, prev.filter((x) => x !== id), m?.conceded[t] ?? 0, ctx.every, ctx.rotate);
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
        dismissed: match.dismissed?.team === t ? null : match.dismissed,
      };
    }
    return { outcome: 'toBench', team: t, result, match };
  }

  if (left < MIN_LEFT) {
    const best = bestSub(result, t, ctx);
    if (!best) return { outcome: 'blocked', team: t, result: r, match: m };
    return { outcome: 'subIn', team: t, result: subIn(result, match, best.subId, t, ctx), match, subId: best.subId };
  }
  return { outcome: 'short', team: t, result, match };
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
