/**
 * "הגיע מאוחר": someone arrives in the middle of the evening. Nobody is reshuffled, and the
 * organizer always chooses: he goes in now (into the team the app suggests, or another one),
 * or he waits on the side as a sub and the sizes stay as they are (3×3 stays 3×3).
 */
import { MAX_TEAMS, createRng, shuffle, suggestSwaps, type SwapSuggestion } from '../engine';
import type { MatchState } from '../match/match';
import { inProgress, subIn, type LeaveCtx } from './leave';
import type { GameResult, Player } from './model';

export type LateOutcome =
  /** Joined a team (one is still short, or his team is now bigger than the rest). */
  | 'joined'
  /** Completed the last short team: worth suggesting a swap or two. */
  | 'filled'
  /** Waits on the side as a sub; nothing else changes. */
  | 'bench'
  /** He and the subs are now enough to form a (short) team. */
  | 'newTeam';

/** "now" without a team = the suggested one (`nowTarget`). */
export type LateChoice = { kind: 'wait' } | { kind: 'now'; team?: number };

export interface LateJoin {
  result: GameResult;
  match: MatchState | null;
  outcome: LateOutcome;
  team: number | null;
}

const countsOf = (r: GameResult) => {
  const c = new Array<number>(r.numTeams).fill(0);
  r.assignment.forEach((t) => c[t]++);
  return c;
};

/**
 * Where "in now" goes by default: the smallest team that isn't full (normally the short one
 * waiting outside). All full: a new team if he and the subs reach the short-team threshold
 * (missing ≤ 2, the `planFormat` rule), returned as `numTeams`; otherwise the smallest team.
 * Ties go to the later team (the one outside rather than the one on the pitch).
 */
export function nowTarget(r: GameResult): number {
  const counts = countsOf(r);
  const smallest = (ok: (t: number) => boolean) => {
    let best = -1;
    for (let t = r.numTeams - 1; t >= 0; t--) if (ok(t) && (best < 0 || counts[t] < counts[best])) best = t;
    return best;
  };
  const short = smallest((t) => counts[t] < r.teamSize);
  if (short >= 0) return short;
  if (r.subIds.length + 1 >= Math.max(2, r.teamSize - 2) && r.numTeams < MAX_TEAMS) return r.numTeams;
  return smallest(() => true);
}

export function lateJoin(
  r: GameResult,
  m: MatchState | null,
  id: string,
  choice: LateChoice,
  ctx: Pick<LeaveCtx, 'rotate' | 'every'>,
  seed: number,
): LateJoin {
  if (r.playerIds.includes(id) || r.subIds.includes(id)) return { result: r, match: m, outcome: 'bench', team: null };
  const subIds = [...r.subIds, id];
  if (choice.kind === 'wait') return { result: { ...r, subIds }, match: m, outcome: 'bench', team: null };

  const t = choice.team ?? nowTarget(r);
  if (t === r.numTeams && r.numTeams < MAX_TEAMS) {
    // He and the subs become a new team, at the back of the queue (the reducer adds it to the match).
    const assignment = [...r.assignment, ...subIds.map(() => t)];
    return {
      result: {
        ...r,
        playerIds: [...r.playerIds, ...subIds],
        subIds: [],
        numTeams: t + 1,
        sizes: [...r.sizes, subIds.length],
        assignment,
        generated: assignment,
        gkOrder: [...r.gkOrder, shuffle(createRng(seed), [...subIds])],
        pool: [],
        shown: [],
      },
      match: m,
      outcome: subIds.length === r.teamSize ? 'filled' : 'newTeam',
      team: t,
    };
  }
  if (t < 0 || t >= r.numTeams) return { result: r, match: m, outcome: 'bench', team: null };

  const shortBefore = countsOf(r).some((c) => c < r.teamSize);
  // Same as a sub coming in: last in his team's keeper rotation, whoever is in goal stays there.
  const joined = subIn({ ...r, subIds }, m, id, t, ctx);
  const result = { ...joined, generated: joined.assignment };
  const counts = countsOf(result);
  // A short team with borrowers: he takes a borrower's place (that one goes back to his own team).
  let match = m;
  if (m?.borrow?.team === t && m.borrow.ids.length) {
    const ids = m.borrow.ids.slice(0, Math.max(0, r.teamSize - counts[t]));
    match = { ...m, borrow: ids.length ? { ...m.borrow, ids } : null };
  }
  const filled = shortBefore && counts.every((c) => c >= r.teamSize);
  return { result, match, outcome: filled ? 'filled' : 'joined', team: t };
}

/**
 * After he completed the teams: up to two swaps (same rule as before). The two teams of a match
 * under way, and a borrowing team and its lender, aren't touched.
 */
export function suggestAfterLate(j: LateJoin, ctx: LeaveCtx): SwapSuggestion | null {
  if (j.outcome !== 'filled') return null;
  const r = j.result;
  const m = j.match;
  const locked = new Set<number>(inProgress(m) ? m!.onPitch : []);
  if (m?.borrow?.ids.length) [m.borrow.team, m.borrow.from].forEach((x) => locked.add(x));
  if (locked.size && locked.size >= r.numTeams - 1) return null;
  const byId = new Map(ctx.players.map((p) => [p.id, p]));
  const ps = r.playerIds.map((x) => byId.get(x));
  if (!ps.every(Boolean)) return null;
  const sizes = countsOf(r).sort((a, b) => b - a);
  return suggestSwaps(ps as Player[], r.assignment, r.numTeams, ctx.options, ctx.constraints, sizes, { locked: [...locked] });
}

/**
 * "להוסיף לקבוצה…": a sub who waited joins a team on request, without anyone going out (the team
 * grows by one, e.g. 3×3 → 4×3). Never suggested by the app. Same rules as "נכנס עכשיו": last in
 * the keeper rotation, whoever is in goal stays, a team on the pitch mid-match gets him right away,
 * and into a short team with borrowers he takes a borrower's place. Attendance doesn't change (he
 * was already here), so the teams aren't "changed since the split".
 */
export function addFromBench(
  r: GameResult,
  m: MatchState | null,
  subId: string,
  team: number,
  ctx: Pick<LeaveCtx, 'rotate' | 'every'>,
): { result: GameResult; match: MatchState | null } {
  const result = subIn(r, m, subId, team, ctx);
  if (result === r) return { result: r, match: m };
  let match = m;
  if (m?.borrow?.team === team && m.borrow.ids.length) {
    const ids = m.borrow.ids.slice(0, Math.max(0, r.teamSize - countsOf(result)[team]));
    match = { ...m, borrow: ids.length ? { ...m.borrow, ids } : null };
  }
  return { result, match };
}
