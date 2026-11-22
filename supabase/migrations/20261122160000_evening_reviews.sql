-- Kochot v37: after-game review ("איך שיחקו הערב?").
--
-- For 48 hours after an evening is saved to the history (groups.data.history, by its endedAt), every
-- member whose claimed player played that evening says how each of the others played THAT evening:
-- -1 "פחות טוב", 0 "כרגיל", +1 "יותר טוב" (no row = "לא יודע").
-- Effect: per player and evening, the mean of the votes when there are at least 2; his `form` =
--   Σ 0.3 × mean_e × 0.85^k over those evenings (newest first, k = 0, 1, 2…), clamped to ±1.5,
-- stored on the roster player in groups.data (2 decimals; removed when 0). Server-owned like
-- photo/card: only review_evening changes it. Evenings no longer in the history don't count.
-- Splitting uses clamp(level + form, 1, 10); the public card score too. Players never see a level
-- or the form, and nobody sees anyone's votes but his own.

-- ---------- table ----------

create table public.evening_reviews (
  group_id uuid not null,
  evening_id text not null check (char_length(evening_id) between 1 and 64),
  voter uuid not null default auth.uid(),
  player_id text not null check (char_length(player_id) between 1 and 100),
  value smallint not null check (value in (-1, 0, 1)),
  created_at timestamptz not null default now(),
  primary key (group_id, evening_id, voter, player_id),
  -- Leaving / being removed from the group deletes your reviews (as rating_votes).
  foreign key (group_id, voter) references public.group_members (group_id, user_id) on delete cascade
);
create index evening_reviews_player_idx on public.evening_reviews (group_id, player_id);

-- No direct access at all: RPCs only.
alter table public.evening_reviews enable row level security;
revoke all on public.evening_reviews from public, anon, authenticated;

-- ---------- helpers ----------

-- The history record with that id (null when there is none).
create or replace function private.history_evening(d jsonb, eid text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select h.v
  from jsonb_array_elements(case when jsonb_typeof(d -> 'history') = 'array' then d -> 'history' else '[]'::jsonb end) h(v)
  where jsonb_typeof(h.v) = 'object' and h.v ->> 'id' = eid
  limit 1;
$$;
revoke all on function private.history_evening(jsonb, text) from public, anon, authenticated;

-- Everyone who was there: the record's players, teams and bench (as the app's eveningPlayerIds).
create or replace function private.evening_player_ids(ev jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select p ->> 'id' as x
    from jsonb_array_elements(case when jsonb_typeof(ev -> 'players') = 'array' then ev -> 'players' else '[]'::jsonb end) p
    where jsonb_typeof(p -> 'id') = 'string'
    union all
    select i #>> '{}'
    from jsonb_array_elements(case when jsonb_typeof(ev -> 'teams') = 'array' then ev -> 'teams' else '[]'::jsonb end) t,
         jsonb_array_elements(case when jsonb_typeof(t -> 'ids') = 'array' then t -> 'ids' else '[]'::jsonb end) i
    where jsonb_typeof(i) = 'string'
    union all
    select s #>> '{}'
    from jsonb_array_elements(case when jsonb_typeof(ev -> 'subIds') = 'array' then ev -> 'subIds' else '[]'::jsonb end) s
    where jsonb_typeof(s) = 'string'
  ) ids;
$$;
revoke all on function private.evening_player_ids(jsonb) from public, anon, authenticated;

