import {
  ATTR_KEYS,
  DEFAULT_OPTIONS,
  DEFAULT_WEIGHTS,
  type Attributes,
  type Constraints,
  type EngineOptions,
  type Player,
  type Solution,
  type Weights,
} from '../engine';

export const MAX_TEAMS = 4;
export const MIN_PER_TEAM = 2;

export interface Settings {
  weights: Weights;
  leadershipThreshold: number;
}

export interface GameResult {
  /** Snapshot of the players (ids) the result was computed for, in order. */
  playerIds: string[];
  numTeams: number;
  assignment: number[];
  /** Near-optimal alternatives (assignments relative to playerIds). */
  pool: Solution[];
  /** Assignments already shown (for re-roll variety). */
  shown: number[][];
  /** Assignment as generated, before manual swaps (to show "edited"). */
  generated: number[];
  createdAt: number;
}

export interface AppState {
  version: 1;
  players: Player[];
  presentIds: string[];
  numTeams: number;
  settings: Settings;
  constraints: Constraints;
  result: GameResult | null;
}

export const DEFAULT_SETTINGS: Settings = {
  weights: { ...DEFAULT_WEIGHTS },
  leadershipThreshold: DEFAULT_OPTIONS.leadershipThreshold,
};

export const INITIAL_STATE: AppState = {
  version: 1,
  players: [],
  presentIds: [],
  numTeams: 2,
  settings: DEFAULT_SETTINGS,
  constraints: { together: [], apart: [] },
  result: null,
};

export function defaultAttrs(overall = 5): Attributes {
  const a = {} as Attributes;
  for (const k of ATTR_KEYS) a[k] = 5;
  a.overall = overall;
  return a;
}

export function engineOptions(s: Settings): EngineOptions {
  return { ...DEFAULT_OPTIONS, weights: s.weights, leadershipThreshold: s.leadershipThreshold };
}

export function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Validate/repair anything loaded from storage so a bad blob never crashes the app. */
export function sanitize(raw: unknown): AppState {
  if (!raw || typeof raw !== 'object') return INITIAL_STATE;
  const r = raw as Partial<AppState>;
  const players: Player[] = Array.isArray(r.players)
    ? r.players
        .filter((p): p is Player => !!p && typeof p.id === 'string' && typeof p.name === 'string')
        .map((p) => {
          const attrs = defaultAttrs();
          for (const k of ATTR_KEYS) {
            const v = Number(p.attrs?.[k]);
            if (Number.isFinite(v)) attrs[k] = Math.min(10, Math.max(1, Math.round(v)));
          }
          return { id: p.id, name: p.name, attrs, canGK: !!p.canGK };
        })
    : [];
  const ids = new Set(players.map((p) => p.id));
  const validPair = (pr: unknown): pr is [string, string] =>
    Array.isArray(pr) && pr.length === 2 && ids.has(pr[0]) && ids.has(pr[1]) && pr[0] !== pr[1];
  const weights = { ...DEFAULT_WEIGHTS };
  for (const k of ATTR_KEYS) {
    const v = Number(r.settings?.weights?.[k]);
    if (Number.isFinite(v) && v >= 0 && v <= 10) weights[k] = v;
  }
  const thr = Number(r.settings?.leadershipThreshold);
  const numTeams = Number(r.numTeams);
  let result = r.result ?? null;
  if (
    result &&
    (!Array.isArray(result.playerIds) ||
      !Array.isArray(result.assignment) ||
      result.assignment.length !== result.playerIds.length ||
      result.playerIds.some((id) => !ids.has(id)))
  ) {
    result = null;
  }
  return {
    version: 1,
    players,
    presentIds: Array.isArray(r.presentIds) ? r.presentIds.filter((id) => ids.has(id)) : [],
    numTeams: Number.isInteger(numTeams) && numTeams >= 2 && numTeams <= MAX_TEAMS ? numTeams : 2,
    settings: {
      weights,
      leadershipThreshold: Number.isFinite(thr) && thr >= 1 && thr <= 10 ? thr : DEFAULT_SETTINGS.leadershipThreshold,
    },
    constraints: {
      together: Array.isArray(r.constraints?.together) ? r.constraints.together.filter(validPair) : [],
      apart: Array.isArray(r.constraints?.apart) ? r.constraints.apart.filter(validPair) : [],
    },
    result: result ? { ...result, pool: result.pool ?? [], shown: result.shown ?? [], generated: result.generated ?? result.assignment } : null,
  };
}
