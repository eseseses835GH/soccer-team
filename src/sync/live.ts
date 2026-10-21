// The live evening (DECISIONS → "Players, live evening, rating permission — server (v10)").
// The organizer's phone that runs the evening publishes a small JSON snapshot (LiveData) to
// group_live whenever something on the match screen changes (teams, goal, clock start/pause, end of
// match, borrow…), not every second: readers tick the clock themselves from `clock`. Everyone in
// the group (players and other organizers) reads it read-only. Last write wins; `byName` says
// whose phone is running it. No ratings, ever: liveFromState() only copies ids, names and the match.
import type { SupabaseClient } from '@supabase/supabase-js';
import { teamMembers } from '../state/history';
import { defaultMatchMs, teamBibs, type GameResult, type Settings } from '../state/model';
import { inDrawExtraTime, keeperIndex, matchLength, score, type MatchState } from '../match/match';
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
  /** Consecutive wins of each team in its current stay on the pitch. */
  streak: number[];
  /** Tonight's finished matches, oldest first. */
  played: { a: number; b: number; goalsA: number; goalsB: number; pens?: { winner: number; a?: number; b?: number } }[];
}

export interface LiveData {
  v: 1;
  /** Publisher's Date.now() at publish. */
  at: number;
  teamSize: number;
  /** Everyone tonight (teams, subs, borrowed) with the name at the time. */
  players: { id: string; name: string }[];
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
  /** Display name of the organizer whose phone runs it ("רץ בטלפון של …"). */
  byName: string;
  updatedAt: string;
}

export interface LiveInput {
  result: GameResult | null;
  match: MatchState | null;
  players: { id: string; name: string }[];
  settings: Settings;
  now: number;
}

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
      goals: m.goals.filter((g) => g.team === a || g.team === b).map((g) => (g.scorerId ? { team: g.team, by: g.scorerId } : { team: g.team })),
      clock: {
        running: m.clock.running,
        startedAt: m.clock.running ? m.clock.startedAt : null,
        elapsedMs: m.clock.elapsedMs,
        lengthMs: matchLength(m, defaultMatchMs(settings)),
      },
      extra: inDrawExtraTime(m),
      borrow: m.borrow && m.borrow.ids.length ? { team: m.borrow.team, from: m.borrow.from, ids: [...m.borrow.ids] } : null,
      streak: [...m.streak],
      played: m.history.map((h) => ({
        a: h.a,
        b: h.b,
        goalsA: h.goalsA,
        goalsB: h.goalsB,
        ...(h.pens ? { pens: { ...h.pens } } : {}),
      })),
    };
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

export function sanitizeLive(raw: unknown): LiveData | null {
  const r = rec(raw);
  if (!r || r.v !== 1 || !Array.isArray(r.teams)) return null;
  const teams: LiveTeam[] = r.teams.map((t, i) => {
    const o = rec(t) ?? {};
    const ids = strs(o.ids);
    return { bib: typeof o.bib === 'string' ? o.bib : `n${i + 1}`, ids, keeper: typeof o.keeper === 'string' && ids.includes(o.keeper) ? o.keeper : null };
  });
  const k = teams.length - 1;
  const players = (Array.isArray(r.players) ? r.players : [])
    .map(rec)
    .filter((p): p is Record<string, unknown> => !!p && typeof p.id === 'string' && typeof p.name === 'string')
    .map((p) => ({ id: p.id as string, name: p.name as string }));
  const out: LiveData = { v: 1, at: int(r.at) ?? 0, teamSize: int(r.teamSize, 1, 50) ?? 5, players, teams, subs: strs(r.subs), match: null };
  const m = rec(r.match);
  if (m && k >= 1) {
    const pitch = ints(m.onPitch, k);
    if (pitch.length !== 2) return out;
    const c = rec(m.clock) ?? {};
    const sc = ints(m.score, 1000);
    const b = rec(m.borrow);
    out.match = {
      n: int(m.n, 1, 10000) ?? 1,
      onPitch: [pitch[0], pitch[1]],
      queue: ints(m.queue, k),
      score: sc.length === 2 ? [sc[0], sc[1]] : [0, 0],
      goals: (Array.isArray(m.goals) ? m.goals : [])
        .map(rec)
        .filter((g): g is Record<string, unknown> => !!g && int(g.team, 0, k) !== null)
        .map((g) => (typeof g.by === 'string' ? { team: g.team as number, by: g.by } : { team: g.team as number })),
      clock: {
        running: c.running === true && int(c.startedAt) !== null,
        startedAt: c.running === true ? int(c.startedAt) : null,
        elapsedMs: int(c.elapsedMs) ?? 0,
        lengthMs: int(c.lengthMs, 1) ?? null,
      },
      extra: m.extra === true,
      borrow: b && int(b.team, 0, k) !== null && int(b.from, 0, k) !== null ? { team: b.team as number, from: b.from as number, ids: strs(b.ids) } : null,
      streak: ints(m.streak, 10000),
      played: (Array.isArray(m.played) ? m.played : [])
        .map(rec)
        .filter((h): h is Record<string, unknown> => !!h && int(h.a, 0, k) !== null && int(h.b, 0, k) !== null)
        .map((h) => {
          const pens = rec(h.pens);
          const winner = pens ? int(pens.winner, 0, k) : null;
          return {
            a: h.a as number,
            b: h.b as number,
            goalsA: int(h.goalsA, 0, 1000) ?? 0,
            goalsB: int(h.goalsB, 0, 1000) ?? 0,
            ...(pens && winner !== null
              ? { pens: { winner, ...(int(pens.a, 0, 100) !== null ? { a: pens.a as number } : {}), ...(int(pens.b, 0, 100) !== null ? { b: pens.b as number } : {}) } }
              : {}),
          };
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
  };
}

export function liveApi(sb: SupabaseClient) {
  return {
    async get(groupId: string): Promise<LiveRow | null> {
      const { data, error } = await sb.rpc('live_get', { p_group_id: groupId });
      if (error) fail(error);
      return parseLiveRow(data);
    },
    /** Organizers only (others get SyncError 'denied'). null = the evening ended (the row becomes {"ended": true}, which readers see as nothing live). */
    async set(groupId: string, live: LiveData | null): Promise<void> {
      const { error } = await sb.rpc('live_set', { p_group_id: groupId, p_data: live });
      if (error) fail(error);
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
