-- Kochot v19: players build the roster themselves ("אני לא ברשימה").
--
-- An organizer can create a group with no players, share the player link, and whoever joins adds
-- himself: join_as_new_player(group, name) appends a new roster player to groups.data.players and
-- claims him for the caller, in one transaction. group_public follows by the existing trigger
-- (private.groups_public_sync → public_doc whitelist: id, name, positions, canGK — never a level),
-- and groups.version/updated_at are bumped by the existing groups_touch trigger, so organizers'
-- phones see a newer version and their conditional push ("where version = n") re-merges instead of
-- overwriting (three-way merge by player id: a player added on the server is always kept).
--
-- Also: a group created with an empty roster starts in rating mode 'everyone' (people who join
-- through the link are the ones who know each other), and a claim that points at a player the
-- organizer deleted no longer blocks claiming again.

-- ---------- join as a new roster player ----------
-- Player members only, while they have no (live) claim. Name: trimmed, inner spaces collapsed,
-- 1–24 characters (the app's player-name limit). Same name already in the roster (ignoring case and
-- spaces) → 23505 'name_taken'. More than 200 players → 54000 'players_limit'. Returns the new id.
create or replace function private.join_as_new_player(p_group_id uuid, p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me public.group_members;
  nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  roster jsonb;
  pid text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(nm) not between 1 and 24 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  -- One roster change at a time per group (two people joining at once both get in).
  perform pg_advisory_xact_lock(hashtext('roster:' || p_group_id::text));
  select * into me from public.group_members m where m.group_id = p_group_id and m.user_id = uid;
  if me.user_id is null or me.role <> 'player' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select case when jsonb_typeof(g.data -> 'players') = 'array' then g.data -> 'players' else '[]'::jsonb end
    into roster
  from public.groups g where g.id = p_group_id
  for update;
  if roster is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- Already someone in the roster (a claim of a deleted player doesn't count).
  if me.player_id is not null and exists (select 1 from jsonb_array_elements(roster) p where p ->> 'id' = me.player_id) then
    raise exception 'already claimed' using errcode = '23505';
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
  -- Same shape as a player the app adds at the default level (5, no cards, not a keeper).
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
         'cards', '[]'::jsonb
       )))
   where g.id = p_group_id;
  update public.group_members m set player_id = pid where m.group_id = p_group_id and m.user_id = uid;
  return pid;
end;
$$;
revoke all on function private.join_as_new_player(uuid, text) from public, anon;
grant execute on function private.join_as_new_player(uuid, text) to authenticated;

create function public.join_as_new_player(p_group_id uuid, p_name text)
returns text language sql security invoker set search_path = ''
as $$ select private.join_as_new_player(p_group_id, p_name); $$;
revoke all on function public.join_as_new_player(uuid, text) from public, anon;
grant execute on function public.join_as_new_player(uuid, text) to authenticated;

-- ---------- claim_player: a claim of a deleted roster player doesn't block a new one ----------
create or replace function private.claim_player(p_group_id uuid, p_player_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cur public.group_members;
  roster jsonb;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into cur from public.group_members m where m.group_id = p_group_id and m.user_id = uid;
  if not found then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select case when jsonb_typeof(g.data -> 'players') = 'array' then g.data -> 'players' else '[]'::jsonb end
    into roster
  from public.groups g where g.id = p_group_id;
  if cur.player_id is not null then
    if cur.player_id = p_player_id then return; end if;
    if exists (select 1 from jsonb_array_elements(roster) p where p ->> 'id' = cur.player_id) then
      raise exception 'already claimed' using errcode = '23505';
    end if;
  end if;
  if not exists (select 1 from jsonb_array_elements(roster) p where p ->> 'id' = p_player_id) then
    raise exception 'unknown player' using errcode = '22023';
  end if;
  begin
    update public.group_members m set player_id = p_player_id where m.group_id = p_group_id and m.user_id = uid;
  exception when unique_violation then
    raise exception 'already claimed' using errcode = '23505';
  end;
  -- Never a vote for yourself.
  delete from public.rating_votes v where v.group_id = p_group_id and v.rater = uid and v.player_id = p_player_id;
end;
$$;

-- ---------- create_group: an empty roster starts in 'everyone' rating mode ----------
-- Body as in 20261022120000_limits.sql, plus rating_mode.
create or replace function private.create_group(p_id uuid, p_name text, p_data jsonb)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  g public.groups;
  d jsonb := coalesce(p_data, '{}'::jsonb);
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('user_groups:' || uid::text));
  -- A retry of an upload that already went through still gets the usual unique violation (23505).
  if p_id is null or not exists (select 1 from public.groups x where x.id = p_id) then
    if (select count(*) from public.groups x where x.created_by = uid) >= 20 then
      raise exception 'groups_limit' using errcode = '54000';
    end if;
    if (select count(*) from public.group_members m where m.user_id = uid) >= 50 then
      raise exception 'memberships_limit' using errcode = '54000';
    end if;
  end if;
  insert into public.groups (id, name, data, created_by, updated_by, rating_mode)
  values (
    coalesce(p_id, gen_random_uuid()), btrim(p_name), d, uid, uid,
    case when jsonb_typeof(d -> 'players') = 'array' and jsonb_array_length(d -> 'players') > 0 then 'organizers' else 'everyone' end
  )
  returning * into g;
  insert into public.group_members (group_id, user_id, role) values (g.id, uid, 'organizer');
  return g;
end;
$$;
