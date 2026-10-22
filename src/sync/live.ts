// The live evening (DECISIONS → "Players, live evening, rating permission — server (v10)" and
// "Match runner handoff — server (v12)").
// The phone that runs the evening (the runner: an organizer's, or a member's who took control) publishes a small JSON snapshot (LiveData) to
// group_live whenever something on the match screen changes (teams, goal, clock start/pause, end of
// match, borrow…), not every second: readers tick the clock themselves from `clock`. Everyone in
// the group reads it read-only. Only the runner may write (`runner` on the row); anyone takes over
// with takeControl(). The snapshot carries enough (createdAt, rules, full match records) for the
// next runner to rebuild the evening locally (control.ts). No ratings, ever: liveFromState() only
// copies ids, names, match-running settings and the match.
import type { SupabaseClient } from '@supabase/supabase-js';
import { teamMembers } from '../state/history';
import { defaultMatchMs, teamBibs, type GameResult, type Settings } from '../state/model';
import { inDrawExtraTime, keeperIndex, matchLength, score, type MatchState, type Pens } from '../match/match';
import { fail } from './supabase';

export interface LiveClock {
  running: boolean;
  /** Publisher's Date.now() when the clock was (re)started; null while paused. */
  startedAt: number | null;
  /** Time on the clock before `startedAt`. */
  elapsedMs: number;
  /** This match's length; null = no time limit (count up). */
  lengthMs: number | null;
}

export interface LiveTeam {
  /** Bib id like the history's (`red`, `n2`…): render with bibLook(bib, index). */
  bib: string;
  /** Roster in keeper order. */
  ids: string[];
  /** Who is in goal right now (null for an empty team). */
  keeper: string | null;
}

export interface LiveMatch {
  /** 1-based number of the match on the pitch. */
  n: number;
  /** Team indexes (into `teams`) on the pitch. */
  onPitch: [number, number];
  /** Team indexes waiting, next first. */
  queue: number[];
  /** Goals of onPitch[0], onPitch[1]. */
  score: [number, number];
  /** This match's goals, oldest first (`by` = scorer's player id when someone picked one). */
  goals: { team: number; by?: string }[];
  clock: LiveClock;
  /** In the automatic extra time for a draw. */
  extra: boolean;
  /** Players borrowed from the losing team for this match: `ids` play for `team`. */
  borrow: { team: number; from: number; ids: string[] } | null;
  /** v12: the borrow step was skipped for this match (decided, nobody borrowed). */
  borrowSkip?: { team: number; from: number };
  /** Consecutive wins of each team in its current stay on the pitch. */
  streak: number[];
  /** v12: match number at which each team (last) came onto the pitch. */
  pitchSince?: number[];
  /** v12: goals conceded per team tonight (drives keeper rotation). */
  conceded?: number[];
  /** v12: dominance hint dismissed on the runner's phone. */
  dismissed?: { team: number; atMatch: number } | null;
  /** Tonight's finished matches, oldest first. */
  played: LivePlayed[];
}

export interface LiveGoal {
  team: number;
  /** Scorer's player id, when someone picked one. */
  by?: string;
  /** v12: when it was scored (runner's Date.now()). */
  at?: number;
}

/** A finished match. v10 publishers send only a, b, goalsA, goalsB, pens; the rest is v12. */
export interface LivePlayed {
  a: number;
  b: number;
  goalsA: number;
  goalsB: number;
  pens?: Pens;
  /** Team that left the pitch (null = nobody waits). */
  out?: number | null;
  goals?: LiveGoal[];
  endedAt?: number;
  /** Clock time of the match. */
  ms?: number;
  borrow?: { team: number; from: number; ids: string[] };
  /** Who played for a and b; v12 sends it only when it differs from `defaultSides` (teams changed since). */
  sides?: [string[], string[]];
}

/** v12: the runner's settings that change how the match runs (never anything about players). */
export interface LiveRules {
  gkRotate: boolean;
  /** Keepers rotate every N goals conceded. */
  gkEvery: number;
  /** Default length of a new match; null = no limit. */
  matchMs: number | null;
  /** Extra time once on a draw (0 = off). */
  drawExtraMinutes: number;
}

