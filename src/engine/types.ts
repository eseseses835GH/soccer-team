export const ATTR_KEYS = [
  'overall',
  'stamina',
  'passing',
  'dribbling',
  'shooting',
  'defense',
  'teamwork',
  'leadership',
] as const;

export type AttrKey = (typeof ATTR_KEYS)[number];
export type Attributes = Record<AttrKey, number>;
export type Weights = Record<AttrKey, number>;

export interface Player {
  id: string;
  name: string;
  attrs: Attributes;
  canGK: boolean;
}

export type Pair = [string, string];

export interface Constraints {
  together: Pair[];
  apart: Pair[];
}

export interface EngineOptions {
  weights: Weights;
  /** A player with leadership >= threshold counts as a "leader". */
  leadershipThreshold: number;
  /** Penalty per team missing a goalkeeper (when enough exist). 0 disables the rule. */
  gkPenalty: number;
  /** Penalty per team missing a leader (when enough exist). */
  leaderPenalty: number;
  /** Penalty per violated keep-together / keep-apart pair. */
  constraintPenalty: number;
  /** Penalty per player of size deviation from the target sizes. */
  sizePenalty: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  overall: 3,
  stamina: 1,
  passing: 1,
  dribbling: 1,
  shooting: 1,
  defense: 1,
  teamwork: 1,
  leadership: 1,
};

export const DEFAULT_OPTIONS: EngineOptions = {
  weights: DEFAULT_WEIGHTS,
  leadershipThreshold: 7,
  gkPenalty: 2,
  leaderPenalty: 1,
  constraintPenalty: 10,
  sizePenalty: 50,
};

/** assignment[i] = team index of players[i]. */
export type Assignment = number[];

export interface Solution {
  assignment: Assignment;
  cost: number;
}

export interface TeamStats {
  size: number;
  totals: Attributes;
  /** Weighted strength (sum over attrs of weight * value). */
  strength: number;
  goalkeepers: number;
  leaders: number;
}

export interface Evaluation {
  cost: number;
  balanceCost: number;
  penalties: {
    size: number;
    goalkeeper: number;
    leadership: number;
    constraints: number;
  };
  violations: {
    together: Pair[];
    apart: Pair[];
  };
  teams: TeamStats[];
  /** 0–100, higher is fairer. */
  score: number;
}
