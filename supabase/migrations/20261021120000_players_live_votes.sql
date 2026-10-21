-- Kochot v10: players, the live evening, rating permission.
--
-- Roles: group_members.role is 'organizer' (sees and edits everything, ratings included) or
-- 'player' (read-only, never sees ratings). Players join through one shared player invite link per
-- group, claim who they are in the roster (player_id), and may be allowed to rate (can_rate).
--
-- What players can read:
--   group_public  — derived from groups.data BY THE SERVER (trigger), so a buggy client can't leak
--                   ratings into it: { name, players: [{id, name}], history } (history records are
--                   whitelisted field by field).
--   group_live    — the evening on the pitch, published by an organizer's phone (no ratings; checked).
--   rating_votes  — only their own rows.
-- Everything organizer-only (groups.data, invites, other members' rows, everybody's votes) now
-- checks role = 'organizer'. Existing members stay 'organizer' (the column default; nothing changes).

-- ---------- helpers ----------

create or replace function private.is_group_organizer(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = (select auth.uid()) and m.role = 'organizer'
  );
$$;
revoke all on function private.is_group_organizer(uuid) from public, anon;
grant execute on function private.is_group_organizer(uuid) to authenticated;

-- Display name of a login, never the full email (same rule as group_organizers, v6).
create or replace function private.display_name(uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(u.email, '@', 1), ''),
    ''
  ), 40)
  from auth.users u where u.id = uid;
$$;
revoke all on function private.display_name(uuid) from public, anon, authenticated;

-- Keep only `keys` of a JSON object ({} for anything else).
create or replace function private.jpick(obj jsonb, keys text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(obj) = 'object'
    then coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(obj) e where e.key = any (keys)), '{}'::jsonb)
    else '{}'::jsonb end;
$$;

-- jpick over every object of an array ([] for anything else).
create or replace function private.jpick_each(arr jsonb, keys text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(arr) = 'array'
    then coalesce((select jsonb_agg(private.jpick(x.v, keys) order by x.i)
                   from jsonb_array_elements(arr) with ordinality x(v, i)
                   where jsonb_typeof(x.v) = 'object'), '[]'::jsonb)
    else '[]'::jsonb end;
$$;

-- The player-safe part of a group's doc. Whitelist only: anything not listed here never reaches
-- players, whatever the app puts into groups.data.
create or replace function private.public_doc(d jsonb, gname text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'name', gname,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.v -> 'id', 'name', p.v -> 'name') order by p.i)
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
$$;

-- ---------- members: roles, claims, rating permission ----------

alter table public.group_members drop constraint group_members_role_check;
alter table public.group_members add constraint group_members_role_check check (role in ('organizer', 'player'));
alter table public.group_members add column player_id text check (player_id is null or char_length(player_id) between 1 and 100);
alter table public.group_members add column can_rate boolean not null default false;
-- One login per roster player in a group.
create unique index group_members_player_idx on public.group_members (group_id, player_id) where player_id is not null;

alter table public.group_invites drop constraint group_invites_role_check;
alter table public.group_invites add constraint group_invites_role_check check (role in ('organizer', 'player'));

-- ---------- new tables ----------

