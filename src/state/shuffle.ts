// "שאפל" between matches (DECISIONS → "Shuffle"): tonight's players split again into new balanced
// teams. Pure and shared: the organizer's phone and the split-teams function (bundled into core.js).
import { keyOf, pickReroll, type Assignment, type Rng, type Solution } from '../engine';
import { matchWinner, type MatchRecord } from '../match/match';
import { teamMembers } from './history';
import type { GameResult } from './model';

/** Wins in a row before the match screen suggests a shuffle. */
export const SHUFFLE_STREAK = 2;

/**
 * The winner of the last match, when it has won the last `wins` matches in a row (≥ 2). `from` is the
 * index of the streak's first match, so a dismissal sticks to this streak only.
 */
export function winStreak(history: readonly MatchRecord[]): { team: number; wins: number; from: number } | null {
  const last = history[history.length - 1];
  const team = last ? matchWinner(last) : null;
  if (team === null) return null;
  let i = history.length - 1;
  while (i >= 0 && matchWinner(history[i]) === team) i--;
  const wins = history.length - 1 - i;
  return wins >= SHUFFLE_STREAK ? { team, wins, from: i + 1 } : null;
}

/**
 * When to suggest a shuffle: the winner reached 2 wins in a row, then again every 2 more (4, 6, …) while
 * the same streak goes on. A new streak counts afresh.
 */
export function shuffleSuggestion(history: readonly MatchRecord[]): { team: number; wins: number; from: number } | null {
  const s = winStreak(history);
  return s && s.wins % SHUFFLE_STREAK === 0 ? s : null;
}

/** Tonight's teams as id lists (what a shuffle tries not to repeat). */
export function currentTeams(r: GameResult): string[][] {
  return Array.from({ length: r.numTeams }, (_, t) => teamMembers(r, t));
}

/** The current teams as an assignment over `ids` (the new split's players); null when the players differ. */
export function avoidAssignment(ids: readonly string[], teams: readonly (readonly string[])[]): Assignment | null {
  const team = new Map<string, number>();
  teams.forEach((l, t) => l.forEach((id) => team.set(id, t)));
  if (ids.length !== team.size || !ids.every((id) => team.has(id))) return null;
  return ids.map((id) => team.get(id)!);
}

/** A near-optimal split from the pool that isn't the current teams (`best` when nothing else fits). */
export function pickShuffle(pool: Solution[], best: Assignment, away: Assignment | null, rng: Rng): Assignment {
  if (!away || keyOf(best) !== keyOf(away)) return best;
  if (pool.length < 2) return best;
  const next = pickReroll(pool, [away], rng);
  return keyOf(next.assignment) !== keyOf(away) ? next.assignment : best;
}
