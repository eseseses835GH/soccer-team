// The quick rating right after an import (v14): one new player at a time, level 1–10 or skip.
// Each tap is saved at once through the edit sheet's level path, so closing midway keeps it.
import type { Position } from '../engine';
import type { Player } from './model';
import { withPositions } from './positions';
import { playerAtLevel, type VoteRow } from '../sync/players';

export interface Round {
  ids: string[];
  at: number;
}

export const startRound = (ids: string[]): Round => ({ ids, at: 0 });
/** On to the next player still in the roster (one deleted meanwhile is passed over). */
export function nextStep(r: Round, players: Pick<Player, 'id'>[]): Round {
  let at = r.at + 1;
  while (at < r.ids.length && !players.some((p) => p.id === r.ids[at])) at++;
  return { ...r, at };
}
export const roundDone = (r: Round) => r.at >= r.ids.length;

/** A level tap: the level (or the organizer's vote in a synced group) plus the chips picked on this step. */
export function rateStep(p: Player, level: number, canGK: boolean, positions: Position[], voter: string | null, rows: VoteRow[]): Player {
  return withPositions(playerAtLevel({ ...p, canGK }, level, voter, rows), positions);
}
