/**
 * "Winner stays" match night, as pure functions over a serialisable state:
 * two teams on the pitch, the rest queue outside. The loser goes to the back
 * of the queue and the next team comes in. Who moves over to complete a short
 * team is decided at the pitch, not here.
 */

export interface Goal {
  team: number;
  scorerId?: string;
  at: number;
}

export interface MatchRecord {
  a: number;
  b: number;
  goalsA: number;
  goalsB: number;
  /** Team that left the pitch (null when there is no queue). */
  out: number | null;
  goals: Goal[];
  endedAt: number;
}

export interface Clock {
  running: boolean;
  /** Timestamp the clock was (re)started; elapsed time survives reloads and screen locks. */
  startedAt: number | null;
  elapsedMs: number;
}

export interface MatchState {
  onPitch: [number, number];
  queue: number[];
  /** Consecutive wins of each team in its current stay on the pitch. */
  streak: number[];
  /** Match number at which each team (last) came onto the pitch. */
  pitchSince: number[];
  /** Goals conceded per team over the whole session (drives keeper rotation). */
  conceded: number[];
  clock: Clock;
  goals: Goal[];
  history: MatchRecord[];
  /** Dominance hint the user dismissed: don't nag again for a while. */
  dismissed: { team: number; atMatch: number } | null;
}

export function startSession(numTeams: number): MatchState {
  return {
    onPitch: [0, 1],
    queue: Array.from({ length: Math.max(0, numTeams - 2) }, (_, i) => i + 2),
    streak: new Array(numTeams).fill(0),
    pitchSince: new Array(numTeams).fill(0),
    conceded: new Array(numTeams).fill(0),
    clock: { running: false, startedAt: null, elapsedMs: 0 },
    goals: [],
    history: [],
    dismissed: null,
  };
}

export function elapsedMs(c: Clock, now: number): number {
  return c.elapsedMs + (c.running && c.startedAt !== null ? Math.max(0, now - c.startedAt) : 0);
}

export function startClock(m: MatchState, now: number): MatchState {
  if (m.clock.running) return m;
  return { ...m, clock: { ...m.clock, running: true, startedAt: now } };
}

export function pauseClock(m: MatchState, now: number): MatchState {
  if (!m.clock.running) return m;
  return { ...m, clock: { running: false, startedAt: null, elapsedMs: elapsedMs(m.clock, now) } };
}

export function resetClock(m: MatchState): MatchState {
  return { ...m, clock: { running: false, startedAt: null, elapsedMs: 0 } };
}

export function score(m: MatchState): [number, number] {
  const [a, b] = m.onPitch;
  return [m.goals.filter((g) => g.team === a).length, m.goals.filter((g) => g.team === b).length];
}

export function addGoal(m: MatchState, team: number, now: number, scorerId?: string): MatchState {
  if (!m.onPitch.includes(team)) return m;
  const other = m.onPitch[0] === team ? m.onPitch[1] : m.onPitch[0];
  const conceded = [...m.conceded];
  conceded[other]++;
  return { ...m, goals: [...m.goals, { team, scorerId, at: now }], conceded };
}

export function setLastScorer(m: MatchState, scorerId: string | undefined): MatchState {
  if (!m.goals.length) return m;
  const goals = [...m.goals];
  goals[goals.length - 1] = { ...goals[goals.length - 1], scorerId };
  return { ...m, goals };
}

export function undoGoal(m: MatchState): MatchState {
  const last = m.goals[m.goals.length - 1];
  if (!last) return m;
  const other = m.onPitch[0] === last.team ? m.onPitch[1] : m.onPitch[0];
  const conceded = [...m.conceded];
  conceded[other] = Math.max(0, conceded[other] - 1);
  return { ...m, goals: m.goals.slice(0, -1), conceded };
}

/** Which team leaves on a draw by default: the one that has been on the pitch longer. Null on the first match. */
export function defaultOutOnDraw(m: MatchState): number | null {
  const [a, b] = m.onPitch;
  if (m.pitchSince[a] === m.pitchSince[b]) return null;
  return m.pitchSince[a] < m.pitchSince[b] ? a : b;
}

/** The team that leaves when the match ends with this score, or null for a draw (ask). */
export function loserOf(m: MatchState): number | null {
  const [ga, gb] = score(m);
  if (ga === gb) return null;
  return ga < gb ? m.onPitch[0] : m.onPitch[1];
}

/**
 * Finish the current match. `out` is the team that leaves (the loser, or the
 * team chosen on a draw). With only two teams nobody leaves.
 */
export function endMatch(m: MatchState, out: number, now: number): MatchState {
  const [a, b] = m.onPitch;
  if (out !== a && out !== b) return m;
  const [ga, gb] = score(m);
  const stayer = out === a ? b : a;
  const winner = ga === gb ? null : ga > gb ? a : b;
  const matchNo = m.history.length + 1;
  const streak = [...m.streak];
  const pitchSince = [...m.pitchSince];
  let onPitch = m.onPitch;
  let queue = m.queue;
  const hasQueue = m.queue.length > 0;
  if (winner !== null) streak[winner]++;
  if (hasQueue) {
    const [next, ...rest] = m.queue;
    queue = [...rest, out];
    onPitch = (out === a ? [next, stayer] : [stayer, next]) as [number, number];
    streak[out] = 0;
    pitchSince[next] = matchNo;
  } else if (winner !== null) {
    streak[out] = 0;
  }
  return {
    ...m,
    onPitch,
    queue,
    streak,
    pitchSince,
    clock: { running: false, startedAt: null, elapsedMs: 0 },
    goals: [],
    history: [...m.history, { a, b, goalsA: ga, goalsB: gb, out: hasQueue ? out : null, goals: m.goals, endedAt: now }],
  };
}

