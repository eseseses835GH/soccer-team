import type { Constraints, EngineOptions, Player, SearchResult } from '../engine';

export interface BalanceRequest {
  id: number;
  players: Player[];
  k: number;
  options: EngineOptions;
  constraints: Constraints;
  seed: number;
}

export type BalanceResponse = { id: number; ok: true; result: SearchResult } | { id: number; ok: false; error: string };
