-- Proposed, not applied. Requires approval. Apply manually in the SQL editor,
-- then record it with `supabase migration repair --status applied 20261107000000`.
-- Never use `supabase db push`, and never replay earlier scripts.
--
-- Named segments ("Rock Garden Descent") are private sections of one recorded
-- activity. They are references into that activity's own route_points (fix
-- indices and timestamps), so they are backed up inside the activity's
-- view_metadata, under the activity's existing owner-only row security. No new
-- table, policy or public visibility is introduced; community MTB trails and
-- segments (mtb_trails, mtb_segments) and their moderation are unchanged.
--
-- After applying, set NAMED_SEGMENT_BACKUP=true in src/lib/cloudSync.js.
begin;

create or replace function public.valid_named_segments(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select jsonb_typeof(p_value)='array'
  and jsonb_array_length(p_value) between 1 and 20
  and not exists(
   select 1 from jsonb_array_elements(p_value) as segment(value)
   where jsonb_typeof(segment.value)<>'object'
    or jsonb_typeof(segment.value->'id')<>'string' or length(segment.value->>'id')<>36
    or jsonb_typeof(segment.value->'name')<>'string' or length(btrim(segment.value->>'name')) not between 1 and 80
    or jsonb_typeof(segment.value->'startIndex')<>'number' or jsonb_typeof(segment.value->'endIndex')<>'number'
    or (segment.value->>'startIndex')::numeric < 0 or (segment.value->>'endIndex')::numeric <= (segment.value->>'startIndex')::numeric
    or coalesce(segment.value->>'visibility','private')<>'private'
    or length(segment.value::text) > 1000
  )
$$;
revoke all on function public.valid_named_segments(jsonb) from public,anon;
grant execute on function public.valid_named_segments(jsonb) to authenticated,service_role;

-- Same rules as 20261101010000 for the existing keys, plus namedSegments.
create or replace function public.valid_view_metadata(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select jsonb_typeof(p_value)='object'
  and (select count(*) from jsonb_object_keys(p_value))<=6
  and not exists(
   select 1 from jsonb_each(p_value) as entry(key,value)
   where case
    when entry.key in ('visibleRouteStart','visibleRouteEnd') then jsonb_typeof(entry.value)<>'number'
    when entry.key in ('startPlace','endPlace') then jsonb_typeof(entry.value)<>'string' or length(entry.value #>> '{}')>120
    when entry.key='coverPhotoID' then jsonb_typeof(entry.value)<>'string' or length(entry.value #>> '{}')>100
    when entry.key='namedSegments' then not public.valid_named_segments(entry.value)
    else true
   end
  )
$$;

commit;
