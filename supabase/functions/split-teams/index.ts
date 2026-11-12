// Supabase Edge Function "split-teams" (DECISIONS → "Players start an evening (v20)").
// Any member of a group makes teams for tonight; the split runs here on the group's real ratings
// with the app's own balancing code (core.js, generated from src/server/splitTeams.ts by
// scripts/build-edge.mjs), and only the teams + one total per team go back.
// Deploy both files: index.ts and core.js. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided by
// Supabase; the service role is used only to read the caller's group after checking membership.
import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { corsHeaders, handleSplit } from './core.js';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const must = <T>(r: { data: T; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data;
};

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get('Origin'));
  const reply = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'method' }, 405);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    /* handled as invalid */
  }
  try {
    const res = await handleSplit(body, {
      async userId() {
        if (!token) return null;
        const { data, error } = await admin.auth.getUser(token);
        return error ? null : (data.user?.id ?? null);
      },
      async role(groupId: string, userId: string) {
        const row = must(await admin.from('group_members').select('role').eq('group_id', groupId).eq('user_id', userId).maybeSingle());
        return (row as { role?: string } | null)?.role ?? null;
      },
      async group(groupId: string) {
        return must(await admin.from('groups').select('data, rating_mode').eq('id', groupId).maybeSingle()) as { data: unknown; rating_mode: unknown } | null;
      },
      async members(groupId: string) {
        return (must(await admin.from('group_members').select('user_id, role, can_rate').eq('group_id', groupId)) ?? []) as {
          user_id: string;
          role: string;
          can_rate: boolean | null;
        }[];
      },
      async votes(groupId: string) {
        return (must(await admin.from('rating_votes').select('rater, player_id, level').eq('group_id', groupId)) ?? []) as unknown[];
      },
    });
    return reply(res.body, res.status);
  } catch (e) {
    console.error('split-teams', e instanceof Error ? e.message : e);
    return reply({ error: 'server' }, 500);
  }
});
