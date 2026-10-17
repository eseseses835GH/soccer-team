import type { Constraints, Pair, Player, Solution } from '../engine';
import { sampleSquad, SAMPLE_PRESENT } from './sample';
import { DEFAULT_SETTINGS, INITIAL_STATE, MAX_TEAMS, type AppState, type Settings } from './model';

export type Action =
  | { type: 'addPlayer'; player: Player; present?: boolean }
  | { type: 'updatePlayer'; player: Player }
  | { type: 'deletePlayer'; id: string }
  | { type: 'togglePresent'; id: string }
  | { type: 'setPresent'; ids: string[] }
  | { type: 'setNumTeams'; n: number }
  | { type: 'setSettings'; settings: Settings }
  | { type: 'resetSettings' }
  | { type: 'addConstraint'; kind: keyof Constraints; pair: Pair }
  | { type: 'removeConstraint'; kind: keyof Constraints; index: number }
  | { type: 'setResult'; playerIds: string[]; numTeams: number; best: Solution; pool: Solution[] }
  | { type: 'showSolution'; assignment: number[] }
  | { type: 'swap'; i: number; j: number }
  | { type: 'resetSwaps' }
  | { type: 'clearResult' }
  | { type: 'loadSample' }
  | { type: 'clearAll' };

const samePair = (a: Pair, b: Pair) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'addPlayer':
      return {
        ...state,
        players: [...state.players, action.player],
        presentIds: action.present ? [...state.presentIds, action.player.id] : state.presentIds,
      };
    case 'updatePlayer':
      return { ...state, players: state.players.map((p) => (p.id === action.player.id ? action.player : p)) };
    case 'deletePlayer': {
      const id = action.id;
      const keep = (pr: Pair) => pr[0] !== id && pr[1] !== id;
      return {
        ...state,
        players: state.players.filter((p) => p.id !== id),
        presentIds: state.presentIds.filter((x) => x !== id),
        constraints: { together: state.constraints.together.filter(keep), apart: state.constraints.apart.filter(keep) },
        result: state.result?.playerIds.includes(id) ? null : state.result,
      };
    }
    case 'togglePresent':
      return {
        ...state,
        presentIds: state.presentIds.includes(action.id)
          ? state.presentIds.filter((x) => x !== action.id)
          : [...state.presentIds, action.id],
      };
    case 'setPresent':
      return { ...state, presentIds: action.ids };
    case 'setNumTeams':
      return { ...state, numTeams: Math.min(MAX_TEAMS, Math.max(2, Math.round(action.n))) };
    case 'setSettings':
      return { ...state, settings: action.settings };
    case 'resetSettings':
      return { ...state, settings: DEFAULT_SETTINGS };
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
        result: {
          playerIds: action.playerIds,
          numTeams: action.numTeams,
          assignment: action.best.assignment,
          generated: action.best.assignment,
          pool: action.pool,
          shown: [action.best.assignment],
          createdAt: Date.now(),
        },
      };
    case 'showSolution':
      if (!state.result) return state;
      return {
        ...state,
        result: {
          ...state.result,
          assignment: action.assignment,
          generated: action.assignment,
          shown: [...state.result.shown, action.assignment].slice(-50),
        },
      };
    case 'swap': {
      if (!state.result) return state;
      const asg = [...state.result.assignment];
      [asg[action.i], asg[action.j]] = [asg[action.j], asg[action.i]];
      return { ...state, result: { ...state.result, assignment: asg } };
    }
    case 'resetSwaps':
      if (!state.result) return state;
      return { ...state, result: { ...state.result, assignment: state.result.generated } };
    case 'clearResult':
      return { ...state, result: null };
    case 'loadSample': {
      // Merge: keep the user's own players, replace previous sample players.
      const own = state.players.filter((p) => !p.id.startsWith('sample-'));
      const ownIds = new Set(own.map((p) => p.id));
      return {
        ...state,
        players: [...own, ...sampleSquad()],
        presentIds: [...state.presentIds.filter((id) => ownIds.has(id)), ...SAMPLE_PRESENT],
        result: null,
      };
    }
    case 'clearAll':
      return INITIAL_STATE;
  }
}
