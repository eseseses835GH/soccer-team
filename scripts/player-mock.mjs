// A logged-in player on a mocked Supabase (no real network, no real users): used by the
// screenshots and the e2e check. The phone has one player group; every RPC is answered from `db`.
import { readFileSync } from 'node:fs';

const env = (() => {
  try {
    return readFileSync(new URL('../.env', import.meta.url), 'utf8');
  } catch {
    return '';
  }
})();
export const SB_URL = (/VITE_SUPABASE_URL=(\S+)/.exec(env)?.[1] ?? '').replace(/\/$/, '');
const REF = SB_URL ? new URL(SB_URL).hostname.split('.')[0] : '';

export const GID = '11111111-2222-4333-8444-555555555555';
export const ME = '99999999-8888-4777-8666-555555555555';
/** The organizer whose phone runs the evening until a player takes it (v12). */
export const ORG = '12121212-3434-4565-8787-909090909090';
const NAMES = ['אבי', 'בני', 'גיל', 'דני', 'הדר', 'ורד', 'זיו', 'חן', 'טל', 'יוסי', 'כפיר', 'ליאור', 'מתן'];
const POS = [['att'], [], ['mid', 'att'], ['def'], ['mid'], ['att'], ['def', 'mid'], [], ['def'], ['att'], [], ['mid'], ['def']];
const GK = new Set([1, 4, 8]);
export const ROSTER = NAMES.map((name, i) => ({ id: `p${i + 1}`, name }));
/** The public roster (positions and "good in goal" are public since public_positions). */
const PUBLIC_ROSTER = ROSTER.map((p, i) => ({ ...p, ...(POS[i].length ? { positions: POS[i] } : {}), ...(GK.has(i) ? { canGK: true } : {}) }));

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (exp) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ME, role: 'authenticated', aud: 'authenticated', exp, email: 'player@example.test' })}.c2ln`;

export function history(now) {
  const day = 24 * 3600e3;
  const t = now - 7 * day;
  const ids = (a, b) => ROSTER.slice(a, b).map((p) => p.id);
  return [
    {
      id: 'ev1',
      v: 1,
      startedAt: t,
      endedAt: t + 90 * 60e3,
      teamSize: 4,
      players: ROSTER.slice(0, 12),
      teams: [
        { bib: 'red', ids: ids(0, 4) },
        { bib: 'blue', ids: ids(4, 8) },
        { bib: 'yellow', ids: ids(8, 12) },
      ],
      subIds: [],
      matches: [
        { a: 0, b: 1, goalsA: 2, goalsB: 1, goals: [{ team: 0, by: 'p3' }, { team: 0, by: 'p1' }, { team: 1, by: 'p5' }], endedAt: t + 10 * 60e3 },
        { a: 0, b: 2, goalsA: 1, goalsB: 1, goals: [{ team: 0, by: 'p3' }, { team: 2, by: 'p9' }], endedAt: t + 20 * 60e3, pens: { winner: 0, a: 3, b: 2 } },
        { a: 0, b: 1, goalsA: 0, goalsB: 2, goals: [{ team: 1, by: 'p6' }, { team: 1 }], endedAt: t + 30 * 60e3 },
      ],
    },
  ];
}

/** Tonight: red (with me, p3) vs blue on the pitch, yellow waiting, one sub. */
export function liveData(now) {
  const ids = (a, b) => ROSTER.slice(a, b).map((p) => p.id);
  return {
    v: 1,
    at: now - 60e3,
    teamSize: 4,
    players: ROSTER,
    teams: [
      { bib: 'red', ids: ids(0, 4), keeper: 'p2' },
      { bib: 'blue', ids: ids(4, 8), keeper: 'p5' },
      { bib: 'yellow', ids: ids(8, 12), keeper: 'p9' },
    ],
    subs: ['p13'],
    match: {
      n: 3,
      onPitch: [0, 1],
      queue: [2],
      score: [2, 1],
      goals: [{ team: 0, by: 'p3' }, { team: 1, by: 'p6' }, { team: 0 }],
      clock: { running: true, startedAt: now - 3 * 60e3 - 12e3, elapsedMs: 0, lengthMs: 8 * 60e3 },
      extra: false,
      borrow: null,
      streak: [1, 0, 0],
      played: [
        { a: 0, b: 2, goalsA: 1, goalsB: 0 },
        { a: 0, b: 1, goalsA: 1, goalsB: 1, pens: { winner: 0, a: 3, b: 2 } },
      ],
    },
  };
}

/**
 * A browser context whose page is a logged-in player of one group. `db` (returned) is the mocked
 * server state: change it and reload. Options: me (claimed roster id or null), canRate, live (bool).
 * v12: `db.runner`/`runnerName`/`rev` (who runs the evening), `db.data` (the live JSON; live_set
 * writes it), `db.sets` (every accepted live_set: { rev, data }). Set `db.runner = ORG` to have
 * the organizer take control back: the player's next write gets 40001.
 */
export async function playerContext(browser, { scheme = 'light', me = null, canRate = true, live = true } = {}) {
  const now = Date.now();
  const db = {
    me,
    canRate,
    claimed: ['p1', 'p7', ...(me ? [me] : [])],
    live,
    votes: {},
    calls: [],
    runner: ORG,
    runnerName: 'אלי',
    rev: 4,
    data: liveData(now),
    sets: [],
  };
  const liveRow = () => ({
    data: db.data,
    updated_by: db.runner ?? ORG,
    by_name: db.runnerName || 'אלי',
    updated_at: new Date(Date.now() - 60e3).toISOString(),
    runner: db.runner,
    runner_name: db.runnerName,
    runner_since: null,
    rev: db.rev,
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
    isMobile: true,
    hasTouch: true,
    locale: 'he-IL',
    reducedMotion: 'reduce',
  });
  const exp = Math.floor(now / 1000) + 3600 * 24;
  const session = {
    access_token: jwt(exp),
    refresh_token: 'mock-refresh',
    token_type: 'bearer',
    expires_in: 3600 * 24,
    expires_at: exp,
    user: { id: ME, aud: 'authenticated', role: 'authenticated', email: 'player@example.test', app_metadata: {}, user_metadata: {}, created_at: new Date(now).toISOString() },
  };
  const index = { v: 1, currentId: GID, groups: [{ id: GID, name: 'כדורגל בשכונה', synced: true, createdAt: now, role: 'player' }] };
  await ctx.addInitScript(
    ([key, session, index]) => {
      if (localStorage.getItem('kochot:mock-init')) return;
      localStorage.setItem('kochot:mock-init', '1');
      localStorage.setItem(key, JSON.stringify(session));
      localStorage.setItem('kochot:groups', JSON.stringify(index));
    },
    [`sb-${REF}-auth-token`, session, index],
  );
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await ctx.route(`${SB_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let args = {};
    try {
      args = route.request().postDataJSON() ?? {};
    } catch {
      /* no body */
    }
    db.calls.push(path.split('/').pop());
    if (path.endsWith('/auth/v1/settings')) return json(route, { external: { google: false, email: true } });
    if (path.endsWith('/auth/v1/user')) return json(route, session.user);
    if (path.endsWith('/rpc/group_public_get'))
      return json(route, {
        groupId: GID,
        name: 'כדורגל בשכונה',
        players: PUBLIC_ROSTER,
        history: history(now),
        claimed: db.claimed,
        me: { role: 'player', playerId: db.me, canRate: db.canRate },
        updatedAt: new Date(now).toISOString(),
      });
    if (path.endsWith('/rpc/live_get'))
      return json(route, db.live ? [liveRow()] : []);
    if (path.endsWith('/rpc/take_control')) {
      if (!db.live) return json(route, { code: 'P0002', message: 'no evening' }, 404);
      db.runner = ME;
      db.runnerName = 'גיל';
      db.rev++;
      return json(route, [liveRow()]);
    }
    if (path.endsWith('/rpc/live_set')) {
      if (db.runner !== ME || (args.p_rev !== undefined && args.p_rev !== db.rev)) return json(route, { code: '40001', message: 'someone else runs it' }, 409);
      db.data = args.p_data;
      db.rev++;
      db.sets.push({ rev: args.p_rev, data: args.p_data });
      return json(route, db.rev);
    }
    if (path.endsWith('/rpc/release_control')) {
      if (db.runner === ME) {
        db.runner = null;
        db.runnerName = '';
        db.rev++;
      }
      return json(route, db.rev);
    }
    if (path.endsWith('/rpc/my_votes')) return json(route, db.votes);
    if (path.endsWith('/rpc/claim_player')) {
      if (db.claimed.includes(args.p_player_id)) return json(route, { code: '23505', message: 'taken' }, 409);
      db.me = args.p_player_id;
      db.claimed.push(db.me);
      return route.fulfill({ status: 204, body: '' });
    }
    if (path.endsWith('/rpc/submit_votes')) {
      for (const [k, v] of Object.entries(args.p_votes ?? {})) {
        if (v === null) delete db.votes[k];
        else db.votes[k] = v;
      }
      return json(route, db.votes);
    }
    if (path.endsWith('/rpc/leave_group')) return route.fulfill({ status: 204, body: '' });
    return json(route, {});
  });
  // Realtime: accept the socket, answer joins, ignore the rest.
  await ctx.routeWebSocket(/realtime/, (ws) => {
    ws.onMessage((raw) => {
      let m;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return; // binary or junk
      }
      // Phoenix serializer v2 sends [join_ref, ref, topic, event, payload]; v1 sends an object.
      const arr = Array.isArray(m);
      const [joinRef, ref, topic, event, payload] = arr ? m : [m.join_ref, m.ref, m.topic, m.event, m.payload];
      if (!ref) return;
      const response = event === 'phx_join' ? { postgres_changes: (payload?.config?.postgres_changes ?? []).map((c, i) => ({ ...c, id: i + 1 })) } : {};
      const reply = { status: 'ok', response };
      ws.send(JSON.stringify(arr ? [joinRef, ref, topic, 'phx_reply', reply] : { join_ref: joinRef, ref, topic, event: 'phx_reply', payload: reply }));
    });
  });
  const page = await ctx.newPage();
  return { ctx, page, db };
}