export interface LiveData {
  v: 1;
  /** Publisher's Date.now() at publish. */
  at: number;
  /** v12: GameResult.createdAt of these teams (keeps the evening's id, see eveningId). */
  createdAt?: number;
  /** v12: how the runner runs matches. */
  rules?: LiveRules;
  teamSize: number;
  /** Everyone tonight (teams, subs, borrowed) with the name at the time. */
  players: { id: string; name: string }[];
  /** v15: who played earlier tonight (in a finished match or the current one) and left since, with the name at the time. */
  gone?: { id: string; name: string }[];
  teams: LiveTeam[];
  /** Present but not on a team. */
  subs: string[];
  /** null = teams are made but no match has started. */
  match: LiveMatch | null;
}

/** What live_get / the realtime subscription delivers. */
export interface LiveRow {
  data: LiveData;
  updatedBy: string | null;
  /** Display name of whoever wrote last. */
  byName: string;
  updatedAt: string;
  /** v12: the login whose phone runs the evening (only it may write); null = nobody. */
  runner: string | null;
  /** Its display name ("רץ בטלפון של …"). */
  runnerName: string;
  runnerSince: string | null;
  /** Goes up on every change of the row; pass it to set() to write only on top of what you saw. */
  rev: number;
}

export interface LiveInput {
  result: GameResult | null;
  match: MatchState | null;
  players: { id: string; name: string }[];
  settings: Settings;
  now: number;
}

const goalOut = (g: { team: number; scorerId?: string; at: number }): LiveGoal =>
  g.scorerId ? { team: g.team, by: g.scorerId, at: g.at } : { team: g.team, at: g.at };

/** Who played for a and b when nobody changed the teams since: the rosters plus that match's borrowers. */
export function defaultSides(teams: { ids: string[] }[], a: number, b: number, borrow?: { team: number; ids: string[] } | null): [string[], string[]] {
  const side = (t: number) => [...(teams[t]?.ids ?? []), ...(borrow?.team === t ? borrow.ids : [])];
  return [side(a), side(b)];
}

const sameList = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
const sameSides = (s: [string[], string[]], teams: { ids: string[] }[], a: number, b: number, borrow?: { team: number; ids: string[] } | null) => {
  const d = defaultSides(teams, a, b, borrow);
  return sameList(s[0], d[0]) && sameList(s[1], d[1]);
};

