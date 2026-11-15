-- Leaving as the last organizer (DECISIONS → "Leaving as the last organizer").
-- leave_group never deletes a group that still has player members: the last organizer gets
-- 'pick_successor' (P0001) and either hands the group to a player (leave_group_to) or deletes it
-- for everyone (delete_group). Deleting a group cascades to group_members (→ rating_votes),
-- group_invites, group_public and group_live (all FK on delete cascade).
-- Every change here takes the 'group_members:<gid>' lock (as join_group does), so two organizers
-- leaving at once can't both see "someone else stays".

create or replace function private.leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  my_role text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('group_members:' || p_group_id::text));
  select m.role into my_role from public.group_members m where m.group_id = p_group_id and m.user_id = uid;
  if not found then
    return;
  end if;
  if my_role = 'organizer' and not exists (
    select 1 from public.group_members m
    where m.group_id = p_group_id and m.role = 'organizer' and m.user_id <> uid
  ) then
    if exists (select 1 from public.group_members m where m.group_id = p_group_id and m.role = 'player') then
      raise exception 'pick_successor' using errcode = 'P0001', hint = 'leave_group_to or delete_group';
    end if;
    delete from public.groups g where g.id = p_group_id;
    return;
  end if;
  delete from public.group_members m where m.group_id = p_group_id and m.user_id = uid;
  -- Nobody left at all (can't normally happen): don't keep an orphan group.
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id) then
    delete from public.groups g where g.id = p_group_id;
  end if;
end;
$$;

-- The caller (an organizer) hands the group to a player member and leaves, in one step. The
-- successor keeps his claimed player_id; his rating switch is cleared as join_group's upgrade does.
-- The leaver's roster entry stays (history); only his membership goes.
create or replace function private.leave_group_to(p_group_id uuid, p_successor uuid)
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
  perform pg_advisory_xact_lock(hashtext('group_members:' || p_group_id::text));
  if not exists (
    select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = uid and m.role = 'organizer'
  ) then
    raise exception 'not an organizer' using errcode = '42501';
  end if;
  if p_successor is null or p_successor = uid or not exists (
    select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = p_successor and m.role = 'player'
  ) then
    raise exception 'not a player member' using errcode = '22023';
  end if;
  update public.group_members m set role = 'organizer', can_rate = null
  where m.group_id = p_group_id and m.user_id = p_successor;
  delete from public.group_members m where m.group_id = p_group_id and m.user_id = uid;
end;
$$;

-- An organizer deletes the group for everyone (members, invites, votes, live and public rows cascade).
create or replace function private.delete_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('group_members:' || p_group_id::text));
  if not private.is_group_organizer(p_group_id) then
    raise exception 'not an organizer' using errcode = '42501';
  end if;
  delete from public.groups g where g.id = p_group_id;
end;
$$;

revoke all on function private.leave_group_to(uuid, uuid) from public, anon;
revoke all on function private.delete_group(uuid) from public, anon;
grant execute on function private.leave_group_to(uuid, uuid) to authenticated;
grant execute on function private.delete_group(uuid) to authenticated;

create function public.leave_group_to(p_group_id uuid, p_successor uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.leave_group_to(p_group_id, p_successor); $$;

create function public.delete_group(p_group_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.delete_group(p_group_id); $$;

revoke all on function public.leave_group_to(uuid, uuid) from public, anon;
revoke all on function public.delete_group(uuid) from public, anon;
grant execute on function public.leave_group_to(uuid, uuid) to authenticated;
grant execute on function public.delete_group(uuid) to authenticated;
