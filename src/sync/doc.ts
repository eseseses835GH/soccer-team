// What a group shares between phones, and how two edited copies are merged.
//
// Shared ("durable"): players, pair rules, group settings (minus the per-phone look) and the
// evenings history when the app has one. Tonight's attendance, teams and the running match stay
// on each phone.
//
// Merging is three-way: `base` is the copy both sides last agreed on (the last successful sync),
// so a change on one side is told apart from "the other side didn't touch it". Rules:
// - Players / history records are merged by id. A change on one side wins; if both sides changed
//   the same record, the local copy wins; a record deleted on one side and edited on the other is
//   kept. A record added on either side is always kept, so a new player is never lost.
// - Pair rules are a set: added on either side → kept, removed on one side → removed.
// - Settings merge per field the same way.
import type { Constraints, Pair } from '../engine';
import { sanitizePlayer, sanitizeSettings, type AppState, type Player, type Settings } from '../state/model';

/** Settings that belong to the phone, never synced (each organizer keeps their own look). */
export const LOCAL_SETTINGS = ['theme', 'accent'] as const;

export type SharedSettings = Omit<Settings, (typeof LOCAL_SETTINGS)[number]>;

export interface SyncDoc {
  v: 1;
  players: Player[];
  constraints: Constraints;
  settings: SharedSettings;
  /** Evenings history (records with a string `id`), carried as-is when the app has one. */
  history?: { id: string }[];
}

/** Stable JSON (sorted keys) for equality checks that ignore key order. */
export function stableKey(v: unknown): string {
  if (v === undefined) return 'u';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableKey).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableKey(o[k])}`)
    .join(',')}}`;
}

const same = (a: unknown, b: unknown) => stableKey(a) === stableKey(b);

function sharedSettings(s: Settings): SharedSettings {
  const out = { ...s } as Partial<Settings>;
  for (const k of LOCAL_SETTINGS) delete out[k];
  return out as SharedSettings;
}

const isRecord = (r: unknown): r is { id: string } => !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string';

/** The part of the app state that is shared with the group's other phones. */
export function docFromState(state: AppState): SyncDoc {
  const doc: SyncDoc = {
    v: 1,
    players: state.players,
    constraints: state.constraints,
    settings: sharedSettings(state.settings),
  };
  const history = (state as AppState & { history?: unknown }).history;
  if (Array.isArray(history)) doc.history = history.filter(isRecord);
  return doc;
}

/** Validate a doc that came from the server or storage. Never throws. */
export function sanitizeDoc(raw: unknown): SyncDoc {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SyncDoc>;
  const players = Array.isArray(r.players) ? r.players.map(sanitizePlayer).filter((p): p is Player => !!p) : [];
  const pairs = (l: unknown): Pair[] =>
    Array.isArray(l) ? l.filter((p): p is Pair => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && typeof p[1] === 'string') : [];
  const doc: SyncDoc = {
    v: 1,
    players,
    constraints: { together: pairs(r.constraints?.together), apart: pairs(r.constraints?.apart) },
    settings: sharedSettings(sanitizeSettings(r.settings)),
  };
  if (Array.isArray(r.history)) doc.history = r.history.filter(isRecord);
  return doc;
}

/** Put a (merged) doc into this phone's state; the look and tonight's state stay local. */
export function applyDoc(state: AppState, doc: SyncDoc): AppState {
  const next = {
    ...state,
    players: doc.players,
    constraints: doc.constraints,
    settings: { ...state.settings, ...doc.settings, theme: state.settings.theme, accent: state.settings.accent },
  } as AppState & { history?: unknown };
  if (doc.history) next.history = doc.history;
  return next;
}

/** Three-way merge of records keyed by `id`. Order: local order, then records only the remote has. */
export function mergeById<T extends { id: string }>(base: T[], local: T[], remote: T[]): T[] {
  const b = new Map(base.map((x) => [x.id, x]));
  const l = new Map(local.map((x) => [x.id, x]));
  const r = new Map(remote.map((x) => [x.id, x]));
  const pick = (id: string): T | undefined => {
    const bv = b.get(id);
    const lv = l.get(id);
    const rv = r.get(id);
    if (same(lv, rv)) return lv;
    if (same(lv, bv)) return rv; // only the remote changed (or deleted) it
    if (same(rv, bv)) return lv; // only this phone changed (or deleted) it
    // Both changed it: an edit beats a delete, otherwise this phone wins.
    return lv ?? rv;
  };
  const out: T[] = [];
  const seen = new Set<string>();
  for (const id of [...l.keys(), ...r.keys()]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const v = pick(id);
    if (v) out.push(v);
  }
  return out;
}

const pairKey = (kind: string, [a, b]: Pair) => `${kind}:${a < b ? `${a}|${b}` : `${b}|${a}`}`;

function mergePairs(base: Constraints, local: Constraints, remote: Constraints, ids: Set<string>): Constraints {
  const keys = (c: Constraints) =>
    new Map((['together', 'apart'] as const).flatMap((k) => c[k].map((p) => [pairKey(k, p), p] as const)));
  const b = keys(base);
  const l = keys(local);
  const r = keys(remote);
  const out: Constraints = { together: [], apart: [] };
  const taken = new Set<string>();
  // Local first so that, if the same pair ended up both "together" and "apart", this phone's rule wins.
  for (const [key, pair] of [...l, ...r]) {
    const keep = (l.has(key) && r.has(key)) || (l.has(key) && !b.has(key)) || (r.has(key) && !b.has(key));
    const plain = pairKey('', pair);
    if (!keep || taken.has(plain) || !ids.has(pair[0]) || !ids.has(pair[1]) || pair[0] === pair[1]) continue;
    taken.add(plain);
    out[key.startsWith('together') ? 'together' : 'apart'].push(pair);
  }
  return out;
}

function mergeFields<T extends object>(base: T, local: T, remote: T): T {
  const out = { ...remote, ...local } as Record<string, unknown>;
  const bo = base as Record<string, unknown>;
  const lo = local as Record<string, unknown>;
  const ro = remote as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    if (same(lo[k], bo[k]) && k in ro) out[k] = ro[k];
  }
  return out as T;
}

/**
 * Merge this phone's doc with the server's. `base` is the last doc both agreed on
 * (null = never synced: then nothing counts as deleted and only additions/changes merge).
 */
export function mergeDocs(base: SyncDoc | null, local: SyncDoc, remote: SyncDoc): SyncDoc {
  const b: SyncDoc = base ?? { v: 1, players: [], constraints: { together: [], apart: [] }, settings: remote.settings };
  const players = mergeById(b.players, local.players, remote.players);
  const ids = new Set(players.map((p) => p.id));
  const doc: SyncDoc = {
    v: 1,
    players,
    constraints: mergePairs(b.constraints, local.constraints, remote.constraints, ids),
    settings: mergeFields(b.settings, local.settings, remote.settings),
  };
  if (local.history || remote.history) doc.history = mergeById(b.history ?? [], local.history ?? [], remote.history ?? []);
  return doc;
}

export const sameDoc = (a: SyncDoc | null, b: SyncDoc | null) => same(a, b);
