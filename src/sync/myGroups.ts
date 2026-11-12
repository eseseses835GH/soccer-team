// The same login on another phone (v21): which groups the server says I belong to, and what this
// phone has to add or fix. Pure helpers; SyncProvider runs them after login, on open/focus and in
// the slow poll. Nothing is ever removed or switched to here.
import type { GroupMeta } from '../state/groups';
import type { MemberRole } from './players';

/** A row of my_groups(): a group I'm in, my role there and my (live) claim. */
export interface MyGroup {
  id: string;
  name: string;
  role: MemberRole;
  playerId: string | null;
}

export function parseMyGroups(rows: unknown): MyGroup[] {
  if (!Array.isArray(rows)) return [];
  const out: MyGroup[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.group_id !== 'string' || !o.group_id) continue;
    out.push({
      id: o.group_id,
      name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'קבוצה',
      role: o.role === 'organizer' ? 'organizer' : 'player',
      playerId: typeof o.player_id === 'string' && o.player_id ? o.player_id : null,
    });
  }
  return out;
}

/**
 * What to do on this phone: `organizer` / `player` = a membership this phone doesn't know (added like
 * after joining with that link), `upgrade` = a player group here that I organize now (made an
 * organizer elsewhere). Groups known here are matched by id and otherwise left alone, including
 * local (not yet uploaded) ones, which the upload path owns, and synced ones the server no longer
 * lists (left or removed: their data stays, as before).
 */
export function adoptionPlan(local: Pick<GroupMeta, 'id' | 'synced' | 'role'>[], mine: MyGroup[]): { kind: 'organizer' | 'player' | 'upgrade'; group: MyGroup }[] {
  const known = new Map(local.map((g) => [g.id, g]));
  const plan: { kind: 'organizer' | 'player' | 'upgrade'; group: MyGroup }[] = [];
  for (const g of mine) {
    const k = known.get(g.id);
    if (!k) plan.push({ kind: g.role, group: g });
    else if (k.synced && k.role === 'player' && g.role === 'organizer') plan.push({ kind: 'upgrade', group: g });
  }
  return plan;
}

/** Groups where I'm nobody in the roster yet (any role), not already tried in this session. */
export function selfClaimTargets(mine: MyGroup[], tried: ReadonlySet<string>): string[] {
  return mine.filter((g) => !g.playerId && !tried.has(g.id)).map((g) => g.id);
}
