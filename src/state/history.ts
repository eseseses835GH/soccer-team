/**
 * History across evenings: a compact, self-contained record of each match
 * session, plus pure stats for the evening summary and the all-time view.
 *
 * A record never points into live state: it carries a names snapshot and the
 * bib id of each team, so it still reads correctly after players are renamed
 * or deleted, after bib settings change, or on another organizer's phone.
 * Records are keyed by `id`; two copies of the same evening merge by id
 * (match lists are unioned), so syncing never duplicates an evening.
 */
import type { GameResult } from './model';
import { cleanPens, elapsedMs, matchWinner, type Borrow, type Goal, type MatchState, type Pens } from '../match/match';

export const HISTORY_MAX = 150;
/** A single match never counts for more than this (a clock left running overnight). */
export const MATCH_MS_CAP = 60 * 60 * 1000;
/** Minimum matches for the all-time win percentage. */
export const MIN_GAMES_FOR_PCT = 5;

export interface EveningGoal {
  /** Team index (into `EveningRecord.teams`) that scored. */
  team: number;
  /** Scorer's player id, when someone picked one. */
  by?: string;
}

export interface EveningMatch {
  /** Team indexes into `EveningRecord.teams`. */
  a: number;
  b: number;
  goalsA: number;
  goalsB: number;
  goals: EveningGoal[];
  /** Who played for a and b in this match (after swaps). Missing: use the team's final roster. */
  sides?: [string[], string[]];
  /** Clock time played, when known. */
  ms?: number;
  endedAt: number;
  /** Level match decided on penalties (winner, optional kicks). Counts as a win/loss, never as goals. */
  pens?: Pens;
}

export interface EveningTeam {
  /** Bib id (see BIBS), so the colour and name survive settings changes. */
  bib: string;
  /** Final roster, keeper order first. */
  ids: string[];
}

export interface EveningRecord {
  id: string;
  v: 1;
  startedAt: number;
  endedAt: number;
  teamSize: number;
  /** Everyone who was there (teams and bench), with the name at the time. */
  players: { id: string; name: string }[];
  teams: EveningTeam[];
  subIds: string[];
  /** Oldest first. */
  matches: EveningMatch[];
}

// ---------- building a record ----------

