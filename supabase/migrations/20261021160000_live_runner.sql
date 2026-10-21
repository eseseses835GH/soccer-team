-- Kochot v12: a player (or any member) can run the match from his phone.
--
-- group_live gets a RUNNER: the one login whose phone runs the evening right now. Only the runner
-- writes; everyone else reads. Any member takes control with take_control(); an organizer takes it
-- back the same way. `rev` goes up on every change of the row (write, take, release, end), so a
-- phone can say "I am writing on top of rev N" and lose cleanly if someone else got there first.
--
-- Error codes (uniform with v10): 28000 not logged in, 42501 not a member / not allowed,
-- 22023 bad data, P0002 nothing live to take, 40001 conflict = someone else runs it or stale rev.

alter table public.group_live
  add column runner uuid references auth.users (id) on delete set null,
  add column runner_name text not null default '',
  add column runner_since timestamptz,
  add column rev bigint not null default 0;
create index group_live_runner_idx on public.group_live (runner);

-- Rows written before v12: whoever published last runs it (if he's still an organizer and it's live).
update public.group_live l
set runner = l.updated_by, runner_name = l.by_name, runner_since = l.updated_at
where l.runner is null and not (l.data ? 'ended')
  and exists (select 1 from public.group_members m where m.group_id = l.group_id and m.user_id = l.updated_by and m.role = 'organizer');

-- ---------- helpers ----------

