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
import { JOIN_HASH, inviteUrl } from './organizers';
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

export type LoginReason = 'join' | 'upload' | 'account';

interface SyncApi {
  configured: boolean;
  /** null while unknown (library not loaded), false = signed out. */
  email: string | null | false;
  /** Logged-in user's id; null when signed out or unknown. */
  userId: string | null;
  status: SyncStatus;
  loginReason: LoginReason | null;
  openLogin(reason?: LoginReason): void;
  closeLogin(): void;
  client(): Promise<SupabaseClient>;
  signOut(): Promise<void>;
  syncNow(): void;
  /** Put the open (local) group in the cloud. Asks to log in first if needed. */
  uploadCurrent(): Promise<void>;
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
const PENDING_JOIN = 'kochot:pendingJoin';
export { JOIN_HASH };

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

  const ensureClient = useCallback(async () => {
    if (clientRef.current) return clientRef.current;
    const c = await getClient();
    if (!clientRef.current) {
      clientRef.current = c;
      c.auth.onAuthStateChange((_event, s) => {
        sessionRef.current = s;
        setSession(s);
      });
      // Waits for a login redirect (?code=…) to be exchanged for a session.
      const { data } = await c.auth.getSession();
      sessionRef.current = data.session;
      setSession(data.session);
      const url = new URL(location.href);
      if (url.searchParams.has('code') || url.searchParams.has('error_description') || url.searchParams.has('error')) {
        if (url.searchParams.has('error') || url.searchParams.has('error_description')) say('ההתחברות לא הצליחה, נסו שוב');
        history.replaceState(null, '', `${location.pathname}${location.hash}`);
      }
    }
    return clientRef.current;
  }, [say]);

  // ---------- the sync loop ----------
  const running = useRef(false);
  const again = useRef(false);
  const timer = useRef<number>(undefined);

  const runSync = useCallback(async () => {
    const g = groupsRef.current;
    const { gid, app } = g.latest();
    const meta = g.latestIndex().groups.find((x) => x.id === gid);
    if (!meta?.synced) return setStatus('local');
    const c = clientRef.current;
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
    } finally {
      running.current = false;
      if (again.current || groupsRef.current.latest().gid !== gid) {
        again.current = false;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void runSync(), 300);
      }
    }
  }, []);

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
    const params = new URLSearchParams(location.search);
    const pending = (() => {
      try {
        return localStorage.getItem(PENDING_JOIN);
      } catch {
        return null;
      }
    })();
    if (hasStoredAuth() || params.has('code') || params.has('error_description') || pending) {
      ensureClient().catch(() => setSession(null));
    } else {
      setSession(null);
    }
  }, [ensureClient]);

  // Sync when the session or the open group changes.
  const current = groups.current;
  useEffect(() => {
    schedule(0);
  }, [session, current.id, current.synced, schedule]);

  // Local edits → push after a short pause. Tonight-only changes don't count.
  useEffect(() => {
    if (!current.synced || !session) return;
    if (hasLocalChanges(loadMeta(localKV, current.id), docFromState(state), current.name)) {
      setStatus(navigator.onLine === false ? 'offline' : 'pending');
      schedule(1500);
    }
  }, [state, current.id, current.name, current.synced, session, schedule]);

  // Focus, back online, a slow poll, and realtime updates from other phones.
  useEffect(() => {
    if (!current.synced || !session) return;
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
  }, [current.id, current.synced, session, schedule]);

  // ---------- join / upload / invite / leave ----------
  const afterLogin = useRef<LoginReason | null>(null);

  const joining = useRef<string | null>(null);
  const doJoin = useCallback(
    async (token: string) => {
      if (joining.current === token) return; // already on it (link + login finishing at once)
      joining.current = token;
      try {
        const api = remoteApi(await ensureClient());
        const { id } = await api.joinGroup(token);
        const row = await api.fetchGroup(id);
        if (!row) throw new SyncError('no access', 'denied');
        try {
          localStorage.removeItem(PENDING_JOIN);
        } catch {
          /* ignore */
        }
        const g = groupsRef.current;
        const known = g.latestIndex().groups.find((x) => x.id === id);
        if (known) {
          g.setMeta(id, { synced: true });
          g.switchTo(id);
        } else {
          const doc = sanitizeDoc(row.data);
          const { theme, accent } = g.latest().app.settings;
          saveMeta(localKV, id, { base: doc, baseVersion: row.version, baseName: row.name });
          g.adopt({ id, name: row.name, synced: true, createdAt: Date.now() }, sanitize(applyDoc(newGroupState({ theme, accent }), doc)));
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
        say(code === 'invalid' ? 'ההזמנה לא תקפה או שפג תוקפה' : 'ההצטרפות לא הצליחה');
      } finally {
        joining.current = null;
      }
    },
    [ensureClient, say],
  );

  const upload = useCallback(async () => {
    const c = await ensureClient();
    const api = remoteApi(c);
    const g = groupsRef.current;
    const { gid, app } = g.latest();
    const meta = g.latestIndex().groups.find((x) => x.id === gid);
    if (!meta || meta.synced) return;
    if (!isUuid(gid)) return say('לא ניתן לסנכרן את הקבוצה הזו');
    const doc = docFromState(app);
    try {
      const row = await api.createGroup(gid, meta.name, doc);
      saveMeta(localKV, gid, { base: doc, baseVersion: row.version, baseName: row.name });
    } catch (e) {
      // Already uploaded earlier (e.g. the answer got lost): merge with what is there.
      const existing = errCode(e) === 'other' ? await api.fetchGroup(gid).catch(() => null) : null;
      if (!existing) return say(errCode(e) === 'offline' ? 'אין חיבור לאינטרנט' : 'הסנכרון לא הצליח, נסו שוב');
      saveMeta(localKV, gid, { ...EMPTY_META, baseName: existing.name });
    }
    g.setMeta(gid, { synced: true });
    say('הקבוצה מסונכרנת. עכשיו אפשר להזמין מארגנים');
  }, [ensureClient, say]);

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
  }, [session, doJoin, upload]);

  const api = useMemo<SyncApi>(
    () => ({
      configured: syncConfigured,
      email: session === undefined ? null : session ? (session.user.email ?? '') : false,
      userId: session?.user.id ?? null,
      status: current.synced ? status : 'local',
      loginReason,
      message,
      openLogin(reason = 'account') {
        afterLogin.current = reason;
        setLoginReason(reason);
        ensureClient().catch(() => say('אין חיבור לאינטרנט'));
      },
      closeLogin() {
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
          afterLogin.current = 'upload';
          setLoginReason('upload');
          ensureClient().catch(() => say('אין חיבור לאינטרנט'));
          return;
        }
        await upload();
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
          say(errCode(e) === 'offline' ? 'צריך אינטרנט כדי ליצור הזמנה' : 'יצירת ההזמנה לא הצליחה');
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
        if (g.latestIndex().groups.length > 1) g.remove(gid);
        else {
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
              afterLogin.current = 'join';
              setLoginReason('join');
            }
          })
          .catch(() => say('אין חיבור לאינטרנט'));
      },
    }),
    [session, current.synced, status, loginReason, message, ensureClient, schedule, upload, doJoin, say],
  );

  return <SyncCtx.Provider value={api}>{children}</SyncCtx.Provider>;
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
