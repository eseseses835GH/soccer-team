// A player running the match from his phone: React side of sync/runner.ts.
// DECISIONS → "Match runner handoff — player side (v12)".
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppState } from '../state/model';
import type { Action } from '../state/reducer';
import { localKV, useGroups } from '../state/store';
import { liveApi } from './live';
import { usePlayerGroup } from './PlayerGroupProvider';
import { createRunner, type Runner } from './runner';
import type { SyncError } from './supabase';
import { useSync } from './SyncProvider';

interface RunnerCtx {
  /** The evening this phone runs (null = it only watches). */
  app: AppState | null;
  dispatch(action: Action): void;
  take(): Promise<SyncError['code'] | null>;
  release(): Promise<SyncError['code'] | null>;
  /** The last time control went to someone else (for the toast). */
  lost: { name: string; at: number } | null;
}

const none = async () => 'other' as const;
const Ctx = createContext<RunnerCtx>({ app: null, dispatch: () => {}, take: none, release: none, lost: null });

export function RunnerProvider({ children }: { children: ReactNode }) {
  const groups = useGroups();
  const sync = useSync();
  const pg = usePlayerGroup();
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const gid = groups.current.id;
  const me = sync.userId;
  const [app, setApp] = useState<AppState | null>(null);
  const [lost, setLost] = useState<RunnerCtx['lost']>(null);
  const runner = useRef<Runner | null>(null);
  const liveRef = useRef(pg.live);
  liveRef.current = pg.live;

  useEffect(() => {
    if (!pg.active || !me) return;
    const lapi = async () => liveApi(await sync.client());
    const r = createRunner({
      gid,
      me,
      kv: localKV,
      api: {
        get: async (g) => (await lapi()).get(g),
        set: async (g, live, rev) => (await lapi()).set(g, live, rev),
        takeControl: async (g) => (await lapi()).takeControl(g),
        releaseControl: async (g) => (await lapi()).releaseControl(g),
      },
      base: () => groupsRef.current.latest().app,
      onChange: setApp,
      onLost: (name) => setLost({ name, at: Date.now() }),
    });
    runner.current = r;
    setApp(r.state());
    r.seen(liveRef.current);
    const online = () => void r.flush();
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('online', online);
      r.dispose();
      runner.current = null;
      setApp(null);
    };
  }, [pg.active, gid, me, sync.client]);

  useEffect(() => {
    runner.current?.seen(pg.live);
  }, [pg.live]);

  const dispatch = useCallback(
    (a: Action) => {
      const r = runner.current;
      const cur = r?.state();
      // The sound switch on the match screen is his own setting: keep it after he stops running.
      if (cur && a.type === 'setSettings' && a.settings.goalSound !== cur.settings.goalSound) {
        const goalSound = a.settings.goalSound;
        groupsRef.current.setGroupState(gid, (s) => ({ ...s, settings: { ...s.settings, goalSound } }));
      }
      r?.dispatch(a);
    },
    [gid],
  );
  const take = useCallback(() => runner.current?.take() ?? none(), []);
  const release = useCallback(() => runner.current?.release() ?? none(), []);

  const value = useMemo(() => ({ app, dispatch, take, release, lost }), [app, dispatch, take, release, lost]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useRunner = () => useContext(Ctx);
