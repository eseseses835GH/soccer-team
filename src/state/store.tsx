import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import { loadJSON, saveJSON } from './storage';
import { sanitize, type AppState } from './model';
import { reducer, type Action } from './reducer';

const KEY = 'kochot:v1';

const StoreCtx = createContext<{ state: AppState; dispatch: Dispatch<Action> } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => sanitize(loadJSON(KEY)));
  useEffect(() => {
    saveJSON(KEY, state);
  }, [state]);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useStore outside StoreProvider');
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
