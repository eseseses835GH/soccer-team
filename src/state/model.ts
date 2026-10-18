import {
  ATTR_KEYS,
  DEFAULT_OPTIONS,
  DEFAULT_WEIGHTS,
  MAX_TEAM_SIZE,
  MIN_TEAM_SIZE,
  type Attributes,
  type Constraints,
  type EngineOptions,
  type Player as EnginePlayer,
  type Solution,
  type Weights,
} from '../engine';
import { isCardId, type CardId } from './cards';
import type { MatchState } from '../match/match';
import { sanitizeMatch } from '../match/match';

export interface Player extends EnginePlayer {
  cards: CardId[];
}

export type GkMode = 'rotate' | 'fixed';

export const BIBS = [
  { id: 'red', name: 'אדומים', color: 'var(--bib-red)' },
  { id: 'blue', name: 'כחולים', color: 'var(--bib-blue)' },
  { id: 'yellow', name: 'צהובים', color: 'var(--bib-yellow)' },
  { id: 'green', name: 'ירוקים', color: 'var(--bib-green)' },
  { id: 'orange', name: 'כתומים', color: 'var(--bib-orange)' },
  { id: 'white', name: 'לבנים', color: 'var(--bib-white)' },
  { id: 'black', name: 'שחורים', color: 'var(--bib-black)' },
  { id: 'purple', name: 'סגולים', color: 'var(--bib-purple)' },
] as const;
export type BibId = (typeof BIBS)[number]['id'];
const BIB_IDS = new Set<string>(BIBS.map((b) => b.id));

export interface Settings {
  weights: Weights;
  leadershipThreshold: number;
  gkMode: GkMode;
  /** Keepers rotate every N goals conceded. */
  gkSwitchGoals: number;
  matchMinutes: number;
  /** Bib colours the group owns, in the order teams get them. */
  bibs: BibId[];
}

export interface GameResult {
  /** Players on teams, index-aligned with `assignment`. */
  playerIds: string[];
  /** Substitutes: present but not on a team. */
  subIds: string[];
  teamSize: number;
  numTeams: number;
  /** Team sizes the split was made for (largest first). */
  sizes: number[];
  assignment: number[];
  /** Assignment before manual swaps (for "undo swaps"). */
  generated: number[];
  /** Near-optimal alternatives for re-roll (empty after a late arrival: re-roll then re-runs the search). */
  pool: Solution[];
  shown: number[][];
  /** Goalkeeper rotation per team (player ids, first = starts in goal). */
  gkOrder: string[][];
  createdAt: number;
}

export interface AppState {
  version: 2;
  players: Player[];
  presentIds: string[];
  /** Attendance of the previous game day ("same as last time"). */
  lastPresentIds: string[];
  /** When attendance/teams were last touched; a new game day starts fresh. */
  dayAt: number;
  teamSize: number;
  settings: Settings;
  constraints: Constraints;
  result: GameResult | null;
  match: MatchState | null;
}

export const DEFAULT_SETTINGS: Settings = {
  weights: { ...DEFAULT_WEIGHTS },
  leadershipThreshold: DEFAULT_OPTIONS.leadershipThreshold,
  gkMode: 'rotate',
  gkSwitchGoals: 1,
  matchMinutes: 8,
  bibs: BIBS.map((b) => b.id),
};

export const INITIAL_STATE: AppState = {
  version: 2,
  players: [],
  presentIds: [],
  lastPresentIds: [],
  dayAt: 0,
  teamSize: 5,
  settings: DEFAULT_SETTINGS,
  constraints: { together: [], apart: [] },
  result: null,
  match: null,
};

/** A new game day starts this long after the last activity. */
export const NEW_DAY_MS = 12 * 60 * 60 * 1000;

export function defaultAttrs(level = 5): Attributes {
  const a = {} as Attributes;
  for (const k of ATTR_KEYS) a[k] = level;
  return a;
}

export function engineOptions(s: Settings): EngineOptions {
  return {
    ...DEFAULT_OPTIONS,
    weights: s.weights,
    leadershipThreshold: s.leadershipThreshold,
    gkPenalty: s.gkMode === 'fixed' ? DEFAULT_OPTIONS.gkPenalty : 0,
  };
}

export function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function teamLook(settings: Settings, t: number): { name: string; color: string } {
  const id = settings.bibs[t];
  const bib = BIBS.find((b) => b.id === id);
  return bib ? { name: bib.name, color: bib.color } : { name: `קבוצה ${t + 1}`, color: 'var(--bib-none)' };
}

const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt;
};

