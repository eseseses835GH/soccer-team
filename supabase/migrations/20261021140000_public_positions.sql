-- Players may see positions (incl. "good in goal"), per the user. Still no ratings: only these
-- whitelisted values are copied, so a buggy client can't leak anything else.
create or replace function private.public_doc(d jsonb, gname text)
 returns jsonb
 language sql
 immutable
 set search_path to ''
as $function$
  select jsonb_build_object(
    'name', gname,
    'players', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', p.v -> 'id', 'name', p.v -> 'name')
        || case when jsonb_typeof(p.v -> 'positions') = 'array' then jsonb_build_object('positions', coalesce((
             select jsonb_agg(x.v order by x.i)
             from jsonb_array_elements(p.v -> 'positions') with ordinality x(v, i)
             where x.v in ('"def"'::jsonb, '"mid"'::jsonb, '"att"'::jsonb)
           ), '[]'::jsonb)) else '{}'::jsonb end
        || case when jsonb_typeof(p.v -> 'canGK') = 'boolean' then jsonb_build_object('canGK', p.v -> 'canGK') else '{}'::jsonb end
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
 where g.id = gp.group_id;
