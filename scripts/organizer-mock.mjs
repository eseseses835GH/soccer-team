// An organizer of a cloud group on a mocked Supabase (no real network, no real users), with the v12
// live row: only the runner writes, `p_rev` is checked when given, take_control moves the runner.
// Used by the e2e check and the screenshots for the runner handoff (organizer side).
export const ORG_ME = '00000000-0000-4000-8000-0000000000aa';

/** The mocked server: `live` is the row (change it to play another phone), `calls` every RPC. */
export function liveServer() {
  return { data: null, runner: null, runnerName: '', rev: 0, calls: [], roster: [], pushes: 0 };
}

const rowOf = (s) =>
  s.data
    ? [{ data: s.data, updated_by: s.runner, by_name: s.runnerName, updated_at: new Date().toISOString(), runner: s.runner, runner_name: s.runnerName, runner_since: null, rev: s.rev }]
    : [];

/** Route every Supabase call of `pg` to `s`. */
export async function organizerRoutes(pg, s, me = ORG_ME) {
  await pg.routeWebSocket(/supabase\.co/, () => {}); // realtime: accepted, silent
  await pg.route(/supabase\.co/, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.endsWith('/rest/v1/groups')) {
      if (req.method() === 'GET') return json({ id: u.searchParams.get('id').slice(3), name: 'שישי בשכונה', version: 1 + s.pushes, data: { v: 1, players: s.roster, constraints: { together: [], apart: [] } } });
      s.pushes++;
      return json([{ version: 1 + s.pushes }]);
    }
    const rpc = u.pathname.split('/rpc/')[1];
    let body = {};
    try {
      body = req.postDataJSON() ?? {};
    } catch {
      /* none */
    }
    s.calls.push({ rpc, body });
    if (rpc === 'live_get') return json(rowOf(s));
    if (rpc === 'live_set') {
      if (s.runner && s.runner !== me) return json({ code: '40001', message: 'someone else runs it', details: null, hint: null }, 409);
      if (body.p_rev != null && body.p_rev !== s.rev) return json({ code: '40001', message: 'stale rev', details: null, hint: null }, 409);
      s.data = body.p_data;
      s.runner = body.p_data ? me : null;
      s.runnerName = body.p_data ? 'אלי' : '';
      return json(++s.rev);
    }
    if (rpc === 'take_control') {
      if (!s.data) return json({ code: 'P0002', message: 'no evening', details: null, hint: null }, 404);
      s.runner = me;
      s.runnerName = 'אלי';
      s.rev++;
      return json(rowOf(s));
    }
    if (rpc === 'group_votes') return json([]);
    if (rpc === 'group_organizers') return json([{ user_id: me, display_name: 'אלי', joined_at: '2026-10-18T10:00:00Z', is_me: true }]);
    return json(null);
  });
}

/** Make the open group a synced one and log in (a fake session in localStorage). Reload after. */
export async function signInOrganizer(pg, me = ORG_ME) {
  await pg.evaluate((me) => {
    const idx = JSON.parse(localStorage.getItem('kochot:groups'));
    idx.groups = idx.groups.map((g) => (g.id === idx.currentId ? { ...g, name: 'שישי בשכונה', synced: true } : g));
    localStorage.setItem('kochot:groups', JSON.stringify(idx));
    const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const user = { id: me, aud: 'authenticated', role: 'authenticated', email: 'eli@example.com', app_metadata: {}, user_metadata: { name: 'אלי' }, created_at: '2026-10-18T10:00:00Z' };
    const access_token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: me, exp, role: 'authenticated', aud: 'authenticated', email: user.email })}.c2ln`;
    localStorage.setItem('sb-cieyeoyuwddobrxjcffw-auth-token', JSON.stringify({ access_token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user }));
  }, me);
}

/** The open group's state on the page. */
export const groupState = (pg) =>
  pg.evaluate(() => {
    const idx = JSON.parse(localStorage.getItem('kochot:groups'));
    return { gid: idx.currentId, index: idx, app: JSON.parse(localStorage.getItem(`kochot:group:${idx.currentId}`)) };
  });

/** Another phone (a player who took control) plays on: one more goal for the first team on the pitch, by its first player. */
export function playOnElsewhere(s, runner = '00000000-0000-4000-8000-0000000000cc', name = 'דני') {
  const d = JSON.parse(JSON.stringify(s.data));
  const m = d.match;
  const t = m.onPitch[0];
  m.goals.push({ team: t, by: d.teams[t].ids[0], at: Date.now() });
  m.score[0]++;
  if (m.conceded) m.conceded[m.onPitch[1]]++;
  d.at = Date.now();
  s.data = d;
  s.runner = runner;
  s.runnerName = name;
  s.rev++;
}
