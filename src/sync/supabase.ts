// Supabase access. The library is loaded lazily, only when someone has signed in on this phone,
// opens the login sheet, or opens an invite/login link, so the offline, no-account app never
// downloads it or talks to the network.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SyncDoc } from './doc';
import type { RemoteApi, RemoteGroup } from './engine';
import { parseInvites, parseOrganizers, type Invite, type Organizer } from './organizers';
import type { MemberRole } from './players';

const URL_ = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '';
const KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ?? '';

/** False when the env vars are missing: the app then hides login and sync entirely. */
export const syncConfigured = /^https:\/\/[^/]+$/.test(URL_.replace(/\/$/, '')) && KEY.length > 10;

const projectRef = (() => {
  try {
    return new URL(URL_).hostname.split('.')[0];
  } catch {
    return '';
  }
})();

let clientP: Promise<SupabaseClient> | null = null;

export function getClient(): Promise<SupabaseClient> {
  if (!syncConfigured) return Promise.reject(new Error('sync not configured'));
  clientP ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(URL_, KEY, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    }),
  );
  return clientP;
}

/** A session (or a login in progress) is stored on this phone. */
export function hasStoredAuth(): boolean {
  if (!syncConfigured) return false;
  try {
    const prefix = `sb-${projectRef}-auth-token`;
    for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith(prefix)) return true;
  } catch {
    /* storage disabled */
  }
  return false;
}

/** Where login emails and Google send the user back to: this very app. */
export function redirectUrl(): string {
  return `${location.origin}${location.pathname}`;
}

/** Which login methods the project has turned on (Google needs dashboard setup). */
export async function authProviders(): Promise<{ google: boolean; email: boolean }> {
  try {
    const res = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: KEY } });
    const j = (await res.json()) as { external?: Record<string, boolean> };
    return { google: !!j.external?.google, email: j.external?.email !== false };
  } catch {
    return { google: false, email: true };
  }
}

export class SyncError extends Error {
  constructor(
    message: string,
    /**
     * taken = that roster player is already claimed by someone else (or you already claimed one).
     * conflict = live_set lost: someone else runs the evening, or the row moved on (stale rev).
     */
    readonly code: 'offline' | 'auth' | 'denied' | 'invalid' | 'taken' | 'conflict' | 'other',
  ) {
    super(message);
  }
}

export function fail(error: { message?: string; code?: string; status?: number } | null): never {
  const msg = error?.message ?? 'error';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new SyncError(msg, 'offline');
  if (/fetch|network|load failed/i.test(msg)) throw new SyncError(msg, 'offline');
  if (error?.code === 'PGRST301' || error?.code === '28000' || /jwt/i.test(msg)) throw new SyncError(msg, 'auth');
  if (error?.code === '42501') throw new SyncError(msg, 'denied');
  if (error?.code === 'P0002' || error?.code === '22023') throw new SyncError(msg, 'invalid');
  if (error?.code === '23505') throw new SyncError(msg, 'taken');
  if (error?.code === '40001') throw new SyncError(msg, 'conflict');
  throw new SyncError(msg, 'other');
}

