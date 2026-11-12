// A small fake Supabase for logging in from the login sheet (email + password) and keeping groups
// in the "cloud" (v13: a logged-in phone uploads its local group by itself). No real network, no
// real users: Playwright answers every request. Used by the e2e check and the screenshots.
export const CLOUD_ME = '00000000-0000-4000-8000-0000000000dd';

/**
 * The server's state: groups by id ({ name, data, version }), every RPC call, logins. `beforePush` runs once before the next group push.
 * v21 (opt-in, so older blocks see what they always saw): `mine` = my_groups rows ([{ group_id, name, role, player_id }]);
 * `selfName` = my display name for claim_self (null: it answers null, as the server does with no name);
 * `claims` = my claim per group (gid → player id), also answered by group_members_list when `selfName` is set;
 * `auto` = the player claim_self made for me (gid → id); `invites` = token → { gid, role } for join_group;
 * `roles` = my role per joined group (group_public_get answers for those).
 */
export function cloudServer() {
  return { groups: new Map(), calls: [], logins: 0, beforePush: null, mine: [], selfName: null, claims: new Map(), auto: new Map(), invites: {}, roles: new Map() };
}

const ATTRS5 = Object.fromEntries(['overall', 'stamina', 'passing', 'dribbling', 'shooting', 'defense', 'teamwork', 'leadership'].map((k) => [k, 5]));

/** What claim_self does (v21): an unclaimed player with my name, else a new default-level one ("x 2" if a claimed player has it); version bumped when the roster changes. */
export function claimSelfOnServer(s, gid) {
  const g = s.groups.get(gid);
  const players = g?.data?.players ?? [];
  const cur = s.claims.get(gid);
  if (cur && players.some((p) => p.id === cur)) return cur;
  if (!g || !s.selfName) return null;
  const key = (n) => n.replace(/\s/g, '').toLowerCase();
  let id = players.find((p) => key(p.name) === key(s.selfName) && p.id !== s.othersClaimed?.[gid])?.id;
  if (!id) {
    id = `self-${gid.slice(0, 4)}`;
    let name = s.selfName;
    for (let n = 2; players.some((p) => key(p.name) === key(name)); n++) name = `${s.selfName} ${n}`;
    g.data = { ...g.data, players: [...players, { id, name, attrs: ATTRS5, canGK: false, cards: [] }] };
    g.version++;
    s.auto.set(gid, id);
  }
  s.claims.set(gid, id);
  return id;
}

/** What join_as_new_player does to a group on the server (v19): append a default-level player, bump the version. */
export function joinOnServer(s, gid, id, name) {
  const g = s.groups.get(gid);
  g.data = { ...g.data, players: [...(g.data.players ?? []), { id, name, attrs: ATTRS5, canGK: false, cards: [] }] };
  g.version++;
}

