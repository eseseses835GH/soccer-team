import { MAX_TEAM_SIZE, MIN_TEAM_SIZE, type Constraints, type Pair, type Solution } from '../engine';
import { addTeam, startSession, swapKeepers, type MatchState } from '../match/match';
import { DEFAULT_SETTINGS, INITIAL_STATE, engineOptions, noGKIds, teamBibs, type AppState, type Player, type Settings } from './model';
import { addEvening, buildEvening, eveningId, mergeHistory, nightOf, stampSides, teamMembers, type EveningRecord } from './history';
import { addFromBench, lateArrive, lateJoin, type LateChoice } from './late';
import { moveBorrowers } from './borrow';
import { holdKeepers, holdKeepersOnNoGK, leaveEarly, leaveMany, subIn, type LeaveCtx } from './leave';
import { sampleSquad, SAMPLE_PRESENT } from './sample';

export type Action =
  | { type: 'addPlayer'; player: Player; present?: boolean }
  | { type: 'updatePlayer'; player: Player }
  | { type: 'deletePlayer'; id: string }
  /** Delete several players in one step, so the history and sync see a single change. */
  | { type: 'deletePlayers'; ids: string[] }
  | { type: 'togglePresent'; id: string; now: number }
  | { type: 'setPresent'; ids: string[]; now: number }
  | { type: 'setTeamSize'; size: number }
  | { type: 'setSettings'; settings: Settings }
  | { type: 'resetWeights' }
  | { type: 'addConstraint'; kind: keyof Constraints; pair: Pair }
  | { type: 'removeConstraint'; kind: keyof Constraints; index: number }
  | {
      type: 'setResult';
      playerIds: string[];
      subIds: string[];
      sizes: number[];
      teamSize: number;
      assignment: number[];
      pool: Solution[];
      gkOrder: string[][];
      now: number;
    }
  /**
   * "שאפל" between matches: new teams from tonight's players. What was played is saved as its own
   * evening record (the reducer archives a dropped session) and a new match session starts.
   */
  | {
      type: 'shuffle';
      playerIds: string[];
      subIds: string[];
      sizes: number[];
      teamSize: number;
      assignment: number[];
      pool: Solution[];
      gkOrder: string[][];
      now: number;
    }
  | { type: 'showSolution'; assignment: number[]; gkOrder: string[][]; pool?: Solution[] }
  | { type: 'swap'; i: number; j: number }
  | { type: 'swapSub'; subId: string; i: number }
  | { type: 'applyAssignment'; assignment: number[]; swaps: [number, number][] }
  | { type: 'resetSwaps' }
  /** "סדר שוערים": swap two players of one team in its keeper order. */
  | { type: 'swapKeepers'; team: number; a: string; b: string }
  /** Someone arrived late (late.ts): he goes in now or waits on the side; nobody reshuffled. */
  | { type: 'lateJoin'; player?: Player; id: string; choice: LateChoice; seed: number; now: number }
  /** One or several arrived (v38): `players` = new to the roster; `wait` = all on the bench. */
  | { type: 'lateArrive'; players?: Player[]; ids: string[]; wait?: boolean; seed: number; now: number }
  /** Someone left early (leave.ts): out of the teams and today's attendance, nobody reshuffled. */
  | { type: 'leave'; id: string; now: number; subId?: string }
  /** Several left at once (leave.ts leaveMany): the same rules for each, in the order picked. */
  | { type: 'leaveMany'; ids: string[]; now: number }
  /** A sub joins a team that is short (after someone left). */
  | { type: 'subIn'; subId: string; team: number }
  /** A sub joins a team on request, nobody goes out: the team grows by one (late.ts). */
  | { type: 'addFromBench'; subId: string; team: number }
  /** "עוברים אליהם": players from the losing team join the short team for good (borrow.ts). */
  | { type: 'borrowMove'; team: number; from: number; ids: string[] }
  | { type: 'clearResult' }
  | { type: 'setMatch'; match: MatchState | null; now: number }
  /** End the evening: save it to the history (as `id`) and close the match session. */
  | { type: 'endEvening'; id: string; now: number }
  | { type: 'mergeHistory'; records: EveningRecord[] }
  | { type: 'deleteEvening'; id: string }
  | { type: 'importPlayers'; players: Player[]; constraints?: Constraints; settings?: Settings }
  | { type: 'loadSample'; now: number }
  | { type: 'clearAll' };

const samePair = (a: Pair, b: Pair) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

