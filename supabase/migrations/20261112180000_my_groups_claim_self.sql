-- Kochot v21: the same login on a second device, and everyone who joins is "me" in the group.
--
-- 1. my_groups(): every group the caller belongs to (id, name, role, his live claim). A device used
--    to know only the groups created or joined on it; the app now asks after login, on open/focus
--    and in its slow poll, and adds what is missing.
-- 2. claim_self(group_id): a member (organizer or player) with no (live) claim is put in the roster
--    as himself — an unclaimed roster player with his name (ignoring case and spaces, as
--    join_as_new_player checks) is claimed, otherwise a new default-level player is appended (with
--    " 2", " 3"… when a claimed player already has that name) and claimed. The app calls it after
--    creating/uploading a group, right after join_group (either link), and for every group
--    my_groups() reports without a claim (so existing groups get fixed on the next open). A roster
--    change bumps groups.version (groups_touch), so organizers' phones pull and three-way merge it
--    like a self-joined player (v19).
-- 3. rename_my_player(group_id, name): "השם שלי בקבוצה" — rename the roster player I claimed.
-- 4. switch_my_player(group_id, player_id): "אני ברשימה בשם אחר" — move my claim to an unclaimed
--    roster player; the player claim_self created for me is removed if nobody touched him in the
--    history (group_members.auto_player_id remembers which one that was).

