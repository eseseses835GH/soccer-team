// Login session + keeping the open group in sync with the cloud.
// Local-first: every edit is saved on the phone at once (store.tsx). This provider only
// reconciles a *cloud* group with the server: on open, on focus, when back online, when another
// phone changes it (realtime, with a slow poll as a fallback) and ~1.5 s after a local edit.
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isUuid, newGroupState } from '../state/groups';
import { sanitize } from '../state/model';
import { localKV, useGroups, useStore } from '../state/store';
import { applyDoc, docFromState, mergeDocs, sanitizeDoc } from './doc';
import { EMPTY_META, hasLocalChanges, loadMeta, saveMeta, syncGroup } from './engine';
import { finishArrival, hasArrival } from './authUrl';
import { afterLoginQueue, limitText, shouldAutoUpload } from './gate';
import { JOIN_HASH, inviteUrl } from './organizers';
import { OrganizerSync } from './OrganizerSync';
import { isPlayerGroup, joinPlan, publicKey, runsOrganizerSync } from './playerGroup';
import { SyncError, getClient, hasStoredAuth, redirectUrl, remoteApi, syncConfigured } from './supabase';

export type SyncStatus = 'local' | 'signedOut' | 'syncing' | 'pending' | 'synced' | 'offline' | 'error' | 'gone';

export const STATUS_TEXT: Record<SyncStatus, string> = {
  local: 'בטלפון הזה בלבד',
  signedOut: 'לא מחוברים, לא מסונכרן',
  syncing: 'מסנכרן…',
  pending: 'מסנכרן…',
  synced: 'מסונכרן',
  offline: 'אין חיבור, יסונכרן כשיחזור',
  error: 'שגיאה בסנכרון',
  gone: 'הקבוצה לא נמצאה בחשבון',
};

/** players / group: a logged-out phone hit the free limits (sync/gate.ts). */
export type LoginReason = 'join' | 'upload' | 'account' | 'players' | 'group';

interface SyncApi {
  configured: boolean;
  /** null while unknown (library not loaded), false = signed out. */
  email: string | null | false;
  /** Logged-in user's id; null when signed out or unknown. */
  userId: string | null;
  /** Known to be logged out (login is available here). The free limits apply then. */
  loggedOut: boolean;
  status: SyncStatus;
  loginReason: LoginReason | null;
  /** `then` runs once the login succeeds in this page (closing the sheet drops it). */
  openLogin(reason?: LoginReason, then?: () => void): void;
  closeLogin(): void;
  client(): Promise<SupabaseClient>;
  signOut(): Promise<void>;
  syncNow(): void;
  /** Put the open (local) group in the cloud. Asks to log in first if needed. */
  uploadCurrent(): Promise<void>;
  /** A new group, opened. Logged in: a cloud group from the start (uploaded now, retried if that fails). */
  createGroup(name: string): string;
  /** An invite link for the open cloud group. */
  inviteLink(): Promise<string | null>;
  /** Leave the open cloud group (the last organizer deletes it). Returns false if it failed. */
  leaveCurrent(): Promise<boolean>;
  /** Handle an opened `#join=<token>` link. */
  startJoin(token: string): void;
  /** Toasts for the UI ({n} changes on every new message). */
  message: { text: string; n: number } | null;
}

const SyncCtx = createContext<SyncApi | null>(null);
export const PENDING_JOIN = 'kochot:pendingJoin';
export { JOIN_HASH };

const pendingJoin = () => {
  try {
    return !!localStorage.getItem(PENDING_JOIN);
  } catch {
    return false;
  }
};

const errCode = (e: unknown) => (e instanceof SyncError ? e.code : typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'other');