export function sanitizePlayer(p: unknown): Player | null {
  if (!p || typeof p !== 'object') return null;
  const r = p as Partial<Player> & { attrs?: Record<string, unknown> };
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || !r.name.trim()) return null;
  const attrs = defaultAttrs(num(r.attrs?.overall, 1, 10, 5));
  for (const k of ATTR_KEYS) {
    // v1 had "coordination" where v2 has "passing".
    const raw = r.attrs?.[k] ?? (k === 'passing' ? r.attrs?.coordination : undefined);
    const v = Number(raw);
    if (Number.isFinite(v)) attrs[k] = Math.min(10, Math.max(1, Math.round(v)));
  }
  const cards = Array.isArray(r.cards) ? r.cards.filter(isCardId).slice(0, 2) : [];
  return { id: r.id, name: r.name.trim().slice(0, 24), attrs, canGK: !!r.canGK, cards };
}

export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw ?? {}) as Partial<Settings>;
  const weights = { ...DEFAULT_WEIGHTS };
  for (const k of ATTR_KEYS) weights[k] = num(r.weights?.[k], 0, 10, DEFAULT_WEIGHTS[k]);
  const bibs = Array.isArray(r.bibs) ? r.bibs.filter((b): b is BibId => BIB_IDS.has(b)) : [];
  return {
    weights,
    leadershipThreshold: num(r.leadershipThreshold, 1, 10, DEFAULT_SETTINGS.leadershipThreshold),
    gkMode: r.gkMode === 'fixed' ? 'fixed' : 'rotate',
    gkSwitchGoals: Math.round(num(r.gkSwitchGoals, 1, 5, 1)),
    matchMinutes: Math.round(num(r.matchMinutes, 1, 60, DEFAULT_SETTINGS.matchMinutes)),
    bibs: bibs.length >= 2 ? [...new Set(bibs)] : DEFAULT_SETTINGS.bibs,
  };
}

/** Validate/repair anything loaded from storage (v1 or v2) so a bad blob never crashes the app. */
export function sanitize(raw: unknown, now = Date.now()): AppState {
  if (!raw || typeof raw !== 'object') return INITIAL_STATE;
  const r = raw as Partial<AppState> & { version?: number };
  const players = Array.isArray(r.players) ? r.players.map(sanitizePlayer).filter((p): p is Player => !!p) : [];
  const ids = new Set(players.map((p) => p.id));
  const validPair = (pr: unknown): pr is [string, string] =>
    Array.isArray(pr) && pr.length === 2 && ids.has(pr[0]) && ids.has(pr[1]) && pr[0] !== pr[1];
  const presentIds = Array.isArray(r.presentIds) ? r.presentIds.filter((id) => ids.has(id)) : [];
  const lastPresentIds = Array.isArray(r.lastPresentIds) ? r.lastPresentIds.filter((id) => ids.has(id)) : [];

  let result: GameResult | null = null;
  // v1 results have a different shape; only keep v2 ones that still make sense.
  if (r.version === 2 && r.result) {
    const g = r.result;
    const ok =
      Array.isArray(g.playerIds) &&
      Array.isArray(g.assignment) &&
      g.assignment.length === g.playerIds.length &&
      g.playerIds.every((id) => ids.has(id)) &&
      Array.isArray(g.subIds) &&
      g.subIds.every((id) => ids.has(id)) &&
      Number.isInteger(g.numTeams) &&
      g.assignment.every((t) => Number.isInteger(t) && t >= 0 && t < g.numTeams);
    if (ok) {
      result = {
        ...g,
        pool: Array.isArray(g.pool) ? g.pool.filter((s) => s?.assignment?.length === g.playerIds.length) : [],
        shown: Array.isArray(g.shown) ? g.shown : [],
        generated: g.generated?.length === g.assignment.length ? g.generated : g.assignment,
        gkOrder: Array.isArray(g.gkOrder) ? g.gkOrder.map((l) => (Array.isArray(l) ? l.filter((id) => ids.has(id)) : [])) : [],
        sizes: Array.isArray(g.sizes) ? g.sizes : [],
      };
    }
  }

  let state: AppState = {
    version: 2,
    players,
    presentIds,
    lastPresentIds,
    dayAt: num(r.dayAt, 0, Number.MAX_SAFE_INTEGER, 0),
    teamSize: Math.round(num(r.teamSize, MIN_TEAM_SIZE, MAX_TEAM_SIZE, 5)),
    settings: sanitizeSettings(r.settings),
    constraints: {
      together: Array.isArray(r.constraints?.together) ? r.constraints.together.filter(validPair) : [],
      apart: Array.isArray(r.constraints?.apart) ? r.constraints.apart.filter(validPair) : [],
    },
    result,
    match: result ? sanitizeMatch(r.match, result.numTeams) : null,
  };

  // Games aren't weekly and attendance changes: a new day starts with an empty list.
  if (state.dayAt && now - state.dayAt > NEW_DAY_MS && (state.presentIds.length || state.result)) {
    state = {
      ...state,
      lastPresentIds: state.presentIds.length ? state.presentIds : state.lastPresentIds,
      presentIds: [],
      result: null,
      match: null,
    };
  }
  return state;
}