create table public.group_public (
  group_id uuid primary key references public.groups (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.group_live (
  group_id uuid primary key references public.groups (id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 65536),
  updated_by uuid references auth.users (id) on delete set null,
  -- "Running on <name>'s phone" without exposing anything else about the login.
  by_name text not null default '',
  updated_at timestamptz not null default now()
);
create index group_live_updated_by_idx on public.group_live (updated_by);

create table public.rating_votes (
  group_id uuid not null,
  rater uuid not null,
  player_id text not null check (char_length(player_id) between 1 and 100),
  level integer not null check (level between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (group_id, rater, player_id),
  -- Leaving / being removed from the group deletes your votes.
  foreign key (group_id, rater) references public.group_members (group_id, user_id) on delete cascade
);

alter table public.group_public enable row level security;
alter table public.group_live enable row level security;
alter table public.rating_votes enable row level security;

-- Backfill (adds rows only; existing tables untouched).
insert into public.group_public (group_id, data)
select g.id, private.public_doc(g.data, g.name) from public.groups g
on conflict (group_id) do nothing;

-- Kept in step with groups by the server, never by the client.
create or replace function private.groups_public_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pub jsonb := private.public_doc(new.data, new.name);
begin
  insert into public.group_public as gp (group_id, data, updated_at)
  values (new.id, pub, now())
  on conflict (group_id) do update set data = excluded.data, updated_at = now()
  where gp.data is distinct from excluded.data;
  return null;
end;
$$;
revoke all on function private.groups_public_sync() from public, anon, authenticated;

create trigger groups_public_sync after insert or update of name, data on public.groups
for each row execute function private.groups_public_sync();

-- ---------- policies ----------

drop policy "members read their groups" on public.groups;
drop policy "members update their groups" on public.groups;
create policy "organizers read their groups" on public.groups
  for select to authenticated using ((select private.is_group_organizer(id)));
create policy "organizers update their groups" on public.groups
  for update to authenticated
  using ((select private.is_group_organizer(id)))
  with check ((select private.is_group_organizer(id)));

drop policy "members see members" on public.group_members;
create policy "organizers see members, everyone sees themselves" on public.group_members
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_group_organizer(group_id)));

drop policy "members read invites" on public.group_invites;
create policy "organizers read invites" on public.group_invites
  for select to authenticated using ((select private.is_group_organizer(group_id)));

create policy "members read the public group" on public.group_public
  for select to authenticated using ((select private.is_group_member(group_id)));

create policy "members read the live evening" on public.group_live
  for select to authenticated using ((select private.is_group_member(group_id)));

create policy "raters read their votes, organizers read all" on public.rating_votes
  for select to authenticated
  using (rater = (select auth.uid()) or (select private.is_group_organizer(group_id)));

revoke all on public.group_public, public.group_live, public.rating_votes from anon, authenticated;
grant select on public.group_public, public.group_live, public.rating_votes to authenticated;

-- ---------- existing RPCs, now role-aware ----------

-- Organizer invite links: organizers only.
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
  t := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.group_invites (token, group_id) values (t, p_group_id);
  return t;
end;
$$;

create or replace function private.revoke_invite(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  gid uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select i.group_id into gid from public.group_invites i where i.token = p_token;
  if gid is null or not private.is_group_organizer(gid) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  update public.group_invites i set revoked_at = now()
  where i.token = p_token and i.revoked_at is null;
end;
$$;

-- join_group now also returns the role the caller has in the group afterwards.
drop function public.join_group(text);
drop function private.join_group(text);
create function private.join_group(p_token text)
returns table (group_id uuid, name text, role text)
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
  insert into public.group_members as m (group_id, user_id, role)
  values (inv.group_id, uid, inv.role)
  on conflict on constraint group_members_pkey do update
    -- A player who opens an organizer link becomes an organizer; nobody is ever downgraded.
    set role = 'organizer', can_rate = false
    where excluded.role = 'organizer' and m.role = 'player';
  return query
    select g.id, g.name, m.role from public.groups g
    join public.group_members m on m.group_id = g.id and m.user_id = uid
    where g.id = inv.group_id;
end;
$$;
revoke all on function private.join_group(text) from public, anon;
grant execute on function private.join_group(text) to authenticated;
create function public.join_group(p_token text)
returns table (group_id uuid, name text, role text) language sql security invoker set search_path = ''
as $$ select * from private.join_group(p_token); $$;
revoke all on function public.join_group(text) from public, anon;
grant execute on function public.join_group(text) to authenticated;

-- Leaving: when the last organizer leaves, the group goes (with its players, live state and votes).
create or replace function private.leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.group_members m where m.group_id = p_group_id and m.user_id = uid;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.role = 'organizer') then
    delete from public.groups g where g.id = p_group_id;
  end if;
end;
$$;

-- The organizers sheet: organizers only (players are listed by group_members_list).
-- Any member may call it (a player may see who runs the group); rows are organizers only.
create or replace function private.group_organizers(p_group_id uuid)
returns table (user_id uuid, display_name text, role text, joined_at timestamptz, is_me boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.is_group_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return query
  select m.user_id, coalesce(private.display_name(m.user_id), ''), m.role, m.joined_at, m.user_id = (select auth.uid())
  from public.group_members m
  where m.group_id = p_group_id and m.role = 'organizer'
  order by m.joined_at, m.user_id;
end;
$$;

-- ---------- new RPCs (private bodies) ----------

-- The group's one player link: the live one if there is one, else a new one. It doesn't expire
-- (it lives in the players' WhatsApp group); organizers revoke it with revoke_invite and call this
-- again for a fresh one.
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
    t := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
    insert into public.group_invites (token, group_id, role, expires_at)
    values (t, p_group_id, 'player', now() + interval '100 years');
  end if;
  return t;
end;
$$;

-- "This is me": the caller (any member) picks his roster id. Only while he has none; the id must be
-- in the roster and not taken by another login. A wrong pick is undone by an organizer.
create or replace function private.claim_player(p_group_id uuid, p_player_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cur public.group_members;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into cur from public.group_members m where m.group_id = p_group_id and m.user_id = uid;
  if not found then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if cur.player_id is not null then
    if cur.player_id = p_player_id then return; end if;
    raise exception 'already claimed' using errcode = '23505';
  end if;
  if not exists (
    select 1 from public.groups g, jsonb_array_elements(case when jsonb_typeof(g.data -> 'players') = 'array' then g.data -> 'players' else '[]'::jsonb end) p
    where g.id = p_group_id and p ->> 'id' = p_player_id
  ) then
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

create or replace function private.unclaim_player(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_group_organizer(p_group_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.group_members m set player_id = null where m.group_id = p_group_id and m.user_id = p_user_id;
end;
$$;

-- Organizer: let a player rate (or not). Taking it away deletes his votes.
create or replace function private.set_can_rate(p_group_id uuid, p_user_id uuid, p_can boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_group_organizer(p_group_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.group_members m set can_rate = coalesce(p_can, false)
  where m.group_id = p_group_id and m.user_id = p_user_id and m.role = 'player';
  if not found then
    raise exception 'not a player' using errcode = '22023';
  end if;
  if not coalesce(p_can, false) then
    delete from public.rating_votes v where v.group_id = p_group_id and v.rater = p_user_id;
  end if;
end;
$$;

-- Organizer: remove a player member (organizers still can't remove each other).
create or replace function private.remove_player(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_group_organizer(p_group_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.group_members m where m.group_id = p_group_id and m.user_id = p_user_id and m.role = 'player';
end;
$$;

-- Organizer: every member. Player: only his own row. Non-member: 42501.
create or replace function private.group_members_list(p_group_id uuid)
returns table (user_id uuid, display_name text, role text, player_id text, can_rate boolean, joined_at timestamptz, is_me boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.is_group_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  org := private.is_group_organizer(p_group_id);
  return query
  select m.user_id, coalesce(private.display_name(m.user_id), ''), m.role, m.player_id, m.can_rate, m.joined_at, m.user_id = (select auth.uid())
  from public.group_members m
  where m.group_id = p_group_id and (org or m.user_id = (select auth.uid()))
  order by m.joined_at, m.user_id;
end;
$$;

-- Everything a player screen needs in one call: the public doc + who is claimed + my membership.
create or replace function private.group_public_get(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.group_members;
  out jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into me from public.group_members m where m.group_id = p_group_id and m.user_id = (select auth.uid());
  if not found then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select gp.data || jsonb_build_object(
    'groupId', gp.group_id,
    'updatedAt', gp.updated_at,
    'claimed', coalesce((select jsonb_agg(m.player_id order by m.player_id) from public.group_members m
                         where m.group_id = p_group_id and m.player_id is not null), '[]'::jsonb),
    'me', jsonb_build_object('role', me.role, 'playerId', me.player_id, 'canRate', me.can_rate)
  ) into out
  from public.group_public gp where gp.group_id = p_group_id;
  return out;
end;
$$;

-- Live evening.
create or replace function private.live_get(p_group_id uuid)
returns table (data jsonb, updated_by uuid, by_name text, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_group_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return query select l.data, l.updated_by, l.by_name, l.updated_at from public.group_live l where l.group_id = p_group_id;
end;
$$;

-- Organizers publish (last write wins; by_name says whose phone runs it). null = the evening ended.
create or replace function private.live_set(p_group_id uuid, p_data jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t timestamptz := now();
begin
  if not private.is_group_organizer(p_group_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_data is null or p_data = 'null'::jsonb then
    delete from public.group_live l where l.group_id = p_group_id;
    return t;
  end if;
  if jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) >= 65536
     or p_data::text ~ '"(attrs|levelVotes|cards|overall|weaknesses)":' then
    raise exception 'invalid live data' using errcode = '22023';
  end if;
  insert into public.group_live as l (group_id, data, updated_by, by_name, updated_at)
  values (p_group_id, p_data, uid, coalesce(private.display_name(uid), ''), t)
  on conflict (group_id) do update
    set data = excluded.data, updated_by = excluded.updated_by, by_name = excluded.by_name, updated_at = excluded.updated_at;
  return t;
end;
$$;

-- Votes from players allowed to rate. p_votes = { "<playerId>": 1..10 | null } (null removes a vote).
-- Returns the caller's votes afterwards (same shape as my_votes).
create or replace function private.submit_votes(p_group_id uuid, p_votes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me public.group_members;
  e record;
  roster text[];
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into me from public.group_members m where m.group_id = p_group_id and m.user_id = uid;
  if not found or me.role <> 'player' or not me.can_rate or me.player_id is null then
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

create or replace function private.my_votes(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_group_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return coalesce((select jsonb_object_agg(v.player_id, v.level) from public.rating_votes v
                   where v.group_id = p_group_id and v.rater = (select auth.uid())), '{}'::jsonb);
end;
$$;

-- Organizers: the votes that count — from members who are players and may rate right now.
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
  where v.group_id = p_group_id and m.role = 'player' and m.can_rate
  order by v.player_id, v.rater;
end;
$$;

revoke all on function private.create_player_invite(uuid) from public, anon;
revoke all on function private.claim_player(uuid, text) from public, anon;
revoke all on function private.unclaim_player(uuid, uuid) from public, anon;
revoke all on function private.set_can_rate(uuid, uuid, boolean) from public, anon;
revoke all on function private.remove_player(uuid, uuid) from public, anon;
revoke all on function private.group_members_list(uuid) from public, anon;
revoke all on function private.group_public_get(uuid) from public, anon;
revoke all on function private.live_get(uuid) from public, anon;
revoke all on function private.live_set(uuid, jsonb) from public, anon;
revoke all on function private.submit_votes(uuid, jsonb) from public, anon;
revoke all on function private.my_votes(uuid) from public, anon;
revoke all on function private.group_votes(uuid) from public, anon;
grant execute on function private.create_player_invite(uuid) to authenticated;
grant execute on function private.claim_player(uuid, text) to authenticated;
grant execute on function private.unclaim_player(uuid, uuid) to authenticated;
grant execute on function private.set_can_rate(uuid, uuid, boolean) to authenticated;
grant execute on function private.remove_player(uuid, uuid) to authenticated;
grant execute on function private.group_members_list(uuid) to authenticated;
grant execute on function private.group_public_get(uuid) to authenticated;
grant execute on function private.live_get(uuid) to authenticated;
grant execute on function private.live_set(uuid, jsonb) to authenticated;
grant execute on function private.submit_votes(uuid, jsonb) to authenticated;
grant execute on function private.my_votes(uuid) to authenticated;
grant execute on function private.group_votes(uuid) to authenticated;

-- ---------- public wrappers (security invoker) ----------

create function public.create_player_invite(p_group_id uuid)
returns text language sql security invoker set search_path = ''
as $$ select private.create_player_invite(p_group_id); $$;

create function public.claim_player(p_group_id uuid, p_player_id text)
returns void language sql security invoker set search_path = ''
as $$ select private.claim_player(p_group_id, p_player_id); $$;

create function public.unclaim_player(p_group_id uuid, p_user_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.unclaim_player(p_group_id, p_user_id); $$;

create function public.set_can_rate(p_group_id uuid, p_user_id uuid, p_can boolean)
returns void language sql security invoker set search_path = ''
as $$ select private.set_can_rate(p_group_id, p_user_id, p_can); $$;

create function public.remove_player(p_group_id uuid, p_user_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.remove_player(p_group_id, p_user_id); $$;

create function public.group_members_list(p_group_id uuid)
returns table (user_id uuid, display_name text, role text, player_id text, can_rate boolean, joined_at timestamptz, is_me boolean)
language sql stable security invoker set search_path = ''
as $$ select * from private.group_members_list(p_group_id); $$;

create function public.group_public_get(p_group_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.group_public_get(p_group_id); $$;

create function public.live_get(p_group_id uuid)
returns table (data jsonb, updated_by uuid, by_name text, updated_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.live_get(p_group_id); $$;

create function public.live_set(p_group_id uuid, p_data jsonb)
returns timestamptz language sql security invoker set search_path = ''
as $$ select private.live_set(p_group_id, p_data); $$;

create function public.submit_votes(p_group_id uuid, p_votes jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.submit_votes(p_group_id, p_votes); $$;

create function public.my_votes(p_group_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.my_votes(p_group_id); $$;

create function public.group_votes(p_group_id uuid)
returns table (rater uuid, player_id text, level integer, updated_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.group_votes(p_group_id); $$;

revoke all on function public.create_player_invite(uuid) from public, anon;
revoke all on function public.claim_player(uuid, text) from public, anon;
revoke all on function public.unclaim_player(uuid, uuid) from public, anon;
revoke all on function public.set_can_rate(uuid, uuid, boolean) from public, anon;
revoke all on function public.remove_player(uuid, uuid) from public, anon;
revoke all on function public.group_members_list(uuid) from public, anon;
revoke all on function public.group_public_get(uuid) from public, anon;
revoke all on function public.live_get(uuid) from public, anon;
revoke all on function public.live_set(uuid, jsonb) from public, anon;
revoke all on function public.submit_votes(uuid, jsonb) from public, anon;
revoke all on function public.my_votes(uuid) from public, anon;
revoke all on function public.group_votes(uuid) from public, anon;
grant execute on function public.create_player_invite(uuid) to authenticated;
grant execute on function public.claim_player(uuid, text) to authenticated;
grant execute on function public.unclaim_player(uuid, uuid) to authenticated;
grant execute on function public.set_can_rate(uuid, uuid, boolean) to authenticated;
grant execute on function public.remove_player(uuid, uuid) to authenticated;
grant execute on function public.group_members_list(uuid) to authenticated;
grant execute on function public.group_public_get(uuid) to authenticated;
grant execute on function public.live_get(uuid) to authenticated;
grant execute on function public.live_set(uuid, jsonb) to authenticated;
grant execute on function public.submit_votes(uuid, jsonb) to authenticated;
grant execute on function public.my_votes(uuid) to authenticated;
grant execute on function public.group_votes(uuid) to authenticated;

-- jpick/jpick_each/public_doc are pure helpers used by the trigger; nobody calls them directly.
revoke all on function private.jpick(jsonb, text[]) from public, anon, authenticated;
revoke all on function private.jpick_each(jsonb, text[]) from public, anon, authenticated;
revoke all on function private.public_doc(jsonb, text) from public, anon, authenticated;

-- ---------- realtime ----------
-- Players hear about the live evening and roster/history changes (RLS decides who receives what).
alter publication supabase_realtime add table public.group_live;
alter publication supabase_realtime add table public.group_public;