/** The snapshot to publish, from the organizer's app state; null when there are no teams. Pure. */
export function liveFromState({ result: r, match: m, players, settings, now }: LiveInput): LiveData | null {
  if (!r) return null;
  const bibs = teamBibs(settings, r.numTeams);
  const rotate = settings.gkMode === 'rotate';
  const teams: LiveTeam[] = Array.from({ length: r.numTeams }, (_, t) => {
    const ids = teamMembers(r, t);
    const idx = m && rotate ? keeperIndex(m.conceded[t] ?? 0, settings.gkSwitchGoals, ids.length) : 0;
    return { bib: bibs[t], ids, keeper: ids[idx] ?? null };
  });
  const tonight = new Set([...r.playerIds, ...r.subIds, ...(m?.borrow?.ids ?? [])]);
  const out: LiveData = {
    v: 1,
    at: now,
    createdAt: r.createdAt,
    rules: { gkRotate: rotate, gkEvery: settings.gkSwitchGoals, matchMs: defaultMatchMs(settings), drawExtraMinutes: settings.drawExtraMinutes },
    teamSize: r.teamSize,
    players: players.filter((p) => tonight.has(p.id)).map((p) => ({ id: p.id, name: p.name })),
    teams,
    subs: [...r.subIds],
    match: null,
  };
  if (m) {
    const [a, b] = m.onPitch;
    out.match = {
      n: m.history.length + 1,
      onPitch: [a, b],
      queue: [...m.queue],
      score: score(m),
      goals: m.goals.filter((g) => g.team === a || g.team === b).map(goalOut),
      clock: {
        running: m.clock.running,
        startedAt: m.clock.running ? m.clock.startedAt : null,
        elapsedMs: m.clock.elapsedMs,
        lengthMs: matchLength(m, defaultMatchMs(settings)),
      },
      extra: inDrawExtraTime(m),
      borrow: m.borrow && m.borrow.ids.length ? { team: m.borrow.team, from: m.borrow.from, ids: [...m.borrow.ids] } : null,
      ...(m.borrow && !m.borrow.ids.length ? { borrowSkip: { team: m.borrow.team, from: m.borrow.from } } : {}),
      streak: [...m.streak],
      pitchSince: [...m.pitchSince],
      conceded: [...m.conceded],
      dismissed: m.dismissed ? { ...m.dismissed } : null,
      played: m.history.map((h) => ({
        a: h.a,
        b: h.b,
        goalsA: h.goalsA,
        goalsB: h.goalsB,
        ...(h.pens ? { pens: { ...h.pens } } : {}),
        out: h.out,
        goals: h.goals.map(goalOut),
        endedAt: h.endedAt,
        ...(typeof h.ms === 'number' ? { ms: h.ms } : {}),
        ...(h.borrow?.ids.length ? { borrow: { team: h.borrow.team, from: h.borrow.from, ids: [...h.borrow.ids] } } : {}),
        // Only when they differ from today's teams (+ that match's borrow), which the reader assumes otherwise.
        ...(h.sides && !sameSides(h.sides, teams, h.a, h.b, h.borrow) ? { sides: [[...h.sides[0]], [...h.sides[1]]] as [string[], string[]] } : {}),
      })),
    };
    // Left during the evening: still named in the matches played (sides, scorers), no longer tonight.
    const was = new Set([...m.history.flatMap((h) => [...(h.sides?.flat() ?? []), ...h.goals.map((g) => g.scorerId)]), ...m.goals.map((g) => g.scorerId)]);
    const gone = players.filter((p) => was.has(p.id) && !tonight.has(p.id)).map((p) => ({ id: p.id, name: p.name }));
    if (gone.length) out.gone = gone;
  }
  return out;
}

/** Time on the live clock at `now` (readers tick this locally; phones' clocks are assumed in step). */
export function liveClockMs(c: LiveClock, now: number): number {
  return c.elapsedMs + (c.running && c.startedAt !== null ? Math.max(0, now - c.startedAt) : 0);
}

// ---------- reading (never trust the wire) ----------