/** A team added mid-session (late arrivals formed a new team) joins the back of the queue. */
export function addTeam(m: MatchState, team: number): MatchState {
  if (m.queue.includes(team) || m.onPitch.includes(team)) return m;
  const grow = <T>(arr: T[], v: T) => {
    const out = [...arr];
    while (out.length <= team) out.push(v);
    return out;
  };
  return {
    ...m,
    queue: [...m.queue, team],
    streak: grow(m.streak, 0),
    pitchSince: grow(m.pitchSince, m.history.length),
    conceded: grow(m.conceded, 0),
  };
}

export interface Standing {
  team: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
}

export function standings(m: MatchState, numTeams: number): Standing[] {
  const rows: Standing[] = Array.from({ length: numTeams }, (_, team) => ({
    team,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
  }));
  for (const h of m.history) {
    const A = rows[h.a];
    const B = rows[h.b];
    if (!A || !B) continue;
    A.played++;
    B.played++;
    A.goalsFor += h.goalsA;
    A.goalsAgainst += h.goalsB;
    B.goalsFor += h.goalsB;
    B.goalsAgainst += h.goalsA;
    if (h.goalsA === h.goalsB) {
      A.drawn++;
      B.drawn++;
    } else if (h.goalsA > h.goalsB) {
      A.won++;
      B.lost++;
    } else {
      B.won++;
      A.lost++;
    }
  }
  return rows;
}

/** Goals per player over the session, including the match in progress. Best first. */
export function topScorers(m: MatchState): [string, number][] {
  const count = new Map<string, number>();
  for (const g of [...m.history.flatMap((h) => h.goals), ...m.goals]) {
    if (g.scorerId) count.set(g.scorerId, (count.get(g.scorerId) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1]);
}

/**
 * A team that keeps winning: 3 wins in a row, or ≥75% wins after 4+ matches.
 * Respects a dismissal for the next two matches.
 */
export function dominantTeam(m: MatchState, numTeams: number): number | null {
  const rows = standings(m, numTeams);
  for (let t = 0; t < numTeams; t++) {
    const r = rows[t];
    const hot = (m.streak[t] ?? 0) >= 3 || (r.played >= 4 && r.won / r.played >= 0.75);
    if (!hot) continue;
    if (m.dismissed && m.dismissed.team === t && m.history.length < m.dismissed.atMatch + 2) continue;
    return t;
  }
  return null;
}

export function dismissDominance(m: MatchState, team: number): MatchState {
  return { ...m, dismissed: { team, atMatch: m.history.length } };
}

/** Index into a team's keeper order: rotate every `every` goals conceded. */
export function keeperIndex(conceded: number, every: number, orderLength: number): number {
  if (orderLength <= 0) return 0;
  return Math.floor(conceded / Math.max(1, every)) % orderLength;
}

export function sanitizeMatch(raw: unknown, numTeams: number): MatchState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<MatchState>;
  const inRange = (t: unknown) => Number.isInteger(t) && (t as number) >= 0 && (t as number) < numTeams;
  if (!Array.isArray(r.onPitch) || r.onPitch.length !== 2 || !r.onPitch.every(inRange) || r.onPitch[0] === r.onPitch[1]) return null;
  const base = startSession(numTeams);
  const fill = (arr: unknown) =>
    Array.from({ length: numTeams }, (_, i) => (Array.isArray(arr) && Number.isFinite(Number(arr[i])) ? Number(arr[i]) : 0));
  const queue = Array.isArray(r.queue) ? r.queue.filter((t) => inRange(t) && !r.onPitch!.includes(t)) : base.queue;
  // Teams missing from both the pitch and the queue go to the back of the queue.
  for (let t = 0; t < numTeams; t++) if (!queue.includes(t) && !r.onPitch.includes(t)) queue.push(t);
  return {
    onPitch: [r.onPitch[0], r.onPitch[1]],
    queue,
    streak: fill(r.streak),
    pitchSince: fill(r.pitchSince),
    conceded: fill(r.conceded),
    clock: {
      running: !!r.clock?.running && typeof r.clock?.startedAt === 'number',
      startedAt: typeof r.clock?.startedAt === 'number' ? r.clock.startedAt : null,
      elapsedMs: Number(r.clock?.elapsedMs) || 0,
    },
    goals: Array.isArray(r.goals) ? r.goals.filter((g) => inRange(g?.team)) : [],
    history: Array.isArray(r.history) ? r.history.filter((h) => inRange(h?.a) && inRange(h?.b)) : [],
    dismissed: r.dismissed && inRange(r.dismissed.team) ? r.dismissed : null,
  };
}
