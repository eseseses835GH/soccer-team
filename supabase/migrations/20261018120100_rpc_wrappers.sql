-- Security advisor (lint 0029): keep SECURITY DEFINER code out of the exposed `public` schema.
-- The privileged bodies move to `private` (not exposed by the API); `public` keeps thin
-- SECURITY INVOKER wrappers with the same signatures, so the client API is unchanged.

alter function public.create_group(uuid, text, jsonb) set schema private;
alter function public.create_invite(uuid) set schema private;
alter function public.join_group(text) set schema private;
alter function public.leave_group(uuid) set schema private;

revoke all on function private.create_group(uuid, text, jsonb) from public, anon;
revoke all on function private.create_invite(uuid) from public, anon;
revoke all on function private.join_group(text) from public, anon;
revoke all on function private.leave_group(uuid) from public, anon;
grant execute on function private.create_group(uuid, text, jsonb) to authenticated;
grant execute on function private.create_invite(uuid) to authenticated;
grant execute on function private.join_group(text) to authenticated;
grant execute on function private.leave_group(uuid) to authenticated;

create function public.create_group(p_id uuid, p_name text, p_data jsonb)
returns public.groups language sql security invoker set search_path = ''
as $$ select * from private.create_group(p_id, p_name, p_data); $$;

create function public.create_invite(p_group_id uuid)
returns text language sql security invoker set search_path = ''
as $$ select private.create_invite(p_group_id); $$;

create function public.join_group(p_token text)
returns table (group_id uuid, name text) language sql security invoker set search_path = ''
as $$ select * from private.join_group(p_token); $$;

create function public.leave_group(p_group_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.leave_group(p_group_id); $$;

revoke all on function public.create_group(uuid, text, jsonb) from public, anon;
revoke all on function public.create_invite(uuid) from public, anon;
revoke all on function public.join_group(text) from public, anon;
revoke all on function public.leave_group(uuid) from public, anon;
grant execute on function public.create_group(uuid, text, jsonb) to authenticated;
grant execute on function public.create_invite(uuid) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
