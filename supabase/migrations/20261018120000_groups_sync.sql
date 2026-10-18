-- Kochot v3: groups ("קבוצות"), organizers and invites.
-- Every table has RLS. Members are read through private.is_group_member(), a security-definer
-- helper in a schema the API does not expose (it avoids RLS recursion on group_members).
-- Writes that touch more than one table go through RPCs (create_group, create_invite,
-- join_group, leave_group), so the tables themselves only allow member reads and a
-- column-limited update of groups.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- ---------- tables ----------

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  -- The group's durable data (players, constraints, shared settings, history). Shape is owned
  -- by the app and always passes through its sanitize() on read.
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 1000000),
  -- Optimistic concurrency: bumped by a trigger on every update; clients update "where version = n".
  version integer not null default 1,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null default auth.uid()
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Only organizers for now (they see and edit everything, ratings included).
  -- A read-only 'player' role can be added later by widening this check and the policies.
  role text not null default 'organizer' check (role in ('organizer')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_id_idx on public.group_members (user_id);

create table public.group_invites (
  token text primary key check (char_length(token) >= 24),
  group_id uuid not null references public.groups (id) on delete cascade,
  role text not null default 'organizer' check (role in ('organizer')),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  revoked_at timestamptz
);
create index group_invites_group_id_idx on public.group_invites (group_id);
create index group_invites_created_by_idx on public.group_invites (created_by);
create index groups_created_by_idx on public.groups (created_by);
create index groups_updated_by_idx on public.groups (updated_by);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;

-- ---------- helper ----------

create or replace function private.is_group_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = (select auth.uid())
  );
$$;
revoke all on function private.is_group_member(uuid) from public, anon;
grant execute on function private.is_group_member(uuid) to authenticated;

-- ---------- version / audit trigger ----------

create or replace function private.groups_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.id := old.id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger groups_touch before update on public.groups
for each row execute function private.groups_touch();

-- ---------- policies ----------

-- groups: members read and update; no direct insert/delete (RPCs).
create policy "members read their groups" on public.groups
  for select to authenticated using ((select private.is_group_member(id)));
create policy "members update their groups" on public.groups
  for update to authenticated
  using ((select private.is_group_member(id)))
  with check ((select private.is_group_member(id)));

-- group_members: members see who else is in their groups.
create policy "members see members" on public.group_members
  for select to authenticated using ((select private.is_group_member(group_id)));

-- group_invites: members see their groups' invites and may revoke them.
create policy "members read invites" on public.group_invites
  for select to authenticated using ((select private.is_group_member(group_id)));
create policy "members revoke invites" on public.group_invites
  for update to authenticated
  using ((select private.is_group_member(group_id)))
  with check ((select private.is_group_member(group_id)));

-- Table privileges: nothing for anon; authenticated may only update what the app edits.
revoke all on public.groups, public.group_members, public.group_invites from anon, authenticated;
grant select on public.groups, public.group_members, public.group_invites to authenticated;
grant update (name, data) on public.groups to authenticated;
grant update (revoked_at) on public.group_invites to authenticated;

-- ---------- RPCs ----------

-- Upload a group that so far lived on one phone. The client picks the id (the local group id),
-- the caller becomes its first organizer.
create or replace function public.create_group(p_id uuid, p_name text, p_data jsonb)
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
  insert into public.groups (id, name, data, created_by, updated_by)
  values (coalesce(p_id, gen_random_uuid()), btrim(p_name), coalesce(p_data, '{}'::jsonb), uid, uid)
  returning * into g;
  insert into public.group_members (group_id, user_id, role) values (g.id, uid, 'organizer');
  return g;
end;
$$;

-- A hard-to-guess invite token (24 random bytes, base64url), valid for 14 days.
create or replace function public.create_invite(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text;
begin
  if not private.is_group_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  t := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.group_invites (token, group_id) values (t, p_group_id);
  return t;
end;
$$;

-- Join with an invite token. Unknown, expired and revoked tokens all give the same error,
-- so tokens can't be probed. Returns the group's id and name.
create or replace function public.join_group(p_token text)
returns table (group_id uuid, name text)
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
  insert into public.group_members (group_id, user_id, role)
  values (inv.group_id, uid, inv.role)
  on conflict on constraint group_members_pkey do nothing;
  return query select g.id, g.name from public.groups g where g.id = inv.group_id;
end;
$$;

-- Leave a group. The last organizer to leave deletes it (with its invites).
create or replace function public.leave_group(p_group_id uuid)
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
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id) then
    delete from public.groups g where g.id = p_group_id;
  end if;
end;
$$;

revoke all on function public.create_group(uuid, text, jsonb) from public, anon;
revoke all on function public.create_invite(uuid) from public, anon;
revoke all on function public.join_group(text) from public, anon;
revoke all on function public.leave_group(uuid) from public, anon;
grant execute on function public.create_group(uuid, text, jsonb) to authenticated;
grant execute on function public.create_invite(uuid) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;

-- ---------- realtime ----------
-- Other organizers' phones hear about changes (RLS still applies to what they receive).
alter publication supabase_realtime add table public.groups;
