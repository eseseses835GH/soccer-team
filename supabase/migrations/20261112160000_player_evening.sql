-- Kochot v20: any member starts and ends an evening (DECISIONS → "Players start an evening (v20)").
--
-- Until now only an organizer's first publish could open an evening, and only an organizer could
-- end one (the archive lives in groups.data, which players can't write). Now:
--   1. live_set: a PLAYER also becomes the runner implicitly when there is no open evening (no row,
--      ended, or not written for 12 h). An open evening still needs take_control (as before), so a
--      player never overwrites an evening on the pitch. Organizers: unchanged.
--   2. end_evening(group, record, rev): the RUNNER (player or organizer) ends the evening and its
--      record goes into groups.data.history, exactly where an organizer's phone archives it. So
--      organizers' stats and everyone's history include evenings a player ran. The record is cut
--      down to the history whitelist by private.public_doc (the same fields players already see);
--      a record with the same id replaces the old one (the app sends it already merged); at most 150
--      evenings are kept (the app's HISTORY_MAX). groups.version is bumped by groups_touch, so
--      organizers' phones re-merge before pushing (history merges by id: a server-added evening is
--      kept), and group_public follows through its trigger.
-- Teams for a player are made by the split-teams edge function (service role, server side), so
-- nothing here hands out a rating.
--
-- Error codes as before: 28000 not logged in, 42501 not a member, 22023 bad data,
-- P0002 nothing live, 40001 someone else runs it / stale rev.

-- ---------- live_set: a player may open an evening when none is open ----------
create or replace function private.live_set(p_group_id uuid, p_data jsonb, p_rev bigint default null)
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
  open_ boolean;
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
  open_ := found_ and private.live_is_open(row_.data, row_.updated_at);
  free := not found_ or row_.runner is null or not open_
    or not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = row_.runner);
  -- Runner: always. Organizer: when nobody runs it (v12). Player: only a new evening (v20).
  if not (coalesce(row_.runner = uid, false) or (org and free) or (not org and not ending and not open_)) then
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

-- ---------- end_evening: the runner ends it; the record goes into the group's history ----------
-- p_record: the evening as the app builds it (EveningRecord), or null when no match was played
-- (then only the live row ends). Returns the live row's new rev.
create or replace function private.end_evening(p_group_id uuid, p_record jsonb, p_rev bigint default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  row_ public.group_live%rowtype;
  rec jsonb;
  next_rev bigint;
begin
  if uid is null then
    raise exception 'not logged in' using errcode = '28000';
  end if;
  if not private.is_group_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if p_record is not null and p_record <> 'null'::jsonb then
    if jsonb_typeof(p_record) <> 'object'
       or jsonb_typeof(p_record -> 'id') <> 'string'
       or char_length(p_record ->> 'id') not between 1 and 100
       or jsonb_typeof(p_record -> 'matches') <> 'array'
       or jsonb_array_length(p_record -> 'matches') = 0
       or pg_column_size(p_record) >= 65536 then
      raise exception 'invalid evening' using errcode = '22023';
    end if;
    -- Only the history fields (same whitelist as the players' public copy).
    rec := private.public_doc(jsonb_build_object('history', jsonb_build_array(p_record)), '') -> 'history' -> 0;
  end if;

  select * into row_ from public.group_live l where l.group_id = p_group_id for update;
  if not found or row_.data ? 'ended' then
    raise exception 'no live evening' using errcode = 'P0002';
  end if;
  if p_rev is not null and p_rev <> row_.rev then
    raise exception 'stale rev' using errcode = '40001';
  end if;
  if row_.runner is distinct from uid then
    raise exception 'someone else runs the evening' using errcode = '40001';
  end if;

  if rec is not null then
    update public.groups g
       set data = jsonb_set(
         case when jsonb_typeof(g.data) = 'object' then g.data else '{}'::jsonb end,
         '{history}',
         jsonb_build_array(rec) || coalesce((
           select jsonb_agg(h.v order by h.i)
           from jsonb_array_elements(case when jsonb_typeof(g.data -> 'history') = 'array' then g.data -> 'history' else '[]'::jsonb end)
             with ordinality h(v, i)
           where h.v ->> 'id' is distinct from rec ->> 'id' and h.i < 150
         ), '[]'::jsonb))
     where g.id = p_group_id;
  end if;

  next_rev := row_.rev + 1;
  update public.group_live l set
    data = '{"ended": true}'::jsonb, updated_by = uid, by_name = coalesce(private.display_name(uid), ''), updated_at = now(),
    runner = null, runner_name = '', runner_since = null, rev = next_rev
  where l.group_id = p_group_id;
  return next_rev;
end;
$$;
revoke all on function private.end_evening(uuid, jsonb, bigint) from public, anon;
grant execute on function private.end_evening(uuid, jsonb, bigint) to authenticated;

create or replace function public.end_evening(p_group_id uuid, p_record jsonb, p_rev bigint default null)
returns bigint language sql security invoker set search_path = ''
as $$ select private.end_evening(p_group_id, p_record, p_rev); $$;
revoke all on function public.end_evening(uuid, jsonb, bigint) from public, anon;
grant execute on function public.end_evening(uuid, jsonb, bigint) to authenticated;
