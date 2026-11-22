-- Kochot: player photos (round avatars) and the player's card style.
--
-- 1. Storage bucket `player-photos` (private, 300 KB, webp/jpeg). One file per roster player:
--    `<group_id>/<player_id>.webp`. Members of the group read; the player himself (the member whose
--    claim is that roster player) or any organizer of the group writes/replaces/removes.
-- 2. groups.data players carry `photo` (a short version string, so phones know to refetch) and
--    `card` ({ shirt, pattern, number }, the style the player chose). Both are server-owned: only
--    set_player_photo / set_my_card change them. A plain doc write from an organizer phone keeps
--    them as they are (an older app that doesn't know the fields can't wipe them, and nobody can
--    set them around the permission check).
-- 3. The public copy (players' phones) gets per-player `photo`, `card` (sanitized) and `score`
--    (the card score, 70–99, derived from the level; the user's explicit choice, 2026-11-22). Never
--    the level or any other attribute.

-- ---------- helpers ----------

-- Who may change a player's photo / card: an organizer of the group, or the member who claimed him.
create or replace function private.can_edit_player_photo(gid uuid, pid text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select gid is not null and pid is not null and pid ~ '^[A-Za-z0-9_-]{1,100}$' and exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = (select auth.uid())
      and (m.role = 'organizer' or m.player_id = pid)
  );
$$;
revoke all on function private.can_edit_player_photo(uuid, text) from public, anon;
grant execute on function private.can_edit_player_photo(uuid, text) to authenticated;

-- `<uuid>/<player id>.webp` → the group id (null for anything else).
create or replace function private.photo_group(path text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case when path ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[A-Za-z0-9_-]{1,100}\.webp$'
              and array_length(storage.foldername(path), 1) = 1
         then ((storage.foldername(path))[1])::uuid end;
$$;
revoke all on function private.photo_group(text) from public, anon;
grant execute on function private.photo_group(text) to authenticated;

-- `<uuid>/<player id>.webp` → the player id (null for anything else).
create or replace function private.photo_player(path text)
returns text
language sql
stable
set search_path = ''
as $$
  select case when private.photo_group(path) is not null then regexp_replace(storage.filename(path), '\.webp$', '') end;
$$;
revoke all on function private.photo_player(text) from public, anon;
grant execute on function private.photo_player(text) to authenticated;

-- The card style, kept to known keys of the right type (null when nothing valid is left).
create or replace function private.clean_card(c jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(c) is distinct from 'object' then null else nullif(
      case when jsonb_typeof(c -> 'shirt') = 'string' and (c ->> 'shirt') ~ '^[A-Za-z0-9#_-]{1,20}$'
           then jsonb_build_object('shirt', c -> 'shirt') else '{}'::jsonb end
   || case when jsonb_typeof(c -> 'pattern') = 'string' and (c ->> 'pattern') ~ '^[A-Za-z0-9#_-]{1,20}$'
           then jsonb_build_object('pattern', c -> 'pattern') else '{}'::jsonb end
   || case when jsonb_typeof(c -> 'number') = 'number' and (c ->> 'number') ~ '^[0-9]{1,2}$' and (c ->> 'number')::int between 1 and 99
           then jsonb_build_object('number', (c ->> 'number')::int) else '{}'::jsonb end,
    '{}'::jsonb) end;
$$;
revoke all on function private.clean_card(jsonb) from public, anon;
grant execute on function private.clean_card(jsonb) to authenticated;

-- ---------- storage ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player-photos', 'player-photos', false, 307200, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "members read player photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'player-photos' and (select private.is_group_member(private.photo_group(name))));

create policy "player or organizer adds a photo" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'player-photos' and (select private.can_edit_player_photo(private.photo_group(name), private.photo_player(name))));

create policy "player or organizer replaces a photo" on storage.objects
  for update to authenticated
  using (bucket_id = 'player-photos' and (select private.can_edit_player_photo(private.photo_group(name), private.photo_player(name))))
  with check (bucket_id = 'player-photos' and (select private.can_edit_player_photo(private.photo_group(name), private.photo_player(name))));

create policy "player or organizer removes a photo" on storage.objects
  for delete to authenticated
  using (bucket_id = 'player-photos' and (select private.can_edit_player_photo(private.photo_group(name), private.photo_player(name))));

-- ---------- photo / card are server-owned in groups.data ----------

-- Before every update of groups.data: each player keeps the photo/card he had (by id); a new
-- player gets none. Only set_player_photo / set_my_card (which set the flag for their transaction)
-- change them.
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
        (p.v - 'photo' - 'card') || coalesce((
          select jsonb_strip_nulls(jsonb_build_object('photo', o.v -> 'photo', 'card', o.v -> 'card'))
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

create trigger groups_keep_player_extras before update of data on public.groups
for each row execute function private.groups_keep_player_extras();

-- ---------- set_player_photo ----------
-- The player himself or an organizer (42501 otherwise). p_version: 1–20 of [0-9a-z] (22023), or
-- null to remove the photo. The player must be in the roster (22023). Bumps groups.version
-- (groups_touch), so organizer phones pull it and players' public copies follow.
create or replace function private.set_player_photo(p_group_id uuid, p_player_id text, p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  roster jsonb;
  idx int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.can_edit_player_photo(p_group_id, p_player_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_version is not null and p_version !~ '^[0-9a-z]{1,20}$' then
    raise exception 'invalid version' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('roster:' || p_group_id::text));
  select case when jsonb_typeof(g.data -> 'players') = 'array' then g.data -> 'players' else '[]'::jsonb end
    into roster
  from public.groups g where g.id = p_group_id
  for update;
  select (i - 1)::int into idx from jsonb_array_elements(roster) with ordinality as r(p, i) where p ->> 'id' = p_player_id limit 1;
  if idx is null then
    raise exception 'unknown player' using errcode = '22023';
  end if;
  perform set_config('kochot.player_extras', 'on', true);
  update public.groups g
     set data = jsonb_set(g.data, array['players', idx::text],
       case when p_version is null then (g.data -> 'players' -> idx) - 'photo'
            else (g.data -> 'players' -> idx) || jsonb_build_object('photo', p_version) end)
   where g.id = p_group_id;
  perform set_config('kochot.player_extras', '', true);
end;
$$;
revoke all on function private.set_player_photo(uuid, text, text) from public, anon;
grant execute on function private.set_player_photo(uuid, text, text) to authenticated;

create function public.set_player_photo(p_group_id uuid, p_player_id text, p_version text)
returns void language sql security invoker set search_path = ''
as $$ select private.set_player_photo(p_group_id, p_player_id, p_version); $$;
revoke all on function public.set_player_photo(uuid, text, text) from public, anon;
grant execute on function public.set_player_photo(uuid, text, text) to authenticated;

-- ---------- set_my_card ----------
-- Same permission and roster check. p_card is cleaned (private.clean_card); nothing valid (or
-- null) removes the card. Returns what was stored.
create or replace function private.set_my_card(p_group_id uuid, p_player_id text, p_card jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  roster jsonb;
  idx int;
  c jsonb := private.clean_card(p_card);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.can_edit_player_photo(p_group_id, p_player_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('roster:' || p_group_id::text));
  select case when jsonb_typeof(g.data -> 'players') = 'array' then g.data -> 'players' else '[]'::jsonb end
    into roster
  from public.groups g where g.id = p_group_id
  for update;
  select (i - 1)::int into idx from jsonb_array_elements(roster) with ordinality as r(p, i) where p ->> 'id' = p_player_id limit 1;
  if idx is null then
    raise exception 'unknown player' using errcode = '22023';
  end if;
  perform set_config('kochot.player_extras', 'on', true);
  update public.groups g
     set data = jsonb_set(g.data, array['players', idx::text],
       case when c is null then (g.data -> 'players' -> idx) - 'card'
            else (g.data -> 'players' -> idx) || jsonb_build_object('card', c) end)
   where g.id = p_group_id;
  perform set_config('kochot.player_extras', '', true);
  return c;
end;
$$;
revoke all on function private.set_my_card(uuid, text, jsonb) from public, anon;
grant execute on function private.set_my_card(uuid, text, jsonb) to authenticated;

create function public.set_my_card(p_group_id uuid, p_player_id text, p_card jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.set_my_card(p_group_id, p_player_id, p_card); $$;
revoke all on function public.set_my_card(uuid, text, jsonb) from public, anon;
grant execute on function public.set_my_card(uuid, text, jsonb) to authenticated;

-- ---------- public copy ----------
-- Same function as 20261115130000_public_settings plus per-player photo, card and score.
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
             then jsonb_build_object('score', round(70 + (least(10, greatest(1, (p.v -> 'attrs' ->> 'overall')::numeric)) - 1) * 29 / 9)::int)
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

-- Refresh the existing public copies with the new fields.
update public.group_public gp
   set data = private.public_doc(g.data, g.name), updated_at = now()
  from public.groups g
 where g.id = gp.group_id
   and gp.data is distinct from private.public_doc(g.data, g.name);
