-- Caps so nobody can flood the database (v13). See DECISIONS.md "Login most of the time: free limits and server caps (v13)".
-- Every cap raises SQLSTATE 54000 (program_limit_exceeded); the message says which one:
--   groups_limit      a login already created 20 groups (that still exist)
--   memberships_limit a login is already in 50 groups (create or join)
--   group_full        a group already has 200 members
--   invites_limit     20 live organizer links per group, or 100 links of any kind created per group in 24 h
--   data_limit        groups.data over 1 MiB as text
--   players_limit     more than 200 players in groups.data
-- Nothing existing is changed or removed: rows already over a cap stay; only new inserts/updates are checked.

-- ---------- groups.data: size and roster length ----------
create or replace function private.groups_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if octet_length(new.data::text) > 1048576 then
    raise exception 'data_limit' using errcode = '54000';
  end if;
  if jsonb_typeof(new.data -> 'players') = 'array' and jsonb_array_length(new.data -> 'players') > 200 then
    raise exception 'players_limit' using errcode = '54000';
  end if;
  return new;
end;
$$;

revoke all on function private.groups_limits() from public, anon, authenticated;

drop trigger if exists groups_limits on public.groups;
create trigger groups_limits
  before insert or update of data on public.groups
  for each row execute function private.groups_limits();

-- ---------- create_group: 20 created per login, 50 memberships ----------
create or replace function private.create_group(p_id uuid, p_name text, p_data jsonb)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  g public.groups;
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
  insert into public.groups (id, name, data, created_by, updated_by)
  values (coalesce(p_id, gen_random_uuid()), btrim(p_name), coalesce(p_data, '{}'::jsonb), uid, uid)
  returning * into g;
  insert into public.group_members (group_id, user_id, role) values (g.id, uid, 'organizer');
  return g;
end;
$$;

-- ---------- join_group: 50 memberships per login, 200 members per group ----------
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
    set role = 'organizer', can_rate = false
    where excluded.role = 'organizer' and m.role = 'player';
  return query
    select g.id, g.name, m.role from public.groups g
    join public.group_members m on m.group_id = g.id and m.user_id = uid
    where g.id = inv.group_id;
end;
$$;

-- ---------- invites: 20 live organizer links, 100 links a day per group ----------
create or replace function private.create_invite(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text;
begin
  if not private.is_group_organizer(p_group_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('invites:' || p_group_id::text));
  if (select count(*) from public.group_invites i
      where i.group_id = p_group_id and i.role = 'organizer' and i.revoked_at is null and i.expires_at > now()) >= 20
     or (select count(*) from public.group_invites i
      where i.group_id = p_group_id and i.created_at > now() - interval '24 hours') >= 100 then
    raise exception 'invites_limit' using errcode = '54000';
  end if;
  t := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.group_invites (token, group_id) values (t, p_group_id);
  return t;
end;
$$;

create or replace function private.create_player_invite(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text;
begin
  if not private.is_group_organizer(p_group_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('player_invite:' || p_group_id::text));
  select i.token into t from public.group_invites i
  where i.group_id = p_group_id and i.role = 'player' and i.revoked_at is null and i.expires_at > now()
  order by i.created_at desc limit 1;
  if t is null then
    perform pg_advisory_xact_lock(hashtext('invites:' || p_group_id::text));
    if (select count(*) from public.group_invites i
        where i.group_id = p_group_id and i.created_at > now() - interval '24 hours') >= 100 then
      raise exception 'invites_limit' using errcode = '54000';
    end if;
    t := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
    insert into public.group_invites (token, group_id, role, expires_at)
    values (t, p_group_id, 'player', now() + interval '100 years');
  end if;
  return t;
end;
$$;