-- One player's form from the reviews of the evenings still in the history (see the header).
create or replace function private.player_form(gid uuid, d jsonb, pid text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with evs as (
    select distinct on (h.v ->> 'id') h.v ->> 'id' as eid, (h.v ->> 'endedAt')::numeric as ended
    from jsonb_array_elements(case when jsonb_typeof(d -> 'history') = 'array' then d -> 'history' else '[]'::jsonb end) h(v)
    where jsonb_typeof(h.v) = 'object' and jsonb_typeof(h.v -> 'id') = 'string' and jsonb_typeof(h.v -> 'endedAt') = 'number'
  ),
  means as (
    select e.eid, e.ended, avg(r.value)::numeric as m
    from evs e
    join public.evening_reviews r on r.group_id = gid and r.evening_id = e.eid and r.player_id = pid
    group by e.eid, e.ended
    having count(*) >= 2
  ),
  ranked as (
    select m, row_number() over (order by ended desc, eid) - 1 as k from means
  )
  select round(greatest(-1.5, least(1.5, coalesce(sum(0.3 * m * power(0.85::numeric, k)), 0))), 2) from ranked;
$$;
revoke all on function private.player_form(uuid, jsonb, text) from public, anon, authenticated;

-- ---------- photo / card / form are server-owned in groups.data ----------
-- Same as 20261122120000_player_photos plus `form`. review_evening sets the same flag.
create or replace function private.groups_keep_player_extras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  olds jsonb := case when jsonb_typeof(old.data -> 'players') = 'array' then old.data -> 'players' else '[]'::jsonb end;
begin
  if coalesce(current_setting('kochot.player_extras', true), '') = 'on' then
    return new;
  end if;
  if jsonb_typeof(new.data -> 'players') is distinct from 'array' then
    return new;
  end if;
  new.data := jsonb_set(new.data, '{players}', coalesce((
    select jsonb_agg(
      case when jsonb_typeof(p.v) = 'object' then
        (p.v - 'photo' - 'card' - 'form') || coalesce((
          select jsonb_strip_nulls(jsonb_build_object('photo', o.v -> 'photo', 'card', o.v -> 'card', 'form', o.v -> 'form'))
          from jsonb_array_elements(olds) o(v)
          where jsonb_typeof(o.v) = 'object' and o.v -> 'id' = p.v -> 'id'
          limit 1
        ), '{}'::jsonb)
      else p.v end
      order by p.i)
    from jsonb_array_elements(new.data -> 'players') with ordinality p(v, i)
  ), '[]'::jsonb));
  return new;
end;
$$;
revoke all on function private.groups_keep_player_extras() from public, anon, authenticated;

-- ---------- review_evening ----------
-- p_votes: [{ "player_id": "...", "value": -1 | 0 | 1 | null }], at most 60. Replaces all of the
-- caller's votes for that evening (null / absent value = no vote). Then recomputes `form` of every
-- player whose votes changed. Returns the caller's votes afterwards ({ player_id: value }).
-- Errors: 28000 not logged in; 42501 not a member / his claimed player didn't play that evening /
-- the 48 hours are over; 22023 bad input, unknown evening, a player who wasn't there, or himself.
create or replace function private.review_evening(p_group_id uuid, p_evening_id text, p_votes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me public.group_members;
  d jsonb;
  ev jsonb;
  ids text[];
  ended numeric;
  e jsonb;
  pid text;
  val jsonb;
  newv jsonb := '{}'::jsonb;
  oldv jsonb;
  touched text[];
  players jsonb;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into me from public.group_members m where m.group_id = p_group_id and m.user_id = uid;
  if not found or me.player_id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_evening_id is null or char_length(p_evening_id) not between 1 and 64
     or jsonb_typeof(p_votes) is distinct from 'array' or jsonb_array_length(p_votes) > 60 then
    raise exception 'invalid votes' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('roster:' || p_group_id::text));
  select g.data into d from public.groups g where g.id = p_group_id for update;
  ev := private.history_evening(d, p_evening_id);
  if ev is null or jsonb_typeof(ev -> 'endedAt') is distinct from 'number' then
    raise exception 'unknown evening' using errcode = '22023';
  end if;
  ids := private.evening_player_ids(ev);
  if not (me.player_id = any (ids)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  ended := (ev ->> 'endedAt')::numeric;
  if to_timestamp(ended / 1000) <= now() - interval '48 hours' or to_timestamp(ended / 1000) > now() + interval '10 minutes' then
    raise exception 'review closed' using errcode = '42501';
  end if;

  for e in select * from jsonb_array_elements(p_votes) loop
    if jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e -> 'player_id') is distinct from 'string' then
      raise exception 'invalid votes' using errcode = '22023';
    end if;
    pid := e ->> 'player_id';
    val := e -> 'value';
    if pid = me.player_id or not (pid = any (ids)) then
      raise exception 'invalid votes' using errcode = '22023';
    end if;
    if val is null or jsonb_typeof(val) = 'null' then
      newv := newv - pid;
    elsif jsonb_typeof(val) = 'number' and (val #>> '{}') in ('-1', '0', '1') then
      newv := newv || jsonb_build_object(pid, (val #>> '{}')::int);
    else
      raise exception 'invalid votes' using errcode = '22023';
    end if;
  end loop;

  select coalesce(jsonb_object_agg(r.player_id, r.value), '{}'::jsonb) into oldv
  from public.evening_reviews r
  where r.group_id = p_group_id and r.evening_id = p_evening_id and r.voter = uid;

  select coalesce(array_agg(k), '{}') into touched from (
    select k from jsonb_object_keys(oldv || newv) k
    where oldv -> k is distinct from newv -> k
  ) x;
  if cardinality(touched) = 0 then
    return newv;
  end if;

  delete from public.evening_reviews r
  where r.group_id = p_group_id and r.evening_id = p_evening_id and r.voter = uid;
  insert into public.evening_reviews (group_id, evening_id, voter, player_id, value)
  select p_group_id, p_evening_id, uid, n.key, (n.value #>> '{}')::smallint
  from jsonb_each(newv) n;

  -- The touched players' form, on the roster (players no longer in the roster are skipped).
  if jsonb_typeof(d -> 'players') = 'array' then
    select coalesce(jsonb_agg(
      case when jsonb_typeof(p.v) = 'object' and (p.v ->> 'id') = any (touched) then
        case when f.form = 0 then p.v - 'form' else p.v || jsonb_build_object('form', f.form) end
      else p.v end
      order by p.i), '[]'::jsonb)
      into players
    from jsonb_array_elements(d -> 'players') with ordinality p(v, i)
    left join lateral (
      select private.player_form(p_group_id, d, p.v ->> 'id') as form
      where jsonb_typeof(p.v) = 'object' and (p.v ->> 'id') = any (touched)
    ) f on true;
    if players is distinct from d -> 'players' then
      perform set_config('kochot.player_extras', 'on', true);
      update public.groups g set data = jsonb_set(g.data, '{players}', players) where g.id = p_group_id;
      perform set_config('kochot.player_extras', '', true);
    end if;
  end if;
  return newv;
end;
$$;
revoke all on function private.review_evening(uuid, text, jsonb) from public, anon;
grant execute on function private.review_evening(uuid, text, jsonb) to authenticated;

create function public.review_evening(p_group_id uuid, p_evening_id text, p_votes jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.review_evening(p_group_id, p_evening_id, p_votes); $$;
revoke all on function public.review_evening(uuid, text, jsonb) from public, anon;
grant execute on function public.review_evening(uuid, text, jsonb) to authenticated;

-- ---------- my_review ----------
-- The caller's own votes for that evening ({ player_id: value }). Members only (42501).
create or replace function private.my_review(p_group_id uuid, p_evening_id text)
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
  return coalesce((select jsonb_object_agg(r.player_id, r.value) from public.evening_reviews r
                   where r.group_id = p_group_id and r.evening_id = p_evening_id and r.voter = (select auth.uid())), '{}'::jsonb);
end;
$$;
revoke all on function private.my_review(uuid, text) from public, anon;
grant execute on function private.my_review(uuid, text) to authenticated;

create function public.my_review(p_group_id uuid, p_evening_id text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.my_review(p_group_id, p_evening_id); $$;
revoke all on function public.my_review(uuid, text) from public, anon;
grant execute on function public.my_review(uuid, text) to authenticated;

-- ---------- public copy ----------
-- Same function as 20261122120000_player_photos; only `score` changes: from the level + form (clamped 1–10).
create or replace function private.public_doc(d jsonb, gname text)
 returns jsonb
 language sql
 immutable
 set search_path to ''
as $function$
  select jsonb_build_object(
    'name', gname,
    'settings', private.jpick(d -> 'settings', array['matchMinutes', 'matchNoLimit', 'drawExtraMinutes', 'gkMode', 'gkSwitchGoals']),
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
        || case when p.v -> 'noGK' = 'true'::jsonb then jsonb_build_object('noGK', true) else '{}'::jsonb end
        || case when jsonb_typeof(p.v -> 'photo') = 'string' and (p.v ->> 'photo') ~ '^[0-9a-z]{1,20}$'
             then jsonb_build_object('photo', p.v -> 'photo') else '{}'::jsonb end
        || case when private.clean_card(p.v -> 'card') is not null
             then jsonb_build_object('card', private.clean_card(p.v -> 'card')) else '{}'::jsonb end
        || case when jsonb_typeof(p.v -> 'attrs' -> 'overall') = 'number'
             then jsonb_build_object('score', round(70 + (least(10, greatest(1,
                    (p.v -> 'attrs' ->> 'overall')::numeric
                    + case when jsonb_typeof(p.v -> 'form') = 'number' then least(1.5, greatest(-1.5, (p.v ->> 'form')::numeric)) else 0 end
                  )) - 1) * 29 / 9)::int)
             else '{}'::jsonb end
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
revoke all on function private.public_doc(jsonb, text) from public, anon, authenticated;