/** Stable id for the evening of a split: archiving the same session twice merges instead of duplicating. */
export function eveningId(result: Pick<GameResult, 'createdAt' | 'playerIds' | 'subIds'>): string {
  let h = 2166136261;
  for (const ch of [...result.playerIds, ...result.subIds].sort().join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return `ev-${Math.max(0, Math.round(result.createdAt)).toString(36)}-${(h >>> 0).toString(36)}`;
}

/** Team members in keeper order (as on the teams and match screens). */
export function teamMembers(r: GameResult, t: number): string[] {
  const inTeam = r.playerIds.filter((_, i) => r.assignment[i] === t);
  const set = new Set(inTeam);
  const order = (r.gkOrder[t] ?? []).filter((id) => set.has(id));
  return [...order, ...inTeam.filter((id) => !order.includes(id))];
}

const toGoals = (goals: Goal[]): EveningGoal[] => goals.map((g) => (g.scorerId ? { team: g.team, by: g.scorerId } : { team: g.team }));

/** The match on the pitch counts when the evening ends if anything happened in it. */
function inProgressCounts(m: MatchState, now: number): boolean {
  return m.goals.length > 0 || elapsedMs(m.clock, now) >= 60_000;
}

/** True if ending now would produce a record (at least one match to show). */
export function hasEveningData(m: MatchState | null, now: number): boolean {
  return !!m && (m.history.length > 0 || inProgressCounts(m, now));
}

/** Copy the current rosters onto match records that were just added (`from` = previous history length). */
export function stampSides(m: MatchState, from: number, r: GameResult): MatchState {
  if (m.history.length <= from) return m;
  return {
    ...m,
    history: m.history.map((h, i) => (i < from || h.sides ? h : { ...h, sides: lineups(r, h.a, h.b, h.borrow) })),
  };
}

/** Who played for a and b: the team rosters, plus anyone borrowed from the losing team for that match. */
function lineups(r: GameResult, a: number, b: number, borrow?: Borrow | null): [string[], string[]] {
  const side = (t: number) => [...teamMembers(r, t), ...(borrow?.team === t ? borrow.ids : [])];
  return [side(a), side(b)];
}

export interface BuildInput {
  match: MatchState;
  result: GameResult;
  players: { id: string; name: string }[];
  bibs: readonly string[];
  now: number;
  id?: string;
}

export function buildEvening({ match: m, result: r, players, bibs, now, id }: BuildInput): EveningRecord | null {
  const matches: EveningMatch[] = m.history.map((h) => ({
    a: h.a,
    b: h.b,
    goalsA: h.goalsA,
    goalsB: h.goalsB,
    goals: toGoals(h.goals),
    ...(h.sides ? { sides: h.sides } : {}),
    ...(typeof h.ms === 'number' ? { ms: Math.min(h.ms, MATCH_MS_CAP) } : {}),
    endedAt: h.endedAt,
    ...(h.pens ? { pens: { ...h.pens } } : {}),
  }));
  if (inProgressCounts(m, now)) {
    const [a, b] = m.onPitch;
    const lastGoal = m.goals[m.goals.length - 1]?.at;
    matches.push({
      a,
      b,
      goalsA: m.goals.filter((g) => g.team === a).length,
      goalsB: m.goals.filter((g) => g.team === b).length,
      goals: toGoals(m.goals),
      sides: lineups(r, a, b, m.borrow),
      ms: Math.min(elapsedMs(m.clock, now), MATCH_MS_CAP),
      endedAt: Math.max(lastGoal ?? 0, matches[matches.length - 1]?.endedAt ?? 0) || now,
    });
  }
  if (!matches.length) return null;
  const names = new Map(players.map((p) => [p.id, p.name]));
  const ids = new Set([...r.playerIds, ...r.subIds]);
  for (const x of matches) {
    x.sides?.forEach((s) => s.forEach((pid) => ids.add(pid)));
    x.goals.forEach((g) => g.by && ids.add(g.by));
  }
  return {
    id: id ?? eveningId(r),
    v: 1,
    startedAt: r.createdAt || matches[0].endedAt,
    endedAt: Math.max(...matches.map((x) => x.endedAt)),
    teamSize: r.teamSize,
    players: [...ids].filter((pid) => names.has(pid)).map((pid) => ({ id: pid, name: names.get(pid)! })),
    teams: Array.from({ length: r.numTeams }, (_, t) => ({ bib: bibs[t] ?? '', ids: teamMembers(r, t) })),
    subIds: r.subIds,
    matches,
  };
}

// ---------- merging, bounding, sanitizing ----------

const matchKey = (x: EveningMatch) => `${x.endedAt}:${x.a}:${x.b}`;

/** Two copies of the same evening: union of matches and players; the copy that ended later wins for the rest. */
export function mergeRecords(x: EveningRecord, y: EveningRecord): EveningRecord {
  const [older, newer] = x.endedAt <= y.endedAt ? [x, y] : [y, x];
  const matches = new Map<string, EveningMatch>();
  for (const mt of [...older.matches, ...newer.matches]) matches.set(matchKey(mt), mt);
  const players = new Map<string, { id: string; name: string }>();
  for (const p of [...older.players, ...newer.players]) players.set(p.id, p);
  const maxTeam = Math.max(-1, ...[...matches.values()].flatMap((mt) => [mt.a, mt.b]));
  const teams = [...newer.teams];
  for (let t = teams.length; t <= maxTeam; t++) teams.push(older.teams[t] ?? { bib: '', ids: [] });
  return {
    ...newer,
    startedAt: Math.min(older.startedAt, newer.startedAt),
    endedAt: Math.max(older.endedAt, newer.endedAt),
    players: [...players.values()],
    teams,
    matches: [...matches.values()].sort((p, q) => p.endedAt - q.endedAt),
  };
}

/** Union by id, newest first, bounded. */
export function mergeHistory(current: EveningRecord[], incoming: EveningRecord[], max = HISTORY_MAX): EveningRecord[] {
  const byId = new Map<string, EveningRecord>();
  for (const r of [...current, ...incoming]) {
    const prev = byId.get(r.id);
    byId.set(r.id, prev ? mergeRecords(prev, r) : r);
  }
  return [...byId.values()].sort((a, b) => b.startedAt - a.startedAt || b.endedAt - a.endedAt).slice(0, max);
}

export function addEvening(history: EveningRecord[], rec: EveningRecord | null): EveningRecord[] {
  return rec ? mergeHistory(history, [rec]) : history;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isIdx = (v: unknown, n: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n;
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);

function sanitizeRecord(raw: unknown): EveningRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<EveningRecord>;
  if (typeof r.id !== 'string' || !r.id || !Array.isArray(r.teams) || !Array.isArray(r.matches)) return null;
  const teams: EveningTeam[] = r.teams.map((t) => ({ bib: typeof t?.bib === 'string' ? t.bib : '', ids: strs(t?.ids) }));
  const n = teams.length;
  const matches: EveningMatch[] = [];
  for (const x of r.matches as unknown[]) {
    const mt = (x ?? {}) as Partial<EveningMatch>;
    if (!isIdx(mt.a, n) || !isIdx(mt.b, n) || mt.a === mt.b) continue;
    const goals = Array.isArray(mt.goals)
      ? mt.goals
          .filter((g) => g && (g.team === mt.a || g.team === mt.b))
          .map((g) => (typeof g.by === 'string' ? { team: g.team, by: g.by } : { team: g.team }))
      : [];
    const count = (v: unknown, team: number) => (isNum(v) && v >= 0 ? Math.round(v) : goals.filter((g) => g.team === team).length);
    const sides = Array.isArray(mt.sides) && mt.sides.length === 2 ? ([strs(mt.sides[0]), strs(mt.sides[1])] as [string[], string[]]) : undefined;
    const goalsA = count(mt.goalsA, mt.a);
    const goalsB = count(mt.goalsB, mt.b);
    const pens = cleanPens(mt.pens, mt.a, mt.b, goalsA, goalsB);
    matches.push({
      a: mt.a,
      b: mt.b,
      goalsA,
      goalsB,
      goals,
      ...(sides ? { sides } : {}),
      ...(isNum(mt.ms) && mt.ms >= 0 ? { ms: Math.min(mt.ms, MATCH_MS_CAP) } : {}),
      endedAt: isNum(mt.endedAt) ? mt.endedAt : 0,
      ...(pens ? { pens } : {}),
    });
  }
  if (!matches.length) return null;
  const players = Array.isArray(r.players)
    ? r.players.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string').map((p) => ({ id: p.id, name: p.name.slice(0, 24) }))
    : [];
  const endedAt = isNum(r.endedAt) ? r.endedAt : Math.max(...matches.map((x) => x.endedAt));
  return {
    id: r.id.slice(0, 64),
    v: 1,
    startedAt: isNum(r.startedAt) ? r.startedAt : endedAt,
    endedAt,
    teamSize: isNum(r.teamSize) ? Math.round(r.teamSize) : 5,
    players,
    teams,
    subIds: strs(r.subIds),
    matches,
  };
}

/** Repair whatever was stored or imported: bad records are dropped, never thrown on. */
export function sanitizeHistory(raw: unknown): EveningRecord[] {
  if (!Array.isArray(raw)) return [];
  return mergeHistory(
    [],
    raw.map(sanitizeRecord).filter((r): r is EveningRecord => !!r),
  );
}

// ---------- stats for one evening ----------

export interface TeamRow {
  team: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Of `won`, how many on penalties. */
  pensWon: number;
}

export interface Ranked {
  id: string;
  name: string;
  n: number;
}

export interface EveningStats {
  matches: number;
  goals: number;
  /** Minutes on the clock, when every match has a time. */
  minutes: number | null;
  /** Best first: wins, then goal difference, then goals scored. */
  table: TeamRow[];
  /** Goals per scorer (only when scorers were recorded), best first. */
  scorers: Ranked[];
  /** Wins per player from who was on the pitch in each match, best first. */
  playerWins: (Ranked & { played: number })[];
  /** Longest run of consecutive wins by one team (≥ 2). */
  streak: { team: number; wins: number } | null;
  /** Largest margin (≥ 2), index into matches. */
  biggestWin: { index: number; margin: number } | null;
  /** Most goals in one match (≥ 3), index into matches. */
  mostGoals: { index: number; total: number } | null;
  /** Indexes of the matches decided on penalties. */
  pens: number[];
}

export function sideIds(rec: EveningRecord, mt: EveningMatch, side: 0 | 1): string[] {
  return mt.sides?.[side] ?? rec.teams[side === 0 ? mt.a : mt.b]?.ids ?? [];
}

export function nameIn(rec: EveningRecord, id: string): string {
  return rec.players.find((p) => p.id === id)?.name ?? '?';
}

/** Winner on goals, or on penalties after a level score (same rule as the match screen's standings). */
const winnerOf = (mt: EveningMatch) => matchWinner(mt);

export function teamTable(rec: EveningRecord): TeamRow[] {
  const rows: TeamRow[] = rec.teams.map((_, team) => ({ team, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, pensWon: 0 }));
  for (const mt of rec.matches) {
    const A = rows[mt.a];
    const B = rows[mt.b];
    A.played++;
    B.played++;
    A.goalsFor += mt.goalsA;
    A.goalsAgainst += mt.goalsB;
    B.goalsFor += mt.goalsB;
    B.goalsAgainst += mt.goalsA;
    const w = winnerOf(mt);
    if (w === null) {
      A.drawn++;
      B.drawn++;
    } else if (w === mt.a) {
      A.won++;
      B.lost++;
    } else {
      B.won++;
      A.lost++;
    }
    if (w !== null && mt.pens) rows[w].pensWon++;
  }
  return rows
    .filter((r) => r.played > 0)
    .sort((x, y) => y.won - x.won || y.goalsFor - y.goalsAgainst - (x.goalsFor - x.goalsAgainst) || y.goalsFor - x.goalsFor || x.lost - y.lost);
}

const byN = <T extends { n: number; name: string }>(a: T, b: T) => b.n - a.n || a.name.localeCompare(b.name, 'he');

export function eveningStats(rec: EveningRecord): EveningStats {
  const goals = rec.matches.reduce((s, mt) => s + mt.goalsA + mt.goalsB, 0);
  const timed = rec.matches.every((mt) => typeof mt.ms === 'number');
  const ms = rec.matches.reduce((s, mt) => s + (mt.ms ?? 0), 0);

  const scored = new Map<string, number>();
  for (const mt of rec.matches) for (const g of mt.goals) if (g.by) scored.set(g.by, (scored.get(g.by) ?? 0) + 1);
  const scorers = [...scored].map(([id, n]) => ({ id, name: nameIn(rec, id), n })).sort(byN);

  const wins = new Map<string, { n: number; played: number }>();
  for (const mt of rec.matches) {
    const w = winnerOf(mt);
    ([0, 1] as const).forEach((side) => {
      const team = side === 0 ? mt.a : mt.b;
      for (const id of sideIds(rec, mt, side)) {
        const row = wins.get(id) ?? { n: 0, played: 0 };
        row.played++;
        if (w === team) row.n++;
        wins.set(id, row);
      }
    });
  }
  const playerWins = [...wins].map(([id, v]) => ({ id, name: nameIn(rec, id), ...v })).sort((a, b) => byN(a, b) || a.played - b.played);

  let streak: EveningStats['streak'] = null;
  const run = new Map<number, number>();
  for (const mt of rec.matches) {
    const w = winnerOf(mt);
    for (const t of [mt.a, mt.b]) run.set(t, t === w ? (run.get(t) ?? 0) + 1 : 0);
    if (w !== null && (run.get(w) ?? 0) >= 2 && (!streak || run.get(w)! > streak.wins)) streak = { team: w, wins: run.get(w)! };
  }

  let biggestWin: EveningStats['biggestWin'] = null;
  let mostGoals: EveningStats['mostGoals'] = null;
  rec.matches.forEach((mt, index) => {
    const margin = Math.abs(mt.goalsA - mt.goalsB);
    const total = mt.goalsA + mt.goalsB;
    if (margin >= 2 && (!biggestWin || margin > biggestWin.margin)) biggestWin = { index, margin };
    if (total >= 3 && (!mostGoals || total > mostGoals.total)) mostGoals = { index, total };
  });

  return {
    matches: rec.matches.length,
    goals,
    minutes: timed && ms > 0 ? Math.round(ms / 60_000) : null,
    table: teamTable(rec),
    scorers,
    playerWins,
    streak,
    biggestWin,
    mostGoals,
    pens: rec.matches.flatMap((mt, i) => (mt.pens ? [i] : [])),
  };
}

/** Everyone tied for first place (empty when the best is zero). */
export function leaders<T extends { n: number }>(list: T[]): T[] {
  const top = list[0]?.n ?? 0;
  return top > 0 ? list.filter((x) => x.n === top) : [];
}

// ---------- all time ----------

export interface AllTimeRow {
  key: string;
  name: string;
  evenings: number;
  played: number;
  won: number;
  goals: number;
}

export interface AllTime {
  evenings: number;
  matches: number;
  goals: number;
  /** Matches decided on penalties. */
  pens: number;
  rows: AllTimeRow[];
}

/**
 * Totals per player over all saved evenings. Records from another phone may
 * use other ids, so a player is matched by id, then by current name, then by
 * the name in the record.
 */
export function allTimeStats(history: EveningRecord[], roster: { id: string; name: string }[]): AllTime {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const byName = new Map(roster.map((p) => [p.name.trim(), p]));
  const rows = new Map<string, AllTimeRow>();
  const row = (rec: EveningRecord, id: string) => {
    const snap = nameIn(rec, id);
    const cur = byId.get(id) ?? byName.get(snap.trim());
    const key = cur ? cur.id : `name:${snap.trim()}`;
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { key, name: cur?.name ?? snap, evenings: 0, played: 0, won: 0, goals: 0 }));
    return r;
  };
  let matches = 0;
  let goals = 0;
  let pens = 0;
  for (const rec of history) {
    const seen = new Set<AllTimeRow>();
    for (const p of rec.players) seen.add(row(rec, p.id));
    seen.forEach((r) => r.evenings++);
    for (const mt of rec.matches) {
      matches++;
      goals += mt.goalsA + mt.goalsB;
      if (mt.pens) pens++;
      const w = winnerOf(mt);
      ([0, 1] as const).forEach((side) => {
        for (const id of sideIds(rec, mt, side)) {
          if (!rec.players.some((p) => p.id === id)) continue;
          const r = row(rec, id);
          r.played++;
          if (w === (side === 0 ? mt.a : mt.b)) r.won++;
        }
      });
      for (const g of mt.goals) if (g.by && rec.players.some((p) => p.id === g.by)) row(rec, g.by).goals++;
    }
  }
  return { evenings: history.length, matches, goals, pens, rows: [...rows.values()] };
}

/** Win percentage, or null below the minimum number of matches. */
export function winPct(r: AllTimeRow, min = MIN_GAMES_FOR_PCT): number | null {
  return r.played >= min ? Math.round((100 * r.won) / r.played) : null;
}
