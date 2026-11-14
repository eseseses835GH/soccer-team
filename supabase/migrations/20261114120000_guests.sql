-- Kochot v23: guests ("אורח" / "מזדמנים", DECISIONS → "v23: guests").
--
-- A guest is a roster player with "occasional": true in groups.data.players. He plays like anyone;
-- the flag only decides where the app lists him and that nobody rates him.
--   1. public_doc: the players' whitelisted copy also carries "occasional" (true only), so players'
--      phones know who is a guest. Still never a level.
--   2. add_guest(group, name): whoever runs tonight adds a guest — an organizer, the member running
--      the open evening, or (no evening open) any member, who may open one himself (live_set, v20).
--      Same shape as join_as_new_player (level 5, no cards, not a keeper) plus "occasional", and
--      NOT claimed. groups.version is bumped by groups_touch, so organizers' phones re-merge (a
--      player added on the server is always kept) and group_public follows by its trigger.
--
-- Errors: 28000 not logged in, 42501 not a member / someone else runs the open evening,
-- 22023 bad name, 23505 'name_taken', 54000 'players_limit'.

-- ---------- public_doc: + occasional ----------
-- Body as in 20261021140000_public_positions.sql, plus the occasional flag.
create or replace function private.public_doc(d jsonb, gname text)
 returns jsonb
 language sql
 immutable
 set search_path to ''
as $function$
  select jsonb_build_object(
    'name', gname,
    'players', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', p.v -> 'id', 'name', p.v -> 'name')
        || case when jsonb_typeof(p.v -> 'positions') = 'array' then jsonb_build_object('positions', coalesce((
             select jsonb_agg(x.v order by x.i)
             from jsonb_array_elements(p.v -> 'positions') with ordinality x(v, i)
             where x.v in ('"def"'::jsonb, '"mid"'::jsonb, '"att"'::jsonb)
           ), '[]'::jsonb)) else '{}'::jsonb end
        || case when jsonb_typeof(p.v -> 'canGK') = 'boolean' then jsonb_build_object('canGK', p.v -> 'canGK') else '{}'::jsonb end
        || case when p.v -> 'occasional' = 'true'::jsonb then jsonb_build_object('occasional', true) else '{}'::jsonb end
        order by p.i)
      from jsonb_array_elements(case when jsonb_typeof(d -> 'players') = 'array' then d -> 'players' else '[]'::jsonb end)
        with ordinality p(v, i)
      where jsonb_typeof(p.v -> 'id') = 'string' and jsonb_typeof(p.v -> 'name') = 'string'
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(
        private.jpick(h.v, array['id', 'v', 'startedAt', 'endedAt', 'teamSize', 'subIds'])
        || jsonb_build_object(
          'players', private.jpick_each(h.v -> 'players', array['id', 'name']),
          'teams', private.jpick_each(h.v -> 'teams', array['bib', 'ids']),
          'matches', coalesce((
            select jsonb_agg(
              private.jpick(m.v, array['a', 'b', 'goalsA', 'goalsB', 'sides', 'ms', 'endedAt'])
              || jsonb_build_object('goals', private.jpick_each(m.v -> 'goals', array['team', 'by']))
              || case when jsonb_typeof(m.v -> 'pens') = 'object'
                   then jsonb_build_object('pens', private.jpick(m.v -> 'pens', array['winner', 'a', 'b']))
                   else '{}'::jsonb end
              order by m.i)
            from jsonb_array_elements(case when jsonb_typeof(h.v -> 'matches') = 'array' then h.v -> 'matches' else '[]'::jsonb end)
              with ordinality m(v, i)
            where jsonb_typeof(m.v) = 'object'
          ), '[]'::jsonb)
        ) order by h.i)
      from jsonb_array_elements(case when jsonb_typeof(d -> 'history') = 'array' then d -> 'history' else '[]'::jsonb end)
        with ordinality h(v, i)
      where jsonb_typeof(h.v) = 'object' and jsonb_typeof(h.v -> 'id') = 'string'
    ), '[]'::jsonb)
  );
$function$;

-- Refresh the existing public copies (only groups that already have a guest change).
update public.group_public gp
   set data = private.public_doc(g.data, g.name), updated_at = now()
  from public.groups g
 where g.id = gp.group_id
   and gp.data is distinct from private.public_doc(g.data, g.name);

-- ---------- add a guest ----------
-- Name: trimmed, inner spaces collapsed, 1–24 characters. Same name already in the roster (ignoring
-- case and spaces) → 23505 'name_taken'. More than 200 players → 54000 'players_limit'. Returns the new id.
create or replace function private.add_guest(p_group_id uuid, p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  org boolean;
  row_ public.group_live%rowtype;
  open_ boolean;
  roster jsonb;
  pid text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(nm) not between 1 and 24 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  if not private.is_group_member(p_group_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- One roster change at a time per group (as join_as_new_player / claim_self).
  perform pg_advisory_xact_lock(hashtext('roster:' || p_group_id::text));
  org := private.is_group_organizer(p_group_id);
  if not org then
    -- A player: the runner of the open evening, or anyone when no evening is open (he may open one,
    -- live_set v20). Not while someone else runs tonight.
    select * into row_ from public.group_live l where l.group_id = p_group_id;
    open_ := found and private.live_is_open(row_.data, row_.updated_at);
    if open_ and row_.runner is distinct from uid then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end if;
  select case when jsonb_typeof(g.data -> 'players') = 'array' then g.data -> 'players' else '[]'::jsonb end
    into roster
  from public.groups g where g.id = p_group_id
  for update;
  if roster is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (
    select 1 from jsonb_array_elements(roster) p
    where jsonb_typeof(p -> 'name') = 'string'
      and lower(regexp_replace(p ->> 'name', '\s', '', 'g')) = lower(regexp_replace(nm, '\s', '', 'g'))
  ) then
    raise exception 'name_taken' using errcode = '23505';
  end if;
  if jsonb_array_length(roster) >= 200 then
    raise exception 'players_limit' using errcode = '54000';
  end if;
  pid := gen_random_uuid()::text;
  update public.groups g
     set data = jsonb_set(
       case when jsonb_typeof(g.data) = 'object' then g.data else '{}'::jsonb end,
       '{players}',
       roster || jsonb_build_array(jsonb_build_object(
         'id', pid,
         'name', nm,
         'attrs', jsonb_build_object('overall', 5, 'stamina', 5, 'passing', 5, 'dribbling', 5,
                                     'shooting', 5, 'defense', 5, 'teamwork', 5, 'leadership', 5),
         'canGK', false,
         'cards', '[]'::jsonb,
         'occasional', true
       )))
   where g.id = p_group_id;
  return pid;
end;
$$;
revoke all on function private.add_guest(uuid, text) from public, anon;
grant execute on function private.add_guest(uuid, text) to authenticated;

create function public.add_guest(p_group_id uuid, p_name text)
returns text language sql security invoker set search_path = ''
as $$ select private.add_guest(p_group_id, p_name); $$;
revoke all on function public.add_guest(uuid, text) from public, anon;
grant execute on function public.add_guest(uuid, text) to authenticated;
