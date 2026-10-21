// Taking over the live evening (DECISIONS → "Match runner handoff — server (v12)").
// Whoever takes control (a player, or an organizer taking it back) rebuilds the evening on his own
// phone from the live snapshot and runs it from there. Pure: no React, no network.
import { BIBS, type BibId, type GameResult, type Settings } from '../state/model';
import { matchWinner, type Goal, type MatchRecord, type MatchState } from '../match/match';
import { defaultSides, type LiveData, type LiveGoal, type LivePlayed } from './live';

export { iAmRunner, someoneElseRuns } from './live';

export interface LiveImport {
  result: GameResult;
  /** null = teams are made but no match has started. */
  match: MatchState | null;
  /** Team bib ids as on the runner's phone (index-aligned with the teams). */
  bibs: string[];
  /** Everyone tonight with the name at the time. */
  players: { id: string; name: string }[];
}

const goalIn = (g: LiveGoal, at: number): Goal => (g.by ? { team: g.team, scorerId: g.by, at: g.at ?? at } : { team: g.team, at: g.at ?? at });

/** A finished match from the snapshot. v10 snapshots lack the details: they are filled in as best we can. */
function recordIn(h: LivePlayed, live: LiveData, at: number): MatchRecord {
  const numTeams = live.teams.length;
  const endedAt = h.endedAt ?? at;
  const winner = matchWinner(h);
  const out = h.out !== undefined ? h.out : numTeams <= 2 ? null : winner === null ? h.b : winner === h.a ? h.b : h.a;
  const goals = h.goals
    ? h.goals.map((g) => goalIn(g, endedAt))
    : [...Array.from({ length: h.goalsA }, () => ({ team: h.a, at: endedAt })), ...Array.from({ length: h.goalsB }, () => ({ team: h.b, at: endedAt }))];
  return {
    a: h.a,
    b: h.b,
    goalsA: h.goalsA,
    goalsB: h.goalsB,
    out,
    goals,
    endedAt,
    ...(h.ms !== undefined ? { ms: h.ms } : {}),
    ...(h.borrow?.ids.length ? { borrow: { team: h.borrow.team, from: h.borrow.from, ids: [...h.borrow.ids] } } : {}),
    // v12 leaves out sides equal to the current teams; v10 sent none (the app stamps them later).
    ...(h.sides ? { sides: [[...h.sides[0]], [...h.sides[1]]] as [string[], string[]] } : h.out !== undefined ? { sides: defaultSides(live.teams, h.a, h.b, h.borrow) } : {}),
    ...(h.pens ? { pens: { ...h.pens } } : {}),
  };
}

const fill = (arr: number[] | undefined, n: number) => Array.from({ length: n }, (_, i) => arr?.[i] ?? 0);

/** Goals conceded per team from the matches (for v10 snapshots, which don't carry `conceded`). */
function concededFrom(history: MatchRecord[], goals: Goal[], onPitch: [number, number], n: number): number[] {
  const c = new Array<number>(n).fill(0);
  for (const h of history) {
    c[h.a] += h.goalsB;
    c[h.b] += h.goalsA;
  }
  for (const g of goals) c[g.team === onPitch[0] ? onPitch[1] : onPitch[0]]++;
  return c;
}

/**
 * The evening of a snapshot as the app's GameResult + MatchState. `dfltMs` = the default match
 * length of the phone that will run it (only used when the snapshot has no `rules`, i.e. v10).
 * Teams keep their keeper order; the split's alternatives (pool) are not carried, so re-roll
 * starts a fresh search.
 */
