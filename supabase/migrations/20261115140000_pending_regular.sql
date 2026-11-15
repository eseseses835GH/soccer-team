-- Kochot: a player who adds someone may ask for him as a regular ("קבוע בקבוצה").
-- From a non-organizer that's a guest waiting for an organizer's approval (occasional + pendingRegular);
-- from an organizer it's a plain regular. Everything else as 20261114140000_guest_level.
drop function public.add_guest(uuid, text, int);
drop function private.add_guest(uuid, text, int);

create function private.add_guest(p_group_id uuid, p_name text, p_level int default 5, p_regular boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  lv int := coalesce(p_level, 5);
  org boolean;
  row_ public.group_live%rowtype;
  open_ boolean;
  roster jsonb;
  pid text;
  reg boolean;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(nm) not between 1 and 24 or lv not between 1 and 10 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  if not private.is_group_member(p_group_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('roster:' || p_group_id::text));
  org := private.is_group_organizer(p_group_id);
  if not org then
    select * into row_ from public.group_live l where l.group_id = p_group_id;
    open_ := found and private.live_is_open(row_.data, row_.updated_at);
    if open_ and row_.runner is distinct from uid then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end if;
  select case when jsonb_typeof(g.data -> 'players') = 'array' then g.data -> 'players' else '[]'::jsonb end
    into roster
  from public.groups g where g.id = p_group_id
  for update;
  if roster is null then
    raise exception 'not allowed' using errcode = '42501';
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
  reg := coalesce(p_regular, false);
  update public.groups g
     set data = jsonb_set(
       case when jsonb_typeof(g.data) = 'object' then g.data else '{}'::jsonb end,
       '{players}',
       roster || jsonb_build_array(jsonb_build_object(
         'id', pid,
         'name', nm,
         'attrs', jsonb_build_object('overall', lv, 'stamina', lv, 'passing', lv, 'dribbling', lv,
                                     'shooting', lv, 'defense', lv, 'teamwork', lv, 'leadership', lv),
         'canGK', false,
         'cards', '[]'::jsonb
       ) || case
         when reg and org then '{}'::jsonb
         when reg then '{"occasional": true, "pendingRegular": true}'::jsonb
         else '{"occasional": true}'::jsonb
       end))
   where g.id = p_group_id;
  return pid;
end;
$$;
revoke all on function private.add_guest(uuid, text, int, boolean) from public, anon;
grant execute on function private.add_guest(uuid, text, int, boolean) to authenticated;

create function public.add_guest(p_group_id uuid, p_name text, p_level int default 5, p_regular boolean default false)
returns text language sql security invoker set search_path = ''
as $$ select private.add_guest(p_group_id, p_name, p_level, p_regular); $$;
revoke all on function public.add_guest(uuid, text, int, boolean) from public, anon;
grant execute on function public.add_guest(uuid, text, int, boolean) to authenticated;
