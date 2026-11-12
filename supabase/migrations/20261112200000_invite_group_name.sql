-- Kochot v22: the login screen of an invite shows the group's name.
-- Anyone holding a live invite token may read that group's name (nothing else). Tokens are 32 random
-- chars, so this reveals a name only to whoever was sent the link. Security definer in public on
-- purpose: anon has no usage on schema private, and this is the only thing anon may call.
create function public.invite_group_name(p_token text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select g.name from public.group_invites i join public.groups g on g.id = i.group_id
  where i.token = p_token and i.revoked_at is null and i.expires_at > now();
$$;
revoke all on function public.invite_group_name(text) from public;
grant execute on function public.invite_group_name(text) to anon, authenticated;