const int = (v: unknown, lo = 0, hi = 1e15): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const ints = (v: unknown, max: number): number[] => (Array.isArray(v) ? v.filter((x): x is number => int(x, 0, max) !== null) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

const goalsIn = (v: unknown, k: number): LiveGoal[] =>
  (Array.isArray(v) ? v : [])
    .map(rec)
    .filter((g): g is Record<string, unknown> => !!g && int(g.team, 0, k) !== null)
    .map((g) => ({ team: g.team as number, ...(typeof g.by === 'string' ? { by: g.by } : {}), ...(int(g.at) !== null ? { at: g.at as number } : {}) }));

const borrowIn = (b: Record<string, unknown> | null, k: number) =>
  b && int(b.team, 0, k) !== null && int(b.from, 0, k) !== null ? { team: b.team as number, from: b.from as number, ids: strs(b.ids) } : null;

export function sanitizeLive(raw: unknown): LiveData | null {
  const r = rec(raw);
  if (!r || r.v !== 1 || !Array.isArray(r.teams)) return null;
  const teams: LiveTeam[] = r.teams.map((t, i) => {
    const o = rec(t) ?? {};
    const ids = strs(o.ids);
    return { bib: typeof o.bib === 'string' ? o.bib : `n${i + 1}`, ids, keeper: typeof o.keeper === 'string' && ids.includes(o.keeper) ? o.keeper : null };
  });
  const k = teams.length - 1;
  const named = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .map(rec)
      .filter((p): p is Record<string, unknown> => !!p && typeof p.id === 'string' && typeof p.name === 'string')
      .map((p) => ({ id: p.id as string, name: p.name as string }));
  const players = named(r.players);
  const out: LiveData = { v: 1, at: int(r.at) ?? 0, teamSize: int(r.teamSize, 1, 50) ?? 5, players, teams, subs: strs(r.subs), match: null };
  const gone = named(r.gone);
  if (gone.length) out.gone = gone;
  if (int(r.createdAt) !== null) out.createdAt = r.createdAt as number;
  const ru = rec(r.rules);
  if (ru) {
    out.rules = {
      gkRotate: ru.gkRotate !== false,
      gkEvery: int(ru.gkEvery, 1, 50) ?? 1,
      matchMs: ru.matchMs === null ? null : (int(ru.matchMs, 1) ?? 8 * 60_000),
      drawExtraMinutes: int(ru.drawExtraMinutes, 0, 60) ?? 0,
    };
  }
  const m = rec(r.match);
  if (m && k >= 1) {
    const pitch = ints(m.onPitch, k);
    if (pitch.length !== 2) return out;
    const c = rec(m.clock) ?? {};
    const sc = ints(m.score, 1000);
    const b = rec(m.borrow);
    const skip = borrowIn(rec(m.borrowSkip), k);
    const dis = rec(m.dismissed);
    out.match = {
      n: int(m.n, 1, 10000) ?? 1,
      onPitch: [pitch[0], pitch[1]],
      queue: ints(m.queue, k),
      score: sc.length === 2 ? [sc[0], sc[1]] : [0, 0],
      goals: goalsIn(m.goals, k),
      clock: {
        running: c.running === true && int(c.startedAt) !== null,
        startedAt: c.running === true ? int(c.startedAt) : null,
        elapsedMs: int(c.elapsedMs) ?? 0,
        lengthMs: int(c.lengthMs, 1) ?? null,
      },
      extra: m.extra === true,
      borrow: borrowIn(b, k),
      ...(skip ? { borrowSkip: { team: skip.team, from: skip.from } } : {}),
      streak: ints(m.streak, 10000),
      ...(Array.isArray(m.pitchSince) ? { pitchSince: ints(m.pitchSince, 10000) } : {}),
      ...(Array.isArray(m.conceded) ? { conceded: ints(m.conceded, 100000) } : {}),
      ...(m.dismissed === null || dis
        ? { dismissed: dis && int(dis.team, 0, k) !== null ? { team: dis.team as number, atMatch: int(dis.atMatch, 0, 10000) ?? 0 } : null }
        : {}),
      played: (Array.isArray(m.played) ? m.played : [])
        .map(rec)
        .filter((h): h is Record<string, unknown> => !!h && int(h.a, 0, k) !== null && int(h.b, 0, k) !== null)
        .map((h) => {
          const pens = rec(h.pens);
          const winner = pens ? int(pens.winner, 0, k) : null;
          const sides = Array.isArray(h.sides) && h.sides.length === 2 ? ([strs(h.sides[0]), strs(h.sides[1])] as [string[], string[]]) : null;
          const hb = borrowIn(rec(h.borrow), k);
          const out: LivePlayed = {
            a: h.a as number,
            b: h.b as number,
            goalsA: int(h.goalsA, 0, 1000) ?? 0,
            goalsB: int(h.goalsB, 0, 1000) ?? 0,
            ...(pens && winner !== null
              ? { pens: { winner, ...(int(pens.a, 0, 100) !== null ? { a: pens.a as number } : {}), ...(int(pens.b, 0, 100) !== null ? { b: pens.b as number } : {}) } }
              : {}),
          };
          if (h.out === null || int(h.out, 0, k) !== null) out.out = h.out as number | null;
          if (Array.isArray(h.goals)) out.goals = goalsIn(h.goals, k);
          if (int(h.endedAt) !== null) out.endedAt = h.endedAt as number;
          if (int(h.ms) !== null) out.ms = h.ms as number;
          if (hb && hb.ids.length) out.borrow = hb;
          if (sides) out.sides = sides;
          return out;
        }),
    };
  }
  return out;
}

/** A row from live_get or a realtime payload (snake_case columns). null = nothing live. */
export function parseLiveRow(raw: unknown): LiveRow | null {
  const r = rec(Array.isArray(raw) ? raw[0] : raw);
  if (!r) return null;
  const data = sanitizeLive(r.data);
  if (!data) return null;
  return {
    data,
    updatedBy: typeof r.updated_by === 'string' ? r.updated_by : null,
    byName: typeof r.by_name === 'string' ? r.by_name : '',
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : '',
    ...parseControl(r),
  };
}

/** Who runs the evening, from a row (null runner when the column is missing: a v10 server). */
export function parseControl(r: Record<string, unknown>): Pick<LiveRow, 'runner' | 'runnerName' | 'runnerSince' | 'rev'> {
  const rev = typeof r.rev === 'number' ? r.rev : typeof r.rev === 'string' && /^\d+$/.test(r.rev) ? Number(r.rev) : 0;
  return {
    runner: typeof r.runner === 'string' ? r.runner : null,
    runnerName: typeof r.runner_name === 'string' ? r.runner_name : '',
    runnerSince: typeof r.runner_since === 'string' ? r.runner_since : null,
    rev,
  };
}

/** This login runs the evening (may write). */
export const iAmRunner = (row: Pick<LiveRow, 'runner'> | null, userId: string | null | undefined): boolean =>
  !!row?.runner && !!userId && row.runner.toLowerCase() === userId.toLowerCase();

/** Someone else's phone runs it: this phone is read-only until it takes control. */
export const someoneElseRuns = (row: Pick<LiveRow, 'runner'> | null, userId: string | null | undefined): boolean =>
  !!row?.runner && !iAmRunner(row, userId);

export function liveApi(sb: SupabaseClient) {
  return {
    async get(groupId: string): Promise<LiveRow | null> {
      const { data, error } = await sb.rpc('live_get', { p_group_id: groupId });
      if (error) fail(error);
      return parseLiveRow(data);
    },
    /**
     * Write the evening; returns the row's new rev. Allowed for the runner, or an organizer when
     * nobody runs it (he becomes the runner). Someone else runs it, or `rev` given and the row moved
     * on → SyncError 'conflict'. null = end the evening (organizers only, else 'denied'; the row
     * becomes {"ended": true} with no runner, which readers see as nothing live).
     */
    async set(groupId: string, live: LiveData | null, rev?: number): Promise<number> {
      const args: Record<string, unknown> = { p_group_id: groupId, p_data: live };
      if (rev !== undefined) args.p_rev = rev;
      const { data, error } = await sb.rpc('live_set', args);
      if (error) fail(error);
      return typeof data === 'number' ? data : Number(data) || 0;
    },
    /**
     * Become the runner (any member; an organizer takes it back the same way). Returns the row
     * (with the evening to import, see control.ts). No open evening → SyncError 'invalid'.
     */
    async takeControl(groupId: string): Promise<LiveRow | null> {
      const { data, error } = await sb.rpc('take_control', { p_group_id: groupId });
      if (error) fail(error);
      return parseLiveRow(data);
    },
    /** Stop running it (nobody runs it after; no-op when you weren't the runner). Returns the rev. */
    async releaseControl(groupId: string): Promise<number | null> {
      const { data, error } = await sb.rpc('release_control', { p_group_id: groupId });
      if (error) fail(error);
      return data === null || data === undefined ? null : Number(data);
    },
    /** Every change (null when the evening ended). Fetch once with get() too: this only reports changes. Returns unsubscribe. */
    subscribe(groupId: string, onChange: (row: LiveRow | null) => void): () => void {
      const ch = sb
        .channel(`live-${groupId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'group_live', filter: `group_id=eq.${groupId}` }, (payload) => {
          onChange(payload.eventType === 'DELETE' ? null : parseLiveRow(payload.new));
        })
        .subscribe();
      return () => void sb.removeChannel(ch);
    },
  };
}
