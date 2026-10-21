-- Kochot v10: ending the live evening keeps the row and replaces its data with {"ended": true}.
-- Realtime can't deliver DELETE events to a filtered subscription (group_id=eq.…), so a delete
-- would leave players' screens showing a finished evening. Readers treat anything without
-- v = 1 and teams as "nothing live" (sanitizeLive → null).
create or replace function private.live_set(p_group_id uuid, p_data jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t timestamptz := now();
  d jsonb := p_data;
begin
  if not private.is_group_organizer(p_group_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if d is null or d = 'null'::jsonb then
    d := '{"ended": true}'::jsonb;
  end if;
  if jsonb_typeof(d) <> 'object' or pg_column_size(d) >= 65536
     or d::text ~ '"(attrs|levelVotes|cards|overall|weaknesses)":' then
    raise exception 'invalid live data' using errcode = '22023';
  end if;
  insert into public.group_live as l (group_id, data, updated_by, by_name, updated_at)
  values (p_group_id, d, uid, coalesce(private.display_name(uid), ''), t)
  on conflict (group_id) do update
    set data = excluded.data, updated_by = excluded.updated_by, by_name = excluded.by_name, updated_at = excluded.updated_at;
  return t;
end;
$$;