-- The evening on this row is over or abandoned: ended, or not written for 12 h (players' apps
-- already show "no evening" then). An organizer may start a new one on top without take_control.
create or replace function private.live_is_open(d jsonb, t timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$ select not (d ? 'ended') and t > now() - interval '12 hours'; $$;
revoke all on function private.live_is_open(jsonb, timestamptz) from public, anon, authenticated;

-- ---------- RPC bodies ----------

drop function public.live_get(uuid);
drop function private.live_get(uuid);
create function private.live_get(p_group_id uuid)
returns table (data jsonb, updated_by uuid, by_name text, updated_at timestamptz,
               runner uuid, runner_name text, runner_since timestamptz, rev bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_group_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return query
    select l.data, l.updated_by, l.by_name, l.updated_at, l.runner, l.runner_name, l.runner_since, l.rev
    from public.group_live l where l.group_id = p_group_id;
end;
$$;

-- Write the live evening. p_data null = end the evening (organizers only; row becomes {"ended":true}).
-- Who may write:
--   - the runner;
--   - an organizer when nobody runs it (no runner, runner left the group, or the row is ended /
--     12 h old): he becomes the runner (first publish of an evening);
--   - anyone else who is a member: 40001 (take_control first).
-- p_rev (optional): the rev this write builds on; a different current rev → 40001.
-- Returns the new rev.
drop function public.live_set(uuid, jsonb);
drop function private.live_set(uuid, jsonb);
create function private.live_set(p_group_id uuid, p_data jsonb, p_rev bigint default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t timestamptz := now();
  d jsonb := p_data;
  ending boolean := p_data is null or p_data = 'null'::jsonb;
  org boolean;
  row_ public.group_live%rowtype;
  found_ boolean;
  free boolean;
  next_rev bigint;
begin
  if uid is null then
    raise exception 'not logged in' using errcode = '28000';
  end if;
  if not private.is_group_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  org := private.is_group_organizer(p_group_id);
  if ending then
    if not org then
      raise exception 'only organizers end the evening' using errcode = '42501';
    end if;
    d := '{"ended": true}'::jsonb;
  elsif jsonb_typeof(d) <> 'object' or d -> 'v' is distinct from '1'::jsonb then
    raise exception 'invalid live data' using errcode = '22023';
  end if;
  if pg_column_size(d) >= 65536 or d::text ~ '"(attrs|levelVotes|cards|overall|weaknesses)":' then
    raise exception 'invalid live data' using errcode = '22023';
  end if;

  select * into row_ from public.group_live l where l.group_id = p_group_id for update;
  found_ := found;
  if p_rev is not null and p_rev <> coalesce(row_.rev, 0) then
    raise exception 'stale rev' using errcode = '40001';
  end if;
  free := not found_ or row_.runner is null
    or not private.live_is_open(row_.data, row_.updated_at)
    or not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = row_.runner);
  if not (coalesce(row_.runner = uid, false) or (org and free)) then
    raise exception 'someone else runs the evening' using errcode = '40001';
  end if;

  next_rev := coalesce(row_.rev, 0) + 1;
  if not found_ then
    insert into public.group_live (group_id, data, updated_by, by_name, updated_at, runner, runner_name, runner_since, rev)
    values (p_group_id, d, uid, coalesce(private.display_name(uid), ''), t,
            case when ending then null else uid end,
            case when ending then '' else coalesce(private.display_name(uid), '') end,
            case when ending then null else t end, next_rev);
  else
    update public.group_live l set
      data = d, updated_by = uid, by_name = coalesce(private.display_name(uid), ''), updated_at = t,
      runner = case when ending then null else uid end,
      runner_name = case when ending then '' when l.runner = uid then l.runner_name else coalesce(private.display_name(uid), '') end,
      runner_since = case when ending then null when l.runner = uid then l.runner_since else t end,
      rev = next_rev
    where l.group_id = p_group_id;
  end if;
  return next_rev;
end;
$$;

-- Any member takes over the running evening (an organizer taking it back is the same call).
-- Needs an open evening (P0002 otherwise). Returns the row as live_get does.
create function private.take_control(p_group_id uuid)
returns table (data jsonb, updated_by uuid, by_name text, updated_at timestamptz,
               runner uuid, runner_name text, runner_since timestamptz, rev bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not logged in' using errcode = '28000';
  end if;
  if not private.is_group_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  update public.group_live l set
    runner = uid,
    runner_name = coalesce(private.display_name(uid), ''),
    runner_since = now(),
    rev = l.rev + 1
  where l.group_id = p_group_id and not (l.data ? 'ended');
  if not found then
    raise exception 'no live evening' using errcode = 'P0002';
  end if;
  return query
    select l.data, l.updated_by, l.by_name, l.updated_at, l.runner, l.runner_name, l.runner_since, l.rev
    from public.group_live l where l.group_id = p_group_id;
end;
$$;

-- The runner lets go (nobody runs it; the next organizer publish or any take_control picks it up).
-- Not the runner: a no-op. Returns the current rev (null when there is no row).
create function private.release_control(p_group_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r bigint;
begin
  if not private.is_group_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  update public.group_live l set runner = null, runner_name = '', runner_since = null, rev = l.rev + 1
  where l.group_id = p_group_id and l.runner = uid;
  select l.rev into r from public.group_live l where l.group_id = p_group_id;
  return r;
end;
$$;

revoke all on function private.live_get(uuid) from public, anon;
revoke all on function private.live_set(uuid, jsonb, bigint) from public, anon;
revoke all on function private.take_control(uuid) from public, anon;
revoke all on function private.release_control(uuid) from public, anon;
grant execute on function private.live_get(uuid) to authenticated;
grant execute on function private.live_set(uuid, jsonb, bigint) to authenticated;
grant execute on function private.take_control(uuid) to authenticated;
grant execute on function private.release_control(uuid) to authenticated;

-- ---------- thin public wrappers ----------

create function public.live_get(p_group_id uuid)
returns table (data jsonb, updated_by uuid, by_name text, updated_at timestamptz,
               runner uuid, runner_name text, runner_since timestamptz, rev bigint)
language sql stable security invoker set search_path = ''
as $$ select * from private.live_get(p_group_id); $$;

create function public.live_set(p_group_id uuid, p_data jsonb, p_rev bigint default null)
returns bigint language sql security invoker set search_path = ''
as $$ select private.live_set(p_group_id, p_data, p_rev); $$;

create function public.take_control(p_group_id uuid)
returns table (data jsonb, updated_by uuid, by_name text, updated_at timestamptz,
               runner uuid, runner_name text, runner_since timestamptz, rev bigint)
language sql security invoker set search_path = ''
as $$ select * from private.take_control(p_group_id); $$;

create function public.release_control(p_group_id uuid)
returns bigint language sql security invoker set search_path = ''
as $$ select private.release_control(p_group_id); $$;

revoke all on function public.live_get(uuid) from public, anon;
revoke all on function public.live_set(uuid, jsonb, bigint) from public, anon;
revoke all on function public.take_control(uuid) from public, anon;
revoke all on function public.release_control(uuid) from public, anon;
grant execute on function public.live_get(uuid) to authenticated;
grant execute on function public.live_set(uuid, jsonb, bigint) to authenticated;
grant execute on function public.take_control(uuid) to authenticated;
grant execute on function public.release_control(uuid) to authenticated;
