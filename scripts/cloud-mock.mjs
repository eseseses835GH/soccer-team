// A small fake Supabase for logging in from the login sheet (email + password) and keeping groups
// in the "cloud" (v13: a logged-in phone uploads its local group by itself). No real network, no
// real users: Playwright answers every request. Used by the e2e check and the screenshots.
export const CLOUD_ME = '00000000-0000-4000-8000-0000000000dd';

/** The server's state: groups by id ({ name, data, version }), every RPC call, logins. */
export function cloudServer() {
  return { groups: new Map(), calls: [], logins: 0 };
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
