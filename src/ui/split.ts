import { createRng, keyOf, pickReroll, planFormat, randomSeed, type Solution } from '../engine';
import { engineOptions, type AppState, type Player } from '../state/model';
import type { Action } from '../state/reducer';
import { keeperOrders, orderBySize, pickSubs } from '../state/split';
import { presentPlayers } from '../state/store';
import { balance } from '../worker/balancer';

/** Make teams from today's attendance. Returns false if there aren't enough players. */
export async function splitTeams(state: AppState, dispatch: (a: Action) => void): Promise<boolean> {
  const present = presentPlayers(state);
  const plan = planFormat(present.length, state.teamSize);
  if (!plan) return false;
  const seed = randomSeed();
  const subIds = pickSubs(present, plan.subs, state.constraints, createRng(seed));
  const sub = new Set(subIds);
  const onTeams = present.filter((p) => !sub.has(p.id));
  const k = plan.sizes.length;
  const res = await balance({
    players: onTeams,
    k,
    options: engineOptions(state.settings),
    constraints: state.constraints,
    seed,
    sizes: plan.sizes,
  });
  const assignment = orderBySize(res.best.assignment, k);
  const ids = onTeams.map((p) => p.id);
  dispatch({
    type: 'setResult',
    playerIds: ids,
    subIds,
    sizes: plan.sizes,
    teamSize: state.teamSize,
    assignment,
    pool: res.pool,
    gkOrder: keeperOrders(ids, assignment, k, byId(state.players), state.settings.gkMode, seed + 1),
    now: Date.now(),
  });
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
