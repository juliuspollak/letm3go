-- Proposed, not applied. Requires approval. Apply manually in the SQL editor,
-- then record it with `supabase migration repair --status applied 20261107000000`.
-- Never use `supabase db push`, and never replay earlier scripts.
--
-- 1. Named segments ("Rock Garden Descent") are private sections of one recorded
--    activity: references into that activity's own route_points (fix indices
--    and timestamps), backed up inside the activity's view_metadata under the
--    activity's existing owner-only row security and owner-checked
--    backup_private_activity RPC. No new table, policy or public visibility.
-- 2. Apple Watch recordings are backed up with recording_mode 'watch' so a
--    restore keeps their provenance. Until this is applied the app backs them
--    up as 'manual' (a ride the user started), which the current check accepts.
--
-- Community MTB trails and segments (mtb_trails, mtb_segments) and their
-- moderation are unchanged.
--
-- After applying, set NAMED_SEGMENT_BACKUP=true and WATCH_MODE_BACKUP=true in
-- src/lib/cloudSync.js.
--
-- Compatibility: every view_metadata value valid before this script stays valid
-- (the keys and rules from 20261101010000 are unchanged; one optional key is
-- added). The recording_mode check only gains a value. Existing rows are not
-- rewritten.
begin;

-- Every test is guarded by CASE so a malformed value is "invalid", never a cast
-- error: Postgres does not promise the order in which OR operands run.
create or replace function public.valid_named_segment(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p_value) <> 'object' then false else
  coalesce(jsonb_typeof(p_value->'id') = 'string'
   and (p_value->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)
  and coalesce(jsonb_typeof(p_value->'name') = 'string' and length(btrim(p_value->>'name')) between 1 and 80, false)
  and case when jsonb_typeof(p_value->'startIndex') = 'number' and jsonb_typeof(p_value->'endIndex') = 'number'
       then (p_value->>'startIndex')::numeric = trunc((p_value->>'startIndex')::numeric)
        and (p_value->>'endIndex')::numeric = trunc((p_value->>'endIndex')::numeric)
        and (p_value->>'startIndex')::numeric >= 0
        and (p_value->>'endIndex')::numeric > (p_value->>'startIndex')::numeric
        and (p_value->>'endIndex')::numeric < 50000
       else false end
  and not exists(
   select 1 from unnest(array['startTimestamp','endTimestamp','distanceMeters','durationSeconds','gapSeconds','pointCount','colorIndex','createdAt','updatedAt']) as field(name)
   where p_value ? field.name and (jsonb_typeof(p_value->field.name) <> 'number'
    or case when jsonb_typeof(p_value->field.name) = 'number' then (p_value->>field.name)::numeric < 0 else true end))
  and coalesce(p_value->>'visibility', 'private') = 'private'
  and not (p_value ? 'geometry')
  and length(p_value::text) <= 1000
 end
$$;

create or replace function public.valid_named_segments(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p_value) <> 'array' then false else
  jsonb_array_length(p_value) between 1 and 20
  and not exists(select 1 from jsonb_array_elements(p_value) as segment(value) where not public.valid_named_segment(segment.value))
  and (select count(distinct segment.value->>'id') from jsonb_array_elements(p_value) as segment(value)) = jsonb_array_length(p_value)
 end
$$;
revoke all on function public.valid_named_segment(jsonb) from public,anon;
revoke all on function public.valid_named_segments(jsonb) from public,anon;
grant execute on function public.valid_named_segment(jsonb) to authenticated,service_role;
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

-- Apple Watch recordings keep their provenance in the cloud.
alter table public.activities drop constraint if exists activities_recording_mode_check;
alter table public.activities add constraint activities_recording_mode_check
 check(recording_mode in ('manual','automatic','historical','tesla','combined','watch'));

commit;
