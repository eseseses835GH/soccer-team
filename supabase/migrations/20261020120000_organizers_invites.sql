-- Kochot v6: show a group's organizers, list and revoke invite links.
--
-- Names: there is no profile table. group_organizers() (security definer, in `private`) returns,
-- for a group the caller belongs to, each member's user id, a display name, role, join date and
-- whether it is the caller. The display name is the login's own name (Google `full_name`/`name`)
-- or else the part of the email before the @. The full email address is never returned, and
-- auth.users is not exposed in any other way. Non-members get "not a member" (42501).
--
-- Revoking: until now members could UPDATE group_invites.revoked_at directly, which also allowed
-- un-revoking a link (setting it back to null) or post-dating it. That direct write is removed;
-- revoke_invite(token) only ever sets revoked_at = now() on a live link of a group the caller
-- belongs to. A revoked token is already refused by join_group().

-- ---------- organizers ----------

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
  select
    m.user_id,
    left(coalesce(
      nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(u.email, '@', 1), ''),
      ''
    ), 40),
    m.role,
    m.joined_at,
    m.user_id = (select auth.uid())
  from public.group_members m
  join auth.users u on u.id = m.user_id
  where m.group_id = p_group_id
  order by m.joined_at, m.user_id;
end;
$$;

revoke all on function private.group_organizers(uuid) from public, anon;
grant execute on function private.group_organizers(uuid) to authenticated;

create function public.group_organizers(p_group_id uuid)
returns table (user_id uuid, display_name text, role text, joined_at timestamptz, is_me boolean)
language sql stable security invoker set search_path = ''
as $$ select * from private.group_organizers(p_group_id); $$;

revoke all on function public.group_organizers(uuid) from public, anon;
grant execute on function public.group_organizers(uuid) to authenticated;

-- ---------- revoking invites ----------

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
  -- Unknown tokens and other groups' tokens give the same answer.
  if gid is null or not private.is_group_member(gid) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  update public.group_invites i set revoked_at = now()
  where i.token = p_token and i.revoked_at is null;
end;
$$;

revoke all on function private.revoke_invite(text) from public, anon;
grant execute on function private.revoke_invite(text) to authenticated;

create function public.revoke_invite(p_token text)
returns void language sql security invoker set search_path = ''
as $$ select private.revoke_invite(p_token); $$;

revoke all on function public.revoke_invite(text) from public, anon;
grant execute on function public.revoke_invite(text) to authenticated;

-- No more direct writes to invites (members still read their groups' invites).
drop policy if exists "members revoke invites" on public.group_invites;
revoke update on public.group_invites from authenticated;