/** Swap two ids inside the keeper orders, keeping each one's slot. */
function swapInOrders(orders: string[][], a: string, b: string): string[][] {
  return orders.map((l) => l.map((id) => (id === a ? b : id === b ? a : id)));
}

/** Keeper orders for an assignment: each team's members keep their current slot order. */
function reorderKeepers(orders: string[][], playerIds: string[], asg: number[], k: number): string[][] {
  const slot = new Map<string, number>();
  orders.forEach((l) => l.forEach((id, i) => slot.set(id, i)));
  return Array.from({ length: k }, (_, t) =>
    playerIds.filter((_, i) => asg[i] === t).sort((a, b) => (slot.get(a) ?? 99) - (slot.get(b) ?? 99)),
  );
}

export function leaveCtx(state: AppState): LeaveCtx {
  return {
    players: state.players,
    options: engineOptions(state.settings),
    constraints: state.constraints,
    rotate: state.settings.gkMode === 'rotate',
    every: state.settings.gkSwitchGoals,
    noGK: noGKIds(state.players),
  };
}

/** Save the current match session as an evening record. */
function archive(state: AppState, now: number, id?: string): EveningRecord[] {
  if (!state.match || !state.result) return state.history;
  const rec = buildEvening({ match: state.match, result: state.result, players: state.players, bibs: teamBibs(state.settings, state.result.numTeams), now, id });
  return addEvening(state.history, rec);
}

export function reducer(state: AppState, action: Action): AppState {
  const next = baseReducer(state, action);
  if (next === state || action.type === 'clearAll' || action.type === 'endEvening') return next;
  const prev = state.match;
  let match = next.match;
  if (!prev || !state.result) return next;
  // Finished matches remember who played, so per-player wins survive later swaps.
  if (match && next.result && match.history.length > prev.history.length) {
    match = stampSides(match, prev.history.length, next.result);
    return { ...next, match };
  }
  // The session was dropped (re-split, player deleted, sample loaded…): keep what was played.
  if (!match || match.history.length < prev.history.length) {
    return { ...next, history: archive(state, 'now' in action ? action.now : Date.now()) };
  }
  // The teams changed under a match session: whoever is in goal stays in goal (new teams: no).
  if (next.result && next.result !== state.result && action.type !== 'shuffle' && action.type !== 'setResult') {
    const held = holdKeepers(state.result, prev, next.result, match, { ...leaveCtx(next), prevNoGK: noGKIds(state.players) });
    if (held !== match) return { ...next, match: held };
    return next;
  }
  // Someone was marked / unmarked "לא בשער" mid-evening: the keeper in goal stays (unless it's him).
  return holdKeepersOnNoGK(state, next);
}

/** Remove players with their attendance and pairs; today's teams go if any of them was in them. */
function deletePlayers(state: AppState, ids: string[]): AppState {
  const gone = new Set(ids);
  if (!state.players.some((p) => gone.has(p.id))) return state;
  const keep = (pr: Pair) => !gone.has(pr[0]) && !gone.has(pr[1]);
  const r = state.result;
  const inResult = !!r && [...r.playerIds, ...r.subIds].some((id) => gone.has(id));
  return {
    ...state,
    players: state.players.filter((p) => !gone.has(p.id)),
    presentIds: state.presentIds.filter((x) => !gone.has(x)),
    lastPresentIds: state.lastPresentIds.filter((x) => !gone.has(x)),
    constraints: { together: state.constraints.together.filter(keep), apart: state.constraints.apart.filter(keep) },
    result: inResult ? null : state.result,
    match: inResult ? null : state.match,
  };
}

function baseReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'addPlayer':
      return {
        ...state,
        players: [...state.players, action.player],
        presentIds: action.present ? [...state.presentIds, action.player.id] : state.presentIds,
      };
    case 'updatePlayer':
      return { ...state, players: state.players.map((p) => (p.id === action.player.id ? action.player : p)) };
    case 'deletePlayer':
      return deletePlayers(state, [action.id]);
    case 'deletePlayers':
      return deletePlayers(state, action.ids);
    case 'togglePresent':
      return {
        ...state,
        dayAt: action.now,
        presentIds: state.presentIds.includes(action.id)
          ? state.presentIds.filter((x) => x !== action.id)
          : [...state.presentIds, action.id],
      };
    case 'setPresent':
      return { ...state, presentIds: action.ids, dayAt: action.now };
    case 'setTeamSize':
      return { ...state, teamSize: Math.min(MAX_TEAM_SIZE, Math.max(MIN_TEAM_SIZE, Math.round(action.size))) };
    case 'setSettings':
      return { ...state, settings: action.settings };
    case 'resetWeights':
      return {
        ...state,
        settings: { ...state.settings, weights: DEFAULT_SETTINGS.weights, leadershipThreshold: DEFAULT_SETTINGS.leadershipThreshold },
      };
    case 'addConstraint': {
      const [a, b] = action.pair;
      if (a === b) return state;
      // A pair can't be both "together" and "apart": the new rule wins.
      const without = (list: Pair[]) => list.filter((p) => !samePair(p, action.pair));
      const constraints: Constraints = {
        together: without(state.constraints.together),
        apart: without(state.constraints.apart),
      };
      constraints[action.kind].push(action.pair);
      return { ...state, constraints };
    }
    case 'removeConstraint':
      return {
        ...state,
        constraints: {
          ...state.constraints,
          [action.kind]: state.constraints[action.kind].filter((_, i) => i !== action.index),
        },
      };
    case 'setResult':
      return {
        ...state,
        dayAt: action.now,
        match: null,
        result: {
          playerIds: action.playerIds,
          subIds: action.subIds,
          sizes: action.sizes,
          teamSize: action.teamSize,
          numTeams: action.sizes.length,
          assignment: action.assignment,
          generated: action.assignment,
          pool: action.pool,
          shown: [action.assignment],
          gkOrder: action.gkOrder,
          createdAt: action.now,
        },
      };
    case 'shuffle': {
      const old = state.result;
      if (!old) return state;
      // The records of tonight's team sets share the night's first id (one evening in the stats).
      const night = state.match?.history.length ? nightOf(eveningId(old)) : old.night;
      return {
        ...state,
        dayAt: action.now,
        result: {
          playerIds: action.playerIds,
          subIds: action.subIds,
          sizes: action.sizes,
          teamSize: action.teamSize,
          numTeams: action.sizes.length,
          assignment: action.assignment,
          generated: action.assignment,
          pool: action.pool,
          shown: [action.assignment],
          gkOrder: action.gkOrder,
          createdAt: action.now,
          ...(night ? { night } : {}),
        },
        match: startSession(action.sizes.length),
      };
    }
    case 'showSolution':
      if (!state.result) return state;
      return {
        ...state,
        result: {
          ...state.result,
          assignment: action.assignment,
          generated: action.assignment,
          gkOrder: action.gkOrder,
          pool: action.pool ?? state.result.pool,
          shown: [...(action.pool ? [] : state.result.shown), action.assignment].slice(-50),
        },
      };
    case 'swap': {
      const r = state.result;
      if (!r) return state;
      const asg = [...r.assignment];
      [asg[action.i], asg[action.j]] = [asg[action.j], asg[action.i]];
      return { ...state, result: { ...r, assignment: asg, gkOrder: swapInOrders(r.gkOrder, r.playerIds[action.i], r.playerIds[action.j]) } };
    }
    case 'swapSub': {
      const r = state.result;
      if (!r || !r.subIds.includes(action.subId)) return state;
      const out = r.playerIds[action.i];
      return {
        ...state,
        result: {
          ...r,
          playerIds: r.playerIds.map((id, k) => (k === action.i ? action.subId : id)),
          subIds: r.subIds.map((id) => (id === action.subId ? out : id)),
          gkOrder: r.gkOrder.map((l) => l.map((id) => (id === out ? action.subId : id))),
          pool: [],
        },
      };
    }
    case 'applyAssignment': {
      const r = state.result;
      if (!r) return state;
      let gkOrder = r.gkOrder;
      for (const [i, j] of action.swaps) gkOrder = swapInOrders(gkOrder, r.playerIds[i], r.playerIds[j]);
      return { ...state, result: { ...r, assignment: action.assignment, generated: action.assignment, gkOrder } };
    }
    case 'resetSwaps': {
      const r = state.result;
      if (!r) return state;
      return { ...state, result: { ...r, assignment: r.generated, gkOrder: reorderKeepers(r.gkOrder, r.playerIds, r.generated, r.numTeams) } };
    }
    case 'swapKeepers': {
      const r = state.result;
      if (!r || action.team < 0 || action.team >= r.numTeams) return state;
      const gkOrder = Array.from({ length: r.numTeams }, (_, t) => (t === action.team ? swapKeepers(teamMembers(r, t), action.a, action.b) : (r.gkOrder[t] ?? [])));
      return { ...state, result: { ...r, gkOrder } };
    }
    case 'lateJoin': {
      if (!state.result) return state;
      const players = action.player ? [...state.players, action.player] : state.players;
      const presentIds = state.presentIds.includes(action.id) ? state.presentIds : [...state.presentIds, action.id];
      const j = lateJoin(state.result, state.match, action.id, action.choice, leaveCtx(state), action.seed);
      const grew = j.result.numTeams > state.result.numTeams;
      return {
        ...state,
        players,
        presentIds,
        dayAt: action.now,
        result: j.result,
        match: j.match && grew ? addTeam(j.match, j.result.numTeams - 1) : j.match,
      };
    }
    case 'lateArrive': {
      if (!state.result) return state;
      const known = new Set(state.players.map((p) => p.id));
      const players = [...state.players, ...(action.players ?? []).filter((p) => !known.has(p.id))];
      const s = { ...state, players };
      const j = lateArrive(state.result, state.match, action.ids, action.wait ? 'wait' : 'in', leaveCtx(s), action.seed);
      if (j.result === state.result) return state;
      let match = j.match;
      for (let t = state.result.numTeams; match && t < j.result.numTeams; t++) match = addTeam(match, t);
      return { ...s, presentIds: [...new Set([...state.presentIds, ...action.ids])], dayAt: action.now, result: j.result, match };
    }
    case 'leave': {
      if (!state.result) return state;
      const ctx = leaveCtx(state);
      // `subId`: the sub who comes in if his team would drop below 2 (a player runner picks him, no
      // ratings on that phone). The other subs are hidden from the pick, so `bestSub` can only take him.
      const subs = new Set(state.result.subIds.filter((x) => x !== action.subId));
      const l = leaveEarly(state.result, state.match, action.id, action.subId ? { ...ctx, players: ctx.players.filter((p) => !subs.has(p.id)) } : ctx);
      if (!l || l.outcome === 'blocked') return state;
      // Attendance follows the teams, so the result isn't "changed since the split".
      return { ...state, presentIds: state.presentIds.filter((x) => x !== action.id), dayAt: action.now, result: l.result, match: l.match };
    }
    case 'leaveMany': {
      if (!state.result) return state;
      const l = leaveMany(state.result, state.match, action.ids, leaveCtx(state));
      if (!l.gone.length) return state;
      const gone = new Set(l.gone);
      return { ...state, presentIds: state.presentIds.filter((x) => !gone.has(x)), dayAt: action.now, result: l.result, match: l.match };
    }
    case 'subIn': {
      if (!state.result) return state;
      const result = subIn(state.result, action.subId, action.team);
      return result === state.result ? state : { ...state, result };
    }
    case 'addFromBench': {
      if (!state.result) return state;
      const a = addFromBench(state.result, state.match, action.subId, action.team, leaveCtx(state));
      return a.result === state.result ? state : { ...state, result: a.result, match: a.match };
    }
    case 'borrowMove': {
      if (!state.result) return state;
      const mv = moveBorrowers(state.result, state.match, { team: action.team, from: action.from, ids: action.ids });
      return mv.result === state.result ? state : { ...state, result: mv.result, match: mv.match };
    }
    case 'clearResult':
      return { ...state, result: null, match: null };
    case 'setMatch':
      return { ...state, match: action.match, dayAt: action.now };
    case 'endEvening':
      return { ...state, history: archive(state, action.now, action.id), match: null, dayAt: action.now };
    case 'mergeHistory':
      return { ...state, history: mergeHistory(state.history, action.records) };
    case 'deleteEvening':
      return { ...state, history: state.history.filter((r) => r.id !== action.id) };
    case 'importPlayers': {
      return {
        ...state,
        players: action.players,
        constraints: action.constraints ?? state.constraints,
        // The look is per phone: an organizer's backup doesn't repaint your app.
        settings: action.settings ? { ...action.settings, theme: state.settings.theme, accent: state.settings.accent, goalSound: state.settings.goalSound } : state.settings,
      };
    }
    case 'loadSample': {
      // Merge: keep the user's own players, replace previous sample players.
      const own = state.players.filter((p) => !p.id.startsWith('sample-'));
      const ownIds = new Set(own.map((p) => p.id));
      return {
        ...state,
        players: [...own, ...sampleSquad()],
        presentIds: [...state.presentIds.filter((id) => ownIds.has(id)), ...SAMPLE_PRESENT],
        dayAt: action.now,
        result: null,
        match: null,
      };
    }
    case 'clearAll':
      return INITIAL_STATE;
  }
}
