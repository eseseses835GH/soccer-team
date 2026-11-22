-- Kochot: a player has two files — `<gid>/<pid>.webp` (round avatar, the enhanced portrait) and
-- `<gid>/<pid>-cut.webp` (the card cutout, transparent background). Safari can't write WebP, so
-- the cutout may be PNG bytes (the name stays .webp; the content type says what it is).
-- The permission check treats `<pid>-cut` as the player <pid>.
create or replace function private.photo_player(path text)
returns text
language sql
stable
set search_path = ''
as $$
  select case when private.photo_group(path) is not null
              then regexp_replace(regexp_replace(storage.filename(path), '\.webp$', ''), '-cut$', '') end;
$$;
revoke all on function private.photo_player(text) from public, anon;
grant execute on function private.photo_player(text) to authenticated;

update storage.buckets
   set file_size_limit = 512000, allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png']
 where id = 'player-photos';
