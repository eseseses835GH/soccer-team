import { createRng, keyOf, pickReroll, randomSeed, type Solution } from '../engine';
import { engineOptions, type AppState, type Player } from '../state/model';
import type { Action } from '../state/reducer';
import { keeperOrders, orderBySize } from '../state/split';
import { finishSplit, prepareSplit } from '../state/splitCore';
import { balance } from '../worker/balancer';

/** Make teams from today's attendance. Returns false if there aren't enough players. */
export async function splitTeams(state: AppState, dispatch: (a: Action) => void): Promise<boolean> {
  const seed = randomSeed();
  const prep = prepareSplit(state, seed);
  if (!prep) return false;
  const res = await balance(prep.req);
  dispatch({ type: 'setResult', ...finishSplit(state, prep, res.best.assignment, seed), pool: res.pool, now: Date.now() });
  return true;
}

function byId(players: Player[]) {
  return new Map(players.map((p) => [p.id, p]));
}

/** A different, still near-optimal split of the same teams (same sizes, same subs). */
export async function rerollTeams(state: AppState, dispatch: (a: Action) => void): Promise<'ok' | 'none'> {
  const r = state.result;
  if (!r) return 'none';
  const rng = createRng(randomSeed());
  const k = r.numTeams;
  let pool: Solution[] = r.pool;
  let fresh = false;
  if (pool.length < 2 || pool[0].assignment.length !== r.playerIds.length) {
    // Pool is gone (late arrival, sub swapped in): search again for these exact teams.
    const map = byId(state.players);
    const players = r.playerIds.map((id) => map.get(id)!).filter(Boolean);
    const counts = new Array<number>(k).fill(0);
    r.assignment.forEach((t) => counts[t]++);
    const res = await balance({
      players,
      k,
      options: engineOptions(state.settings),
      constraints: state.constraints,
      seed: randomSeed(),
      sizes: counts.sort((a, b) => b - a),
    });
    pool = res.pool;
    fresh = true;
  }
  if (pool.length < 2) return 'none';
  const shown = fresh ? [r.assignment] : r.shown.length ? r.shown : [r.assignment];
  const next = pickReroll(pool, shown, rng);
  if (keyOf(next.assignment) === keyOf(r.assignment)) return 'none';
  const assignment = orderBySize(next.assignment, k);
  dispatch({
    type: 'showSolution',
    assignment,
    gkOrder: keeperOrders(r.playerIds, assignment, k, byId(state.players), state.settings.gkMode, randomSeed()),
    pool: fresh ? pool : undefined,
  });
  return 'ok';
}