export function remoteApi(sb: SupabaseClient): RemoteApi & {
  createGroup(id: string, name: string, data: SyncDoc): Promise<RemoteGroup>;
  createInvite(groupId: string): Promise<string>;
  /** `role`: what the caller is in the group now ('player' joined with the player link). */
  joinGroup(token: string): Promise<{ id: string; name: string; role: MemberRole }>;
  leaveGroup(groupId: string): Promise<void>;
  listOrganizers(groupId: string): Promise<Organizer[]>;
  listInvites(groupId: string): Promise<Invite[]>;
  revokeInvite(token: string): Promise<void>;
} {
  return {
    async fetchGroup(id) {
      const { data, error } = await sb.from('groups').select('id,name,data,version').eq('id', id).maybeSingle();
      if (error) fail(error);
      return data ? (data as RemoteGroup) : null;
    },
    async pushGroup(id, version, doc, name) {
      const patch: Record<string, unknown> = { data: doc };
      if (name !== undefined) patch.name = name;
      const { data, error } = await sb.from('groups').update(patch).eq('id', id).eq('version', version).select('version');
      if (error) fail(error);
      return data && data.length ? Number((data[0] as { version: number }).version) : null;
    },
    async createGroup(id, name, doc) {
      const { data, error } = await sb.rpc('create_group', { p_id: id, p_name: name, p_data: doc });
      if (error) fail(error);
      return data as RemoteGroup;
    },
    async createInvite(groupId) {
      const { data, error } = await sb.rpc('create_invite', { p_group_id: groupId });
      if (error) fail(error);
      return data as string;
    },
    async joinGroup(token) {
      const { data, error } = await sb.rpc('join_group', { p_token: token });
      if (error) fail(error);
      const row = (Array.isArray(data) ? data[0] : data) as { group_id: string; name: string; role?: string } | undefined;
      if (!row) throw new SyncError('invalid invite', 'invalid');
      return { id: row.group_id, name: row.name, role: row.role === 'player' ? 'player' : 'organizer' };
    },
    async leaveGroup(groupId) {
      const { error } = await sb.rpc('leave_group', { p_group_id: groupId });
      if (error) fail(error);
    },
    async listOrganizers(groupId) {
      const { data, error } = await sb.rpc('group_organizers', { p_group_id: groupId });
      if (error) fail(error);
      return parseOrganizers(data);
    },
    async listInvites(groupId) {
      const { data, error } = await sb
        .from('group_invites')
        .select('token,created_by,created_at,expires_at,revoked_at')
        .eq('group_id', groupId)
        .eq('role', 'organizer') // the player link is separate (playersApi.playerInvite)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) fail(error);
      return parseInvites(data);
    },
    async revokeInvite(token) {
      const { error } = await sb.rpc('revoke_invite', { p_token: token });
      if (error) fail(error);
    },
  };
}

/** Hebrew message for an auth error from Supabase. */
export function authErrorText(e: unknown): string {
  const err = e as { message?: string; status?: number; code?: string } | null;
  const msg = (err?.message ?? '').toLowerCase();
  const code = err?.code ?? '';
  if ((typeof navigator !== 'undefined' && navigator.onLine === false) || /fetch|network|load failed/.test(msg)) return 'אין חיבור לאינטרנט';
  if (err?.status === 429 || /rate limit|too many|security purposes/.test(msg) || code.includes('rate_limit')) return 'נשלחו יותר מדי בקשות. נסו שוב בעוד כמה דקות';
  if (code === 'invalid_credentials' || /invalid login credentials/.test(msg)) return 'מייל או סיסמה שגויים';
  if (code === 'email_not_confirmed' || /not confirmed/.test(msg)) return 'צריך קודם לאשר את המייל (בדקו את תיבת הדואר)';
  if (code === 'weak_password' || /password should be|password is too/.test(msg)) return 'הסיסמה חלשה מדי. לפחות 6 תווים';
  if (code === 'user_already_exists' || /already registered|already exists/.test(msg)) return 'כבר יש חשבון עם המייל הזה. נסו ״כניסה״';
  if (code === 'otp_expired' || /token has expired|otp|invalid token/.test(msg)) return 'הקוד שגוי או שפג תוקפו';
  if (code === 'validation_failed' || /invalid email|unable to validate email/.test(msg)) return 'כתובת המייל לא תקינה';
  if (code === 'signup_disabled' || /signups not allowed/.test(msg)) return 'הרשמה חדשה סגורה כרגע';
  if (/provider is not enabled|unsupported provider/.test(msg)) return 'ההתחברות עם Google עוד לא הופעלה. אפשר להתחבר עם מייל';
  if (/id.?token|nonce|audience|issuer/.test(msg)) return 'ההתחברות עם Google לא הצליחה. נסו שוב, או התחברו עם מייל';
  return 'משהו השתבש, נסו שוב';
}
