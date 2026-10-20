// A cloud group's organizers and invite links: shaping what the server returns for the UI.
// Pure helpers (no network), so they are unit-tested on their own.

export interface Organizer {
  userId: string;
  name: string;
  joinedAt: string;
  isMe: boolean;
}

export interface Invite {
  token: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const validDate = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/** Rows of `group_organizers()`: drop malformed ones, give nameless logins a placeholder, oldest first. */
export function parseOrganizers(rows: unknown): Organizer[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof (r as { user_id?: unknown }).user_id === 'string')
    .map((r) => ({
      userId: r.user_id as string,
      name: str(r.display_name).trim().slice(0, 40) || 'מארגן/ת',
      joinedAt: validDate(r.joined_at) ? (r.joined_at as string) : '',
      isMe: r.is_me === true,
    }))
    .sort((a, b) => (Date.parse(a.joinedAt) || 0) - (Date.parse(b.joinedAt) || 0));
}

/** Rows of `group_invites`: only links that still work (not revoked, not expired), newest first. */
export function parseInvites(rows: unknown, now = Date.now()): Invite[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (r): r is Record<string, unknown> =>
        !!r && typeof r === 'object' && typeof (r as { token?: unknown }).token === 'string' && validDate((r as { expires_at?: unknown }).expires_at),
    )
    .filter((r) => !r.revoked_at && Date.parse(r.expires_at as string) > now)
    .map((r) => ({
      token: r.token as string,
      createdBy: typeof r.created_by === 'string' ? r.created_by : null,
      createdAt: validDate(r.created_at) ? (r.created_at as string) : '',
      expiresAt: r.expires_at as string,
    }))
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
}

/** Who made a link: "את/ה", an organizer's name, or someone who has since left. */
export function creatorName(inv: Invite, organizers: Organizer[]): string {
  const o = organizers.find((x) => x.userId === inv.createdBy);
  if (!o) return 'מארגן/ת לשעבר';
  return o.isMe ? 'את/ה' : o.name;
}

/** A short Hebrew date, e.g. "20.10.26". */
export function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' });
}

/** "בתוקף עוד 13 ימים" … "בתוקף פחות מיום" until a link expires. */
export function expiresIn(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso) - now;
  if (Number.isNaN(ms) || ms < 86_400_000) return 'בתוקף פחות מיום';
  const days = Math.round(ms / 86_400_000);
  if (days === 1) return 'בתוקף עוד יום';
  if (days === 2) return 'בתוקף עוד יומיים';
  return `בתוקף עוד ${days} ימים`;
}

export const JOIN_HASH = '#join=';

/** The link someone opens to join (the app's own address + `#join=<token>`). */
export function inviteUrl(token: string, base: string): string {
  return `${base}${JOIN_HASH}${token}`;
}