export function liveToState(live: LiveData, dfltMs: number | null = null): LiveImport {
  const n = live.teams.length;
  const playerIds = live.teams.flatMap((t) => t.ids);
  const assignment = live.teams.flatMap((t, i) => t.ids.map(() => i));
  const result: GameResult = {
    playerIds,
    subIds: [...live.subs],
    teamSize: live.teamSize,
    numTeams: n,
    sizes: live.teams.map((t) => t.ids.length).sort((a, b) => b - a),
    assignment,
    generated: [...assignment],
    pool: [],
    shown: [],
    gkOrder: live.teams.map((t) => [...t.ids]),
    createdAt: live.createdAt ?? live.at,
  };
  const out: LiveImport = { result, match: null, bibs: live.teams.map((t) => t.bib), players: live.players.map((p) => ({ ...p })) };
  const lm = live.match;
  if (!lm) return out;
  const history = lm.played.map((h) => recordIn(h, live, live.at));
  const goals = lm.goals.map((g) => goalIn(g, live.at));
  const dflt = live.rules ? live.rules.matchMs : dfltMs;
  const at = history.length;
  const borrow = lm.borrow ? { ...lm.borrow, ids: [...lm.borrow.ids] } : lm.borrowSkip ? { ...lm.borrowSkip, ids: [] } : null;
  out.match = {
    onPitch: [lm.onPitch[0], lm.onPitch[1]],
    queue: [...lm.queue],
    streak: fill(lm.streak, n),
    pitchSince: fill(lm.pitchSince, n),
    conceded: lm.conceded ? fill(lm.conceded, n) : concededFrom(history, goals, lm.onPitch, n),
    clock: { running: lm.clock.running, startedAt: lm.clock.running ? lm.clock.startedAt : null, elapsedMs: lm.clock.elapsedMs },
    goals,
    history,
    dismissed: lm.dismissed ? { ...lm.dismissed } : null,
    borrow,
    ...(lm.clock.lengthMs !== dflt ? { length: { at, ms: lm.clock.lengthMs } } : {}),
    ...(lm.extra ? { extraAt: at } : {}),
  };
  return out;
}

const sameTeams = (r: GameResult, imp: GameResult) =>
  r.numTeams === imp.numTeams &&
  r.createdAt === imp.createdAt &&
  r.subIds.length === imp.subIds.length &&
  r.subIds.every((id) => imp.subIds.includes(id)) &&
  r.playerIds.length === imp.playerIds.length &&
  r.playerIds.every((id, i) => imp.playerIds.includes(id) && imp.assignment[imp.playerIds.indexOf(id)] === r.assignment[i]);

/**
 * Taking control back: tonight on this phone becomes what was played meanwhile. The local split
 * (with its re-roll pool and history of swaps) is kept when the teams are still the same ones;
 * otherwise (swaps, late arrivals on the other phone) the snapshot's teams replace it. The keeper
 * order always follows the snapshot. The match is always the snapshot's.
 */
export function importLive(local: { result: GameResult | null }, live: LiveData, dfltMs: number | null = null): LiveImport {
  const imp = liveToState(live, dfltMs);
  if (local.result && sameTeams(local.result, imp.result)) {
    imp.result = { ...local.result, gkOrder: imp.result.gkOrder };
  }
  return imp;
}

/**
 * Settings for a phone that runs someone else's evening (a player runner): the match-running rules
 * and the team bibs of the snapshot on top of `base` (look, sounds and the rest stay his).
 */
export function settingsFromLive(base: Settings, live: LiveData): Settings {
  const real = live.teams.map((t) => t.bib).filter((b): b is BibId => BIBS.some((x) => x.id === b));
  const hasBibs = real.length > 0;
  const r = live.rules;
  return {
    ...base,
    ...(r
      ? {
          gkMode: r.gkRotate ? 'rotate' : 'fixed',
          gkSwitchGoals: r.gkEvery,
          matchNoLimit: r.matchMs === null,
          matchMinutes: r.matchMs === null ? base.matchMinutes : Math.round(r.matchMs / 60_000),
          drawExtraMinutes: r.drawExtraMinutes,
        }
      : {}),
    hasBibs,
    // Teams past the runner's bibs were numbered there: keep them numbered here too.
    bibs: !hasBibs ? base.bibs : real.length < live.teams.length ? real : [...real, ...base.bibs.filter((b) => !real.includes(b))],
  };
}