/** What end_evening does on the server (v20): the evening a player ran goes into the group's history. */
export function endEveningOnServer(s, gid, record) {
  const g = s.groups.get(gid);
  g.data = { ...g.data, history: [record, ...(g.data.history ?? []).filter((h) => h.id !== record.id)].slice(0, 150) };
  g.version++;
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function session(me = CLOUD_ME) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: me, exp, role: 'authenticated', aud: 'authenticated', email: 'test@example.test' })}.c2ln`,
    refresh_token: 'r',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    user: { id: me, aud: 'authenticated', role: 'authenticated', email: 'test@example.test', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-10-21T10:00:00Z' },
  };
}

/** Route every Supabase call of `pg`'s context to `s`. */
export async function cloudRoutes(ctxOrPage, s) {
  await ctxOrPage.routeWebSocket(/supabase\.co/, () => {}); // realtime: accepted, silent
  await ctxOrPage.route(/supabase\.co/, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.endsWith('/auth/v1/settings')) return json({ external: { google: false, email: true } });
    if (u.pathname.endsWith('/auth/v1/token')) {
      s.logins++;
      return json(session());
    }
    if (u.pathname.endsWith('/auth/v1/logout')) return route.fulfill({ status: 204, body: '' });
    if (u.pathname.endsWith('/rest/v1/groups')) {
      const id = (u.searchParams.get('id') ?? '').slice(3);
      const g = s.groups.get(id);
      if (req.method() === 'GET') return json(g ? { id, name: g.name, data: g.data, version: g.version } : null);
      // v19: another write (a player joining) can land right before this push.
      const hook = s.beforePush;
      s.beforePush = null;
      hook?.();
      const want = Number((u.searchParams.get('version') ?? '').slice(3));
      if (!g || g.version !== want) return json([]);
      const patch = req.postDataJSON();
      Object.assign(g, patch, { version: g.version + 1 });
      return json([{ version: g.version }]);
    }
    const rpc = u.pathname.split('/rpc/')[1];
    let body = {};
    try {
      body = req.postDataJSON() ?? {};
    } catch {
      /* none */
    }
    s.calls.push({ rpc, body });
    if (rpc === 'create_group') {
      if (s.groups.has(body.p_id)) return json({ code: '23505', message: 'duplicate key', details: null, hint: null }, 409);
      const g = { name: body.p_name, data: body.p_data, version: 1 };
      s.groups.set(body.p_id, g);
      return json({ id: body.p_id, name: g.name, data: g.data, version: 1 });
    }
    if (rpc === 'my_groups') return json(s.mine);
    if (rpc === 'claim_self') return json(claimSelfOnServer(s, body.p_group_id));
    if (rpc === 'join_group' && s.invites[body.p_token]) {
      const { gid, role } = s.invites[body.p_token];
      s.roles.set(gid, role);
      return json([{ group_id: gid, name: s.groups.get(gid).name, role }]);
    }
    if (rpc === 'group_public_get' && s.roles.has(body.p_group_id)) {
      const gid = body.p_group_id;
      const g = s.groups.get(gid);
      const me = s.claims.get(gid) ?? null;
      return json({
        groupId: gid,
        name: g.name,
        players: (g.data.players ?? []).map((p) => ({ id: p.id, name: p.name })),
        history: [],
        claimed: [...(me ? [me] : []), ...(s.othersClaimed?.[gid] ? [s.othersClaimed[gid]] : [])],
        me: { role: s.roles.get(gid), playerId: me, canRate: false },
        updatedAt: new Date().toISOString(),
      });
    }
    if (rpc === 'rename_my_player') {
      const g = s.groups.get(body.p_group_id);
      const me = s.claims.get(body.p_group_id);
      const key = (n) => n.replace(/\s/g, '').toLowerCase();
      if (g.data.players.some((p) => p.id !== me && key(p.name) === key(body.p_name))) return json({ code: '23505', message: 'name_taken', details: null, hint: null }, 409);
      g.data = { ...g.data, players: g.data.players.map((p) => (p.id === me ? { ...p, name: body.p_name } : p)) };
      g.version++;
      return route.fulfill({ status: 204, body: '' });
    }
    if (rpc === 'switch_my_player') {
      const gid = body.p_group_id;
      const g = s.groups.get(gid);
      const old = s.claims.get(gid);
      s.claims.set(gid, body.p_player_id);
      const removed = !!old && old === s.auto.get(gid) && old !== body.p_player_id;
      s.auto.delete(gid);
      if (removed) {
        g.data = { ...g.data, players: g.data.players.filter((p) => p.id !== old) };
        g.version++;
      }
      return json(removed);
    }
    if (rpc === 'group_members_list' && s.selfName)
      return json([{ user_id: CLOUD_ME, display_name: s.selfName, role: 'organizer', player_id: s.claims.get(body.p_group_id) ?? null, can_rate: false, joined_at: '2026-10-21T10:00:00Z', is_me: true }]);
    if (rpc === 'live_get' || rpc === 'group_votes') return json([]);
    if (rpc === 'live_set') return json(s.calls.filter((c) => c.rpc === 'live_set').length);
    return json(null);
  });
}

/** Log in from the open login sheet with email + password (answered by the mock). */
export async function loginInSheet(pg) {
  const sheet = pg.getByRole('dialog', { name: 'התחברות' });
  await sheet.getByRole('radio', { name: 'מייל וסיסמה' }).click();
  await sheet.getByLabel('מייל', { exact: true }).fill('test@example.test');
  await sheet.getByLabel('סיסמה', { exact: true }).fill('test-only-pass');
  await sheet.getByRole('button', { name: 'כניסה', exact: true }).click();
  await sheet.waitFor({ state: 'detached', timeout: 10000 });
}