export function SyncProvider({ children }: { children: ReactNode }) {
  const groups = useGroups();
  const { state } = useStore();
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const clientRef = useRef<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const sessionRef = useRef<Session | null | undefined>(undefined);
  sessionRef.current = session;
  const [status, setStatus] = useState<SyncStatus>('local');
  const [loginReason, setLoginReason] = useState<LoginReason | null>(null);
  const [message, setMessage] = useState<SyncApi['message']>(null);
  const say = useCallback((text: string) => setMessage((m) => ({ text, n: (m?.n ?? 0) + 1 })), []);
  // A cap the server keeps refusing is said once, not on every retry.
  const said = useRef(new Set<string>());
  const sayOnce = useCallback(
    (key: string, text: string) => {
      if (said.current.has(key)) return;
      said.current.add(key);
      say(text);
    },
    [say],
  );
  const uploadRef = useRef<(silent?: boolean) => Promise<void>>(async () => {});

  // One promise for everyone (an invite link and the page load can ask at once): it resolves once
  // the session is known, including a login that came back through the address (authUrl.ts).
  const readyP = useRef<Promise<SupabaseClient> | null>(null);
  const ensureClient = useCallback(() => {
    readyP.current ??= (async () => {
      const c = await getClient();
      clientRef.current = c;
      c.auth.onAuthStateChange((_event, s) => {
        sessionRef.current = s;
        setSession(s);
      });
      const failed = await finishArrival(c.auth, typeof navigator !== 'undefined' && navigator.onLine === false);
      if (failed) say(failed);
      const { data } = await c.auth.getSession();
      sessionRef.current = data.session;
      setSession(data.session);
      return c;
    })().catch((e) => {
      readyP.current = null;
      throw e;
    });
    return readyP.current;
  }, [say]);

  // ---------- the sync loop ----------
  const running = useRef(false);
  const again = useRef(false);
  const timer = useRef<number>(undefined);

  const runSync = useCallback(async () => {
    const g = groupsRef.current;
    const { gid, app } = g.latest();
    const meta = g.latestIndex().groups.find((x) => x.id === gid);
    if (!meta?.synced) {
      // Logged in: a local group goes to the cloud by itself (v13).
      if (shouldAutoUpload({ loggedIn: !!sessionRef.current && !!clientRef.current, meta, app, pendingJoin: pendingJoin() })) void uploadRef.current(true);
      return setStatus('local');
    }
    const c = clientRef.current;
    // Player groups never run the organizer sync (PlayerGroupProvider reads them).
    if (!runsOrganizerSync(meta)) return setStatus(!sessionRef.current ? 'signedOut' : navigator.onLine === false ? 'offline' : 'synced');
    if (!c || !sessionRef.current) return setStatus(sessionRef.current === undefined && hasStoredAuth() ? 'syncing' : 'signedOut');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return setStatus('offline'); // retried on 'online'
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    setStatus('syncing');
    try {
      const local = docFromState(app);
      const out = await syncGroup(remoteApi(c), gid, local, meta.name, loadMeta(localKV, gid));
      if (out.kind === 'gone') {
        setStatus('gone');
      } else {
        saveMeta(localKV, gid, out.meta);
        if (out.pulled) {
          // Edits made on this phone while the round ran win over the server's copy.
          groupsRef.current.setGroupState(gid, (s) => sanitize(applyDoc(s, mergeDocs(local, docFromState(s), out.doc))));
        }
        if (out.name !== meta.name) groupsRef.current.setMeta(gid, { name: out.name });
        setStatus('synced');
      }
    } catch (e) {
      const code = errCode(e);
      setStatus(code === 'offline' ? 'offline' : code === 'auth' ? 'signedOut' : 'error');
      if (code === 'limit') sayOnce(`${gid}:${(e as Error).message}`, limitText((e as Error).message));
    } finally {
      running.current = false;
      if (again.current || groupsRef.current.latest().gid !== gid) {
        again.current = false;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void runSync(), 300);
      }
    }
  }, [sayOnce]);

  const schedule = useCallback(
    (ms: number) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void runSync(), ms);
    },
    [runSync],
  );

  // Load the library only if this phone has (or is finishing) a login, or opened an invite.
  useEffect(() => {
    if (!syncConfigured) return;
    const pending = (() => {
      try {
        return localStorage.getItem(PENDING_JOIN);
      } catch {
        return null;
      }
    })();
    if (hasStoredAuth() || hasArrival() || pending) {
      ensureClient().catch(() => setSession(null));
    } else {
      setSession(null);
    }
  }, [ensureClient]);

  // Sync when the session or the open group changes.
  const current = groups.current;
  const organizerSync = runsOrganizerSync(current);
  useEffect(() => {
    schedule(0);
  }, [session, current.id, current.synced, current.role, schedule]);

  // Logged in with a local group open: upload it once it qualifies (first own player), and retry a
  // failed upload when back on screen or online.
  const localOpen = !current.synced && current.role !== 'player' && !!session;
  useEffect(() => {
    if (!localOpen) return;
    if (shouldAutoUpload({ loggedIn: true, meta: current, app: state, pendingJoin: pendingJoin() })) schedule(1500);
  }, [state.players, localOpen, current, schedule]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!localOpen) return;
    const again = () => document.visibilityState === 'visible' && schedule(0);
    document.addEventListener('visibilitychange', again);
    window.addEventListener('online', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('online', again);
    };
  }, [localOpen, schedule]);

  // Local edits → push after a short pause. Tonight-only changes don't count.
  useEffect(() => {
    if (!organizerSync || !session) return;
    if (hasLocalChanges(loadMeta(localKV, current.id), docFromState(state), current.name)) {
      setStatus(navigator.onLine === false ? 'offline' : 'pending');
      schedule(1500);
    }
  }, [state, current.id, current.name, organizerSync, session, schedule]);

  // Focus, back online, a slow poll, and realtime updates from other phones.
  useEffect(() => {
    if (!organizerSync || !session) return;
    const onVisible = () => document.visibilityState === 'visible' && schedule(0);
    const onOnline = () => schedule(0);
    const onOffline = () => setStatus('offline');
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const poll = window.setInterval(() => document.visibilityState === 'visible' && schedule(0), 60_000);
    const c = clientRef.current;
    const channel = c
      ?.channel(`group-${current.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'groups', filter: `id=eq.${current.id}` }, (payload) => {
        const v = Number((payload.new as { version?: number }).version);
        if (!(v <= loadMeta(localKV, current.id).baseVersion)) schedule(250);
      })
      .subscribe();
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(poll);
      if (c && channel) void c.removeChannel(channel);
    };
  }, [current.id, organizerSync, session, schedule]);

  // ---------- join / upload / invite / leave ----------
  const afterLogin = useRef<LoginReason | null>(null);
  /** What the login was for (add the 5th player, open a new group…): done once logged in. */
  const thenQueue = useRef(afterLoginQueue()).current;

  const joining = useRef<string | null>(null);
  const doJoin = useCallback(
    async (token: string) => {
      if (joining.current === token) return; // already on it (link + login finishing at once)
      joining.current = token;
      try {
        const api = remoteApi(await ensureClient());
        const { id, name, role } = await api.joinGroup(token);
        const g = groupsRef.current;
        const known = g.latestIndex().groups.find((x) => x.id === id);
        const { theme, accent } = g.latest().app.settings;
        const plan = joinPlan(known, role);
        if (plan === 'player-new' || plan === 'player-open') {
          // Read-only: PlayerGroupProvider fills it from the public copy. A group this phone had as
          // an organizer starts empty (its ratings aren't his to keep).
          try {
            localStorage.removeItem(PENDING_JOIN);
          } catch {
            /* ignore */
          }
          if (plan === 'player-open') g.switchTo(id);
          else {
            saveMeta(localKV, id, EMPTY_META);
            g.adopt({ id, name, synced: true, createdAt: known?.createdAt ?? Date.now(), role: 'player' }, newGroupState({ theme, accent }));
          }
          say(`הצטרפתם לקבוצה ״${name}״`);
          return;
        }
        const row = await api.fetchGroup(id);
        if (!row) throw new SyncError('no access', 'denied');
        try {
          localStorage.removeItem(PENDING_JOIN);
        } catch {
          /* ignore */
        }
        if (plan === 'organizer-open') {
          g.setMeta(id, { synced: true });
          g.switchTo(id);
        } else {
          // New here, or a player group that became an organizer group: the server's copy, nothing local.
          const doc = sanitizeDoc(row.data);
          saveMeta(localKV, id, { base: doc, baseVersion: row.version, baseName: row.name });
          localKV.remove(publicKey(id));
          g.adopt(
            { id, name: row.name, synced: true, createdAt: known?.createdAt ?? Date.now(), role: undefined },
            sanitize(applyDoc(newGroupState({ theme, accent }), doc)),
          );
        }
        say(`הצטרפתם לקבוצה ״${row.name}״`);
      } catch (e) {
        const code = errCode(e);
        if (code === 'offline') return say('אין חיבור. נצטרף כשיחזור האינטרנט');
        try {
          localStorage.removeItem(PENDING_JOIN);
        } catch {
          /* ignore */
        }
        say(code === 'invalid' ? 'ההזמנה לא תקפה או שפג תוקפה' : code === 'limit' ? limitText((e as Error).message) : 'ההצטרפות לא הצליחה');
      } finally {
        joining.current = null;
      }
    },
    [ensureClient, say],
  );

  // `silent`: the automatic upload after login (v13) says nothing unless a server cap refused it.
  const uploading = useRef(new Set<string>());
  const upload = useCallback(
    async (silent = false) => {
      const c = await ensureClient();
      const api = remoteApi(c);
      const g = groupsRef.current;
      const { gid, app } = g.latest();
      const meta = g.latestIndex().groups.find((x) => x.id === gid);
      if (!meta || meta.synced || meta.role === 'player' || uploading.current.has(gid)) return;
      if (!isUuid(gid)) return silent ? undefined : say('לא ניתן לסנכרן את הקבוצה הזו');
      uploading.current.add(gid);
      try {
        const doc = docFromState(app);
        try {
          const row = await api.createGroup(gid, meta.name, doc);
          if (!row || typeof row.version !== 'number') throw new SyncError('no row', 'other');
          saveMeta(localKV, gid, { base: doc, baseVersion: row.version, baseName: row.name });
        } catch (e) {
          const code = errCode(e);
          // Already uploaded earlier (e.g. the answer got lost): merge with what is there.
          const existing = code === 'other' || code === 'taken' ? await api.fetchGroup(gid).catch(() => null) : null;
          if (!existing) {
            if (code === 'limit') return sayOnce(`${gid}:${(e as Error).message}`, limitText((e as Error).message));
            if (!silent) say(code === 'offline' ? 'אין חיבור לאינטרנט' : 'הסנכרון לא הצליח, נסו שוב');
            return;
          }
          saveMeta(localKV, gid, { ...EMPTY_META, baseName: existing.name });
        }
        g.setMeta(gid, { synced: true, upload: undefined });
        if (!silent) say('הקבוצה מסונכרנת. עכשיו אפשר להזמין מארגנים');
      } finally {
        uploading.current.delete(gid);
      }
    },
    [ensureClient, say, sayOnce],
  );
  uploadRef.current = upload;

  // After logging in: finish what the login was for.
  useEffect(() => {
    if (!session) return;
    let pending: string | null = null;
    try {
      pending = localStorage.getItem(PENDING_JOIN);
    } catch {
      /* ignore */
    }
    if (pending) void doJoin(pending);
    if (afterLogin.current === 'upload') void upload();
    afterLogin.current = null;
    setLoginReason(null);
    thenQueue.run();
  }, [session, doJoin, upload, thenQueue]);

  const api = useMemo<SyncApi>(
    () => ({
      configured: syncConfigured,
      email: session === undefined ? null : session ? (session.user.email ?? '') : false,
      userId: session?.user.id ?? null,
      loggedOut: syncConfigured && session === null,
      status: current.synced ? status : 'local',
      loginReason,
      message,
      openLogin(reason = 'account', then) {
        thenQueue.set(then ?? null);
        afterLogin.current = reason;
        setLoginReason(reason);
        ensureClient().catch(() => say('אין חיבור לאינטרנט'));
      },
      closeLogin() {
        thenQueue.clear();
        afterLogin.current = null;
        setLoginReason(null);
      },
      client: ensureClient,
      async signOut() {
        const c = clientRef.current;
        if (c) await c.auth.signOut({ scope: 'local' }).catch(() => {});
        setSession(null);
        say('יצאתם מהחשבון. הנתונים נשארים בטלפון');
      },
      syncNow: () => schedule(0),
      async uploadCurrent() {
        if (!sessionRef.current) {
          thenQueue.clear();
          afterLogin.current = 'upload';
          setLoginReason('upload');
          ensureClient().catch(() => say('אין חיבור לאינטרנט'));
          return;
        }
        await upload();
      },
      createGroup(name) {
        const g = groupsRef.current;
        const id = g.create(name);
        if (sessionRef.current) {
          g.setMeta(id, { upload: true });
          void upload(true);
        }
        return id;
      },
      async inviteLink() {
        const c = clientRef.current;
        const { gid } = groupsRef.current.latest();
        if (!c || !sessionRef.current) {
          setLoginReason('account');
          return null;
        }
        try {
          const token = await remoteApi(c).createInvite(gid);
          return inviteUrl(token, redirectUrl());
        } catch (e) {
          const code = errCode(e);
          say(code === 'offline' ? 'צריך אינטרנט כדי ליצור הזמנה' : code === 'limit' ? limitText((e as Error).message) : 'יצירת ההזמנה לא הצליחה');
          return null;
        }
      },
      async leaveCurrent() {
        const c = clientRef.current;
        const g = groupsRef.current;
        const { gid } = g.latest();
        if (!c || !sessionRef.current) {
          setLoginReason('account');
          return false;
        }
        try {
          await remoteApi(c).leaveGroup(gid);
        } catch (e) {
          say(errCode(e) === 'offline' ? 'צריך אינטרנט כדי לצאת מהקבוצה' : 'היציאה לא הצליחה');
          return false;
        }
        const meta = g.latestIndex().groups.find((x) => x.id === gid);
        if (isPlayerGroup(meta)) localKV.remove(publicKey(gid));
        if (g.latestIndex().groups.length > 1) g.remove(gid);
        else if (isPlayerGroup(meta)) {
          // Someone else's group: nothing to keep. A fresh local group takes its place.
          g.create('הקבוצה שלי');
          g.remove(gid);
        } else {
          // The only group on this phone: keep the data, as a local group.
          saveMeta(localKV, gid, EMPTY_META);
          g.setMeta(gid, { synced: false });
        }
        return true;
      },
      startJoin(token) {
        if (!syncConfigured) return say('ההצטרפות לא זמינה בגרסה הזו');
        try {
          localStorage.setItem(PENDING_JOIN, token);
        } catch {
          /* ignore */
        }
        ensureClient()
          .then(() => {
            if (sessionRef.current) void doJoin(token);
            else {
              thenQueue.clear();
              afterLogin.current = 'join';
              setLoginReason('join');
            }
          })
          .catch(() => say('אין חיבור לאינטרנט'));
      },
    }),
    [session, current.synced, status, loginReason, message, ensureClient, schedule, upload, doJoin, say, thenQueue],
  );

  return (
    <SyncCtx.Provider value={api}>
      {/* Organizer-only: live evening publishing + players' votes (OrganizerSync.tsx). */}
      <OrganizerSync>{children}</OrganizerSync>
    </SyncCtx.Provider>
  );
}

export function useSync() {
  const ctx = useContext(SyncCtx);
  if (!ctx) throw new Error('useSync outside SyncProvider');
  return ctx;
}

/** Whose level vote this phone casts: the logged-in organizer in a synced group, else null (no votes). */
export function useVoterId(): string | null {
  const sync = useContext(SyncCtx);
  const { current } = useGroups();
  return current.synced && sync?.userId ? sync.userId.toLowerCase() : null;
}