-- ---------- my groups ----------
-- player_id is null when the claim points at a player who is no longer in the roster.
create or replace function private.my_groups()
returns table (group_id uuid, name text, role text, player_id text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return query
    select g.id, g.name, m.role,
           case when m.player_id is not null and exists (
             select 1 from jsonb_array_elements(case when jsonb_typeof(g.data -> 'players') = 'array' then g.data -> 'players' else '[]'::jsonb end) p
             where p ->> 'id' = m.player_id
           ) then m.player_id end
    from public.group_members m
    join public.groups g on g.id = m.group_id
    where m.user_id = uid
    order by m.joined_at, g.id;
end;
$$;
revoke all on function private.my_groups() from public, anon;
grant execute on function private.my_groups() to authenticated;

create function public.my_groups()
returns table (group_id uuid, name text, role text, player_id text)
language sql security invoker set search_path = ''
as $$ select * from private.my_groups(); $$;
revoke all on function public.my_groups() from public, anon;
grant execute on function public.my_groups() to authenticated;

-- Which roster player claim_self created for this member (null: none, or he moved on).
alter table public.group_members add column if not exists auto_player_id text
  check (auto_player_id is null or char_length(auto_player_id) between 1 and 100);

-- Name key as join_as_new_player / the app's sameName: no spaces, lower case.
create or replace function private.name_key(t text)
returns text language sql immutable set search_path = ''
as $$ select lower(regexp_replace(coalesce(t, ''), '\s', '', 'g')); $$;
revoke all on function private.name_key(text) from public, anon;
grant execute on function private.name_key(text) to authenticated;

-- ---------- I'm in the roster as myself ----------
-- Members only (42501). Returns my player id: the existing live claim, an unclaimed player with my
-- name, or a new player. Returns null (and changes nothing) when my display name is empty
-- (private.display_name: full_name, name, the email's local part) or the roster is full (200).
create or replace function private.claim_self(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me public.group_members;
  roster jsonb;
  nm text;
  cand text;
  n int := 1;
  pid text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  -- Same lock as join_as_new_player: one roster change at a time per group.
  perform pg_advisory_xact_lock(hashtext('roster:' || p_group_id::text));
  select * into me from public.group_members m where m.group_id = p_group_id and m.user_id = uid;
  if me.user_id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select case when jsonb_typeof(g.data -> 'players') = 'array' then g.data -> 'players' else '[]'::jsonb end
    into roster
  from public.groups g where g.id = p_group_id
  for update;
  if roster is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- Already someone in the roster: nothing to do.
  if me.player_id is not null and exists (select 1 from jsonb_array_elements(roster) p where p ->> 'id' = me.player_id) then
    return me.player_id;
  end if;
  -- The app's player-name rules: trimmed, inner spaces collapsed, at most 24 characters.
  nm := btrim(left(btrim(regexp_replace(coalesce(private.display_name(uid), ''), '\s+', ' ', 'g')), 24));
  if nm = '' then
    return null;
  end if;
  -- An unclaimed roster player with my name (claims of deleted players don't count; mine is stale).
  select p ->> 'id' into pid
  from jsonb_array_elements(roster) with ordinality as r(p, i)
  where jsonb_typeof(p -> 'name') = 'string'
    and jsonb_typeof(p -> 'id') = 'string'
    and private.name_key(p ->> 'name') = private.name_key(nm)
    and not exists (
      select 1 from public.group_members o
      where o.group_id = p_group_id and o.user_id <> uid and o.player_id = p ->> 'id'
    )
  order by i
  limit 1;
  if pid is not null then
    update public.group_members m set player_id = pid where m.group_id = p_group_id and m.user_id = uid;
  else
    if jsonb_array_length(roster) >= 200 then
      return null;
    end if;
    -- The name is someone else's: "דני 2", "דני 3"…
    cand := nm;
    while exists (select 1 from jsonb_array_elements(roster) p where private.name_key(p ->> 'name') = private.name_key(cand)) loop
      n := n + 1;
      cand := btrim(left(nm, 24 - char_length(' ' || n))) || ' ' || n;
    end loop;
    pid := gen_random_uuid()::text;
    -- Same shape as join_as_new_player (the app's new player at the default level).
    update public.groups g
       set data = jsonb_set(
         case when jsonb_typeof(g.data) = 'object' then g.data else '{}'::jsonb end,
         '{players}',
         roster || jsonb_build_array(jsonb_build_object(
           'id', pid,
           'name', cand,
           'attrs', jsonb_build_object('overall', 5, 'stamina', 5, 'passing', 5, 'dribbling', 5,
                                       'shooting', 5, 'defense', 5, 'teamwork', 5, 'leadership', 5),
           'canGK', false,
           'cards', '[]'::jsonb
         )))
     where g.id = p_group_id;
    update public.group_members m set player_id = pid, auto_player_id = pid where m.group_id = p_group_id and m.user_id = uid;
  end if;
  -- Never a vote for yourself (as claim_player).
  delete from public.rating_votes v where v.group_id = p_group_id and v.rater = uid and v.player_id = pid;
  return pid;
end;
$$;
revoke all on function private.claim_self(uuid) from public, anon;
grant execute on function private.claim_self(uuid) to authenticated;

create function public.claim_self(p_group_id uuid)
returns text language sql security invoker set search_path = ''
as $$ select private.claim_self(p_group_id); $$;
revoke all on function public.claim_self(uuid) from public, anon;
grant execute on function public.claim_self(uuid) to authenticated;

-- ---------- "השם שלי בקבוצה": rename the player I claimed ----------
-- Members with a live claim (42501 otherwise). Name as join_as_new_player: trimmed, spaces
-- collapsed, 1–24 (22023). Another roster player with that name (ignoring case and spaces) →
-- 23505 'name_taken'.
create or replace function private.rename_my_player(p_group_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me public.group_members;
  roster jsonb;
  nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  idx int;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(nm) not between 1 and 24 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('roster:' || p_group_id::text));
  select * into me from public.group_members m where m.group_id = p_group_id and m.user_id = uid;
  if me.user_id is null or me.player_id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select case when jsonb_typeof(g.data -> 'players') = 'array' then g.data -> 'players' else '[]'::jsonb end
    into roster
  from public.groups g where g.id = p_group_id
  for update;
  select (i - 1)::int into idx from jsonb_array_elements(roster) with ordinality as r(p, i) where p ->> 'id' = me.player_id limit 1;
  if idx is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (
    select 1 from jsonb_array_elements(roster) p
    where p ->> 'id' <> me.player_id and private.name_key(p ->> 'name') = private.name_key(nm)
  ) then
    raise exception 'name_taken' using errcode = '23505';
  end if;
  update public.groups g
     set data = jsonb_set(g.data, array['players', idx::text, 'name'], to_jsonb(nm))
   where g.id = p_group_id;
end;
$$;
revoke all on function private.rename_my_player(uuid, text) from public, anon;
grant execute on function private.rename_my_player(uuid, text) to authenticated;

create function public.rename_my_player(p_group_id uuid, p_name text)
returns void language sql security invoker set search_path = ''
as $$ select private.rename_my_player(p_group_id, p_name); $$;
revoke all on function public.rename_my_player(uuid, text) from public, anon;
grant execute on function public.rename_my_player(uuid, text) to authenticated;

-- ---------- "אני ברשימה בשם אחר": move my claim to another roster player ----------
-- Members only (42501). The target must be in the roster (22023) and not claimed by someone else
-- (23505). My previous player is removed from the roster only if claim_self created him for me and
-- his id appears nowhere in the history or tonight's live evening. Returns true when he was removed.
create or replace function private.switch_my_player(p_group_id uuid, p_player_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me public.group_members;
  d jsonb;
  roster jsonb;
  removed boolean := false;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('roster:' || p_group_id::text));
  select * into me from public.group_members m where m.group_id = p_group_id and m.user_id = uid;
  if me.user_id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select case when jsonb_typeof(g.data) = 'object' then g.data else '{}'::jsonb end into d
  from public.groups g where g.id = p_group_id
  for update;
  roster := case when jsonb_typeof(d -> 'players') = 'array' then d -> 'players' else '[]'::jsonb end;
  if not exists (select 1 from jsonb_array_elements(roster) p where p ->> 'id' = p_player_id) then
    raise exception 'unknown player' using errcode = '22023';
  end if;
  if me.player_id = p_player_id then
    return false;
  end if;
  if exists (select 1 from public.group_members o where o.group_id = p_group_id and o.user_id <> uid and o.player_id = p_player_id) then
    raise exception 'already claimed' using errcode = '23505';
  end if;
  update public.group_members m set player_id = p_player_id, auto_player_id = null
   where m.group_id = p_group_id and m.user_id = uid;
  delete from public.rating_votes v where v.group_id = p_group_id and v.rater = uid and v.player_id = p_player_id;
  -- The automatic entry goes only while nothing refers to him: no evening in the history or live, no other claim.
  if me.player_id is not null and me.player_id = me.auto_player_id
     and position(to_jsonb(me.player_id)::text in coalesce(d -> 'history', '[]'::jsonb)::text) = 0
     and not exists (select 1 from public.group_live l where l.group_id = p_group_id and position(to_jsonb(me.player_id)::text in l.data::text) > 0)
     and not exists (select 1 from public.group_members o where o.group_id = p_group_id and o.player_id = me.player_id) then
    update public.groups g
       set data = jsonb_set(d, '{players}', coalesce(
         (select jsonb_agg(p order by i) from jsonb_array_elements(roster) with ordinality as r(p, i) where p ->> 'id' <> me.player_id),
         '[]'::jsonb))
     where g.id = p_group_id;
    -- His votes from players go with him.
    delete from public.rating_votes v where v.group_id = p_group_id and v.player_id = me.player_id;
    removed := true;
  end if;
  return removed;
end;
$$;
revoke all on function private.switch_my_player(uuid, text) from public, anon;
grant execute on function private.switch_my_player(uuid, text) to authenticated;

create function public.switch_my_player(p_group_id uuid, p_player_id text)
returns boolean language sql security invoker set search_path = ''
as $$ select private.switch_my_player(p_group_id, p_player_id); $$;
revoke all on function public.switch_my_player(uuid, text) from public, anon;
grant execute on function public.switch_my_player(uuid, text) to authenticated;
