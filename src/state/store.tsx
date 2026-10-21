import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { loadJSON, removeKey, saveJSON } from './storage';
import { NEW_DAY_MS, sanitize, type AppState } from './model';
import { reducer, type Action } from './reducer';
import {
  addGroup,
  cleanName,
  deleteGroupData,
  loadGroupState,
  loadIndex,
  newGroupState,
  removeGroup,
  saveGroupState,
  saveIndex,
  updateGroup,
  uuid,
  type GroupIndex,
  type GroupMeta,
  type KV,
} from './groups';

/** localStorage as a KV (never throws). */
export const localKV: KV = { get: (k) => loadJSON(k), set: (k, v) => saveJSON(k, v), remove: removeKey };

/** The open group's id travels with its state, so a save can never land in the wrong group. */
interface Root {
  gid: string;
  app: AppState;
}
type RootAction = Action | { type: '__load'; gid: string; app: AppState } | { type: '__set'; gid: string; app: AppState };

function rootReducer(root: Root, action: RootAction): Root {
  if (action.type === '__load') return { gid: action.gid, app: action.app };
  if (action.type === '__set') return action.gid === root.gid ? { ...root, app: action.app } : root;
  const app = reducer(root.app, action);
  return app === root.app ? root : { ...root, app };
}

const StoreCtx = createContext<{ state: AppState; dispatch: Dispatch<Action> } | null>(null);

export interface GroupsApi {
  index: GroupIndex;
  current: GroupMeta;
  switchTo(id: string): void;
  create(name: string): string;
  rename(id: string, name: string): void;
  /** Forget a group on this phone (the last one can't be removed). */
  remove(id: string): void;
  setMeta(id: string, patch: Partial<Omit<GroupMeta, 'id'>>): void;
  /** Add a group that came from the cloud (or update it) and switch to it. */
  adopt(meta: GroupMeta, app: AppState): void;
  /** Replace a group's state from outside the reducer (sync). Works for groups that aren't open too. */
  setGroupState(id: string, update: (s: AppState) => AppState): void;
  /** Latest state of the open group, for async code. */
  latest(): { gid: string; app: AppState };
  /** Latest group index, for async code. */
  latestIndex(): GroupIndex;
}

const GroupsCtx = createContext<GroupsApi | null>(null);

export function StoreProvider({ children, kv = localKV }: { children: ReactNode; kv?: KV }) {
  const [index, setIndex] = useState<GroupIndex>(() => loadIndex(kv));
  const [root, dispatchRoot] = useReducer(rootReducer, undefined, () => ({ gid: index.currentId, app: loadGroupState(kv, index.currentId) }));
  const rootRef = useRef(root);
  rootRef.current = root;
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    saveGroupState(kv, root.gid, root.app);
  }, [kv, root]);

  const dispatch = useCallback((a: Action) => dispatchRoot(a), []);

  // A new game day also starts when the app comes back to the screen without a reload (a phone that
  // kept the app open since last time): the same reset as on load (yesterday's evening is saved).
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'hidden') return;
      const { gid, app } = rootRef.current;
      if (!app.dayAt || Date.now() - app.dayAt <= NEW_DAY_MS || !(app.presentIds.length || app.result)) return;
      const next = { gid, app: sanitize(app) };
      rootRef.current = next;
      dispatchRoot({ type: '__set', ...next });
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('pageshow', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('pageshow', check);
    };
  }, []);

  /** Open a group. The look (theme, accent) is per phone, so it comes along. */
  const open = useCallback((id: string, app: AppState) => {
    const { theme, accent } = rootRef.current.app.settings;
    const next = { gid: id, app: { ...app, settings: { ...app.settings, theme, accent } } };
    rootRef.current = next;
    dispatchRoot({ type: '__load', ...next });
  }, []);

  const commitIndex = useCallback(
    (next: GroupIndex) => {
      indexRef.current = next;
      saveIndex(kv, next);
      setIndex(next);
    },
    [kv],
  );

  const groups = useMemo<GroupsApi>(() => {
    const current = index.groups.find((g) => g.id === index.currentId) ?? index.groups[0];
    const saveOpen = () => saveGroupState(kv, rootRef.current.gid, rootRef.current.app);
    return {
      index,
      current,
      switchTo(id) {
        if (id === rootRef.current.gid || !indexRef.current.groups.some((g) => g.id === id)) return;
        saveOpen();
        commitIndex({ ...indexRef.current, currentId: id });
        open(id, loadGroupState(kv, id));
      },
      create(name) {
        const id = uuid();
        saveOpen();
        const { theme, accent } = rootRef.current.app.settings;
        const app = newGroupState({ theme, accent });
        saveGroupState(kv, id, app);
        commitIndex({ ...addGroup(indexRef.current, { id, name: cleanName(name) || 'קבוצה חדשה', synced: false, createdAt: Date.now() }), currentId: id });
        open(id, app);
        return id;
      },
      rename(id, name) {
        commitIndex(updateGroup(indexRef.current, id, { name }));
      },
      remove(id) {
        const next = removeGroup(indexRef.current, id);
        if (next === indexRef.current) return;
        commitIndex(next);
        if (rootRef.current.gid === id) open(next.currentId, loadGroupState(kv, next.currentId));
        deleteGroupData(kv, id);
      },
      setMeta(id, patch) {
        commitIndex(updateGroup(indexRef.current, id, patch));
      },
      adopt(meta, app) {
        saveOpen();
        saveGroupState(kv, meta.id, app);
        commitIndex({ ...addGroup(indexRef.current, meta), currentId: meta.id });
        open(meta.id, app);
      },
      setGroupState(id, update) {
        if (rootRef.current.gid === id) {
          const next = { gid: id, app: update(rootRef.current.app) };
          rootRef.current = next;
          dispatchRoot({ type: '__set', ...next });
        } else {
          saveGroupState(kv, id, update(loadGroupState(kv, id)));
        }
      },
      latest: () => rootRef.current,
      latestIndex: () => indexRef.current,
    };
  }, [index, kv, open, commitIndex]);

  const value = useMemo(() => ({ state: root.app, dispatch }), [root.app, dispatch]);
  return (
    <GroupsCtx.Provider value={groups}>
      <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
    </GroupsCtx.Provider>
  );
}

/** The match screen on a state that isn't the open group's (a player running the match, sync/runner.ts). */
export function LocalStore({ value, children }: { value: { state: AppState; dispatch: Dispatch<Action> }; children: ReactNode }) {
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useStore outside StoreProvider');
  return ctx;
}

export function useGroups() {
  const ctx = useContext(GroupsCtx);
  if (!ctx) throw new Error('useGroups outside StoreProvider');
  return ctx;
}

/** Players who showed up today, in roster order. */
export function presentPlayers(state: AppState) {
  const set = new Set(state.presentIds);
  return state.players.filter((p) => set.has(p.id));
}

/** True if the teams on screen no longer match today's attendance or team size. */
export function isResultStale(state: AppState): boolean {
  const r = state.result;
  if (!r) return false;
  if (r.teamSize !== state.teamSize) return true;
  const inResult = new Set([...r.playerIds, ...r.subIds]);
  const present = new Set(state.presentIds);
  return inResult.size !== present.size || [...inResult].some((id) => !present.has(id));
}
