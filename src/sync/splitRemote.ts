// A player's phone makes teams through the split-teams edge function (it never has the levels).
// DECISIONS → "Players start an evening (v20)". Pure helpers turn the reply into the app's state.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GameResult, Settings } from '../state/model';
import type { SplitReply, SplitRequest } from '../server/splitTeams';
import { SyncError } from './supabase';

export type { SplitReply, SplitRequest };

const isInts = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => Number.isInteger(x));
const isStrs = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** A reply from the function, checked (null = not one). */
export function parseSplitReply(raw: unknown): SplitReply | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<SplitReply>;
  if (!isStrs(r.playerIds) || !isStrs(r.subIds) || !isInts(r.sizes) || !isInts(r.assignment) || !isInts(r.totals)) return null;
  if (r.assignment.length !== r.playerIds.length || r.totals.length !== r.sizes.length || !r.sizes.length) return null;
  if (!Array.isArray(r.gkOrder) || !r.gkOrder.every(isStrs) || !Number.isInteger(r.teamSize) || !Number.isInteger(r.seed) || !r.rules) return null;
  return r as SplitReply;
}

/** The teams as the app's split result (no re-roll pool: a re-roll asks the server again). */
export function resultFromSplit(s: SplitReply, now: number, createdAt = now): GameResult {
  return {
    playerIds: s.playerIds,
    subIds: s.subIds,
    teamSize: s.teamSize,
    numTeams: s.sizes.length,
    sizes: s.sizes,
    assignment: s.assignment,
    generated: s.assignment,
    pool: [],
    shown: [s.assignment],
    gkOrder: s.gkOrder,
    createdAt,
  };
}

/** The group's match rules (bibs, keepers, length) on top of this phone's settings. */
export function withRules(base: Settings, s: SplitReply): Settings {
  const r = s.rules;
  return {
    ...base,
    gkMode: r.gkMode === 'fixed' ? 'fixed' : 'rotate',
    gkSwitchGoals: r.gkSwitchGoals,
    matchMinutes: r.matchMinutes,
    matchNoLimit: !!r.matchNoLimit,
    drawExtraMinutes: r.drawExtraMinutes,
    hasBibs: !!r.hasBibs,
    bibs: Array.isArray(r.bibs) && r.bibs.length >= 2 ? r.bibs : base.bibs,
  };
}

export function splitApi(sb: SupabaseClient) {
  return {
    async split(req: SplitRequest): Promise<SplitReply> {
      const { data, error } = await sb.functions.invoke('split-teams', { body: req });
      if (error) {
        const res = (error as { context?: unknown }).context;
        const status = res instanceof Response ? res.status : 0;
        let code = '';
        if (res instanceof Response) code = String(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? '');
        if (!status || (typeof navigator !== 'undefined' && navigator.onLine === false)) throw new SyncError(error.message, 'offline');
        throw new SyncError(code || error.message, status === 401 ? 'auth' : status === 403 ? 'denied' : status === 400 || status === 404 ? 'invalid' : 'other');
      }
      const reply = parseSplitReply(data);
      if (!reply) throw new SyncError('bad reply', 'other');
      return reply;
    },
  };
}
