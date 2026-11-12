-- Kochot v18: who rates in a group, and the per-player switch as an override.
--
-- groups.rating_mode: 'organizers' (default, as before: only players an organizer switched on) or
-- 'everyone' (every player member may rate unless an organizer switched him off).
-- group_members.can_rate becomes nullable: null = follow the mode, true/false = the organizer's
-- explicit switch. Existing true stays true; existing false becomes null (same meaning under the
-- default mode). The effective permission is private.can_rate_eff(role, can_rate, mode).
-- Nobody but organizers ever sees votes or levels (unchanged).

alter table public.groups add column rating_mode text not null default 'organizers'
  check (rating_mode in ('organizers', 'everyone'));

alter table public.group_members alter column can_rate drop not null;
alter table public.group_members alter column can_rate drop default;
update public.group_members set can_rate = null where can_rate = false;

create or replace function private.can_rate_eff(r text, c boolean, mode text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select r = 'player' and coalesce(c, mode = 'everyone'); $$;
revoke all on function private.can_rate_eff(text, boolean, text) from public, anon;
grant execute on function private.can_rate_eff(text, boolean, text) to authenticated;

-- ---------- organizer: switch the mode ----------
-- Votes are kept when the mode changes; only votes of members who may rate now count (group_votes).
create or replace function private.set_rating_mode(p_group_id uuid, p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_group_organizer(p_group_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('organizers', 'everyone') then
    raise exception 'invalid mode' using errcode = '22023';
  end if;
  update public.groups g set rating_mode = p_mode where g.id = p_group_id and g.rating_mode <> p_mode;
end;
$$;
revoke all on function private.set_rating_mode(uuid, text) from public, anon;
grant execute on function private.set_rating_mode(uuid, text) to authenticated;
create function public.set_rating_mode(p_group_id uuid, p_mode text)
returns void language sql security invoker set search_path = ''
as $$ select private.set_rating_mode(p_group_id, p_mode); $$;
revoke all on function public.set_rating_mode(uuid, text) from public, anon;
grant execute on function public.set_rating_mode(uuid, text) to authenticated;

-- ---------- organizer: one player on/off ----------
-- Stored as an override only when it differs from what the mode gives (null otherwise).
-- Switching him off (effectively) deletes his votes, as before.
create or replace function private.set_can_rate(p_group_id uuid, p_user_id uuid, p_can boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  mode text;
  can boolean := coalesce(p_can, false);
begin
  if not private.is_group_organizer(p_group_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select g.rating_mode into mode from public.groups g where g.id = p_group_id;
  update public.group_members m
  set can_rate = case when can = (mode = 'everyone') then null else can end
  where m.group_id = p_group_id and m.user_id = p_user_id and m.role = 'player';
  if not found then
    raise exception 'not a player' using errcode = '22023';
  end if;
  if not can then
    delete from public.rating_votes v where v.group_id = p_group_id and v.rater = p_user_id;
  end if;
end;
$$;

-- ---------- join_group: an upgraded player's switch is cleared (null), not set to false ----------
create or replace function private.join_group(p_token text)
returns table(group_id uuid, name text, role text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inv public.group_invites;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into inv from public.group_invites i
  where i.token = p_token and i.revoked_at is null and i.expires_at > now();
  if not found then
    raise exception 'invalid invite' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.group_members m where m.group_id = inv.group_id and m.user_id = uid) then
    perform pg_advisory_xact_lock(hashtext('user_groups:' || uid::text));
    perform pg_advisory_xact_lock(hashtext('group_members:' || inv.group_id::text));
    if (select count(*) from public.group_members m where m.user_id = uid) >= 50 then
      raise exception 'memberships_limit' using errcode = '54000';
    end if;
    if (select count(*) from public.group_members m where m.group_id = inv.group_id) >= 200 then
      raise exception 'group_full' using errcode = '54000';
    end if;
  end if;
  insert into public.group_members as m (group_id, user_id, role)
  values (inv.group_id, uid, inv.role)
  on conflict on constraint group_members_pkey do update
    set role = 'organizer', can_rate = null
    where excluded.role = 'organizer' and m.role = 'player';
  return query
    select g.id, g.name, m.role from public.groups g
    join public.group_members m on m.group_id = g.id and m.user_id = uid
    where g.id = inv.group_id;
end;
$$;

-- ---------- reads: the effective permission ----------
create or replace function private.group_members_list(p_group_id uuid)
returns table (user_id uuid, display_name text, role text, player_id text, can_rate boolean, joined_at timestamptz, is_me boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org boolean;
  mode text;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.is_group_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  org := private.is_group_organizer(p_group_id);
  select g.rating_mode into mode from public.groups g where g.id = p_group_id;
  return query
  select m.user_id, coalesce(private.display_name(m.user_id), ''), m.role, m.player_id,
         private.can_rate_eff(m.role, m.can_rate, mode), m.joined_at, m.user_id = (select auth.uid())
  from public.group_members m
  where m.group_id = p_group_id and (org or m.user_id = (select auth.uid()))
  order by m.joined_at, m.user_id;
end;
$$;

create or replace function private.group_public_get(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.group_members;
  mode text;
  out jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into me from public.group_members m where m.group_id = p_group_id and m.user_id = (select auth.uid());
  if not found then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select g.rating_mode into mode from public.groups g where g.id = p_group_id;
  select gp.data || jsonb_build_object(
    'groupId', gp.group_id,
    'updatedAt', gp.updated_at,
    'claimed', coalesce((select jsonb_agg(m.player_id order by m.player_id) from public.group_members m
                         where m.group_id = p_group_id and m.player_id is not null), '[]'::jsonb),
    'me', jsonb_build_object('role', me.role, 'playerId', me.player_id, 'canRate', private.can_rate_eff(me.role, me.can_rate, mode))
  ) into out
  from public.group_public gp where gp.group_id = p_group_id;
  return out;
end;
$$;

-- ---------- votes: permission follows the mode ----------
create or replace function private.submit_votes(p_group_id uuid, p_votes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me public.group_members;
  mode text;
  e record;
  roster text[];
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into me from public.group_members m where m.group_id = p_group_id and m.user_id = uid;
  select g.rating_mode into mode from public.groups g where g.id = p_group_id;
  if me.user_id is null or not private.can_rate_eff(me.role, me.can_rate, mode) or me.player_id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_votes) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_votes)) > 200 then
    raise exception 'invalid votes' using errcode = '22023';
  end if;
  select coalesce(array_agg(p ->> 'id'), '{}') into roster
  from public.groups g, jsonb_array_elements(case when jsonb_typeof(g.data -> 'players') = 'array' then g.data -> 'players' else '[]'::jsonb end) p
  where g.id = p_group_id;
  for e in select * from jsonb_each(p_votes) loop
    if e.key = me.player_id or not (e.key = any (roster)) then
      raise exception 'invalid votes' using errcode = '22023';
    end if;
    if jsonb_typeof(e.value) = 'null' then
      delete from public.rating_votes v where v.group_id = p_group_id and v.rater = uid and v.player_id = e.key;
    elsif jsonb_typeof(e.value) = 'number' and (e.value #>> '{}') ~ '^([1-9]|10)$' then
      insert into public.rating_votes as v (group_id, rater, player_id, level, updated_at)
      values (p_group_id, uid, e.key, (e.value #>> '{}')::int, now())
      on conflict (group_id, rater, player_id) do update set level = excluded.level, updated_at = excluded.updated_at
      where v.level is distinct from excluded.level;
    else
      raise exception 'invalid votes' using errcode = '22023';
    end if;
  end loop;
  return coalesce((select jsonb_object_agg(v.player_id, v.level) from public.rating_votes v
                   where v.group_id = p_group_id and v.rater = uid), '{}'::jsonb);
end;
$$;

create or replace function private.group_votes(p_group_id uuid)
returns table (rater uuid, player_id text, level integer, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_group_organizer(p_group_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select v.rater, v.player_id, v.level, v.updated_at
  from public.rating_votes v
  join public.group_members m on m.group_id = v.group_id and m.user_id = v.rater
  join public.groups g on g.id = v.group_id
  where v.group_id = p_group_id and private.can_rate_eff(m.role, m.can_rate, g.rating_mode)
  order by v.player_id, v.rater;
end;
$$;
