-- Rope skipping (an Apple Watch Gym subtype). The watch counts the jumps and the phone keeps one
-- summary with the activity: jumps, total and active seconds, the number of skipping intervals and
-- a bounded list of intervals. The cloud backs it up inside the activity's existing view_metadata,
-- under the same owner-only row security and owner-checked backup RPC as every other view key.
-- No new table, policy or visibility; activities.activity is free text, so the value 'Rope skipping'
-- needs no change there.
begin;

create or replace function public.rope_number(p_value jsonb, p_min numeric, p_max numeric) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p_value)='number' then (p_value #>> '{}')::numeric between p_min and p_max else false end
$$;

create or replace function public.valid_rope_interval(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p_value)<>'object' then false else
  not exists(select 1 from jsonb_object_keys(p_value) as k(name) where k.name not in ('start','end','jumps'))
  and public.rope_number(p_value->'start',0,10000000000)
  and public.rope_number(p_value->'end',0,10000000000)
  and public.rope_number(p_value->'jumps',1,100000)
  and (p_value->>'end')::numeric>=(p_value->>'start')::numeric
 end
$$;

create or replace function public.valid_rope_skipping(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p_value)<>'object' then false else
  not exists(select 1 from jsonb_object_keys(p_value) as k(name)
   where k.name not in ('jumps','totalSeconds','activeSeconds','intervalCount','intervals'))
  and public.rope_number(p_value->'jumps',0,100000)
  and public.rope_number(p_value->'totalSeconds',0,1000000)
  and public.rope_number(p_value->'activeSeconds',0,1000000)
  and (p_value->>'activeSeconds')::numeric<=(p_value->>'totalSeconds')::numeric
  and public.rope_number(p_value->'intervalCount',0,10000)
  and jsonb_typeof(p_value->'intervals')='array'
  and jsonb_array_length(p_value->'intervals')<=200
  and not exists(select 1 from jsonb_array_elements(p_value->'intervals') as i(value) where not public.valid_rope_interval(i.value))
 end
$$;
revoke all on function public.rope_number(jsonb,numeric,numeric) from public,anon;
revoke all on function public.valid_rope_interval(jsonb) from public,anon;
revoke all on function public.valid_rope_skipping(jsonb) from public,anon;
grant execute on function public.rope_number(jsonb,numeric,numeric) to authenticated,service_role;
grant execute on function public.valid_rope_interval(jsonb) to authenticated,service_role;
grant execute on function public.valid_rope_skipping(jsonb) to authenticated,service_role;

-- The same shape as before plus one key, so up to seven.
create or replace function public.valid_view_metadata(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select jsonb_typeof(p_value)='object'
  and (select count(*) from jsonb_object_keys(p_value))<=7
  and not exists(
   select 1 from jsonb_each(p_value) as entry(key,value)
   where case
    when entry.key in ('visibleRouteStart','visibleRouteEnd') then jsonb_typeof(entry.value)<>'number'
    when entry.key in ('startPlace','endPlace') then jsonb_typeof(entry.value)<>'string' or length(entry.value #>> '{}')>120
    when entry.key='coverPhotoID' then jsonb_typeof(entry.value)<>'string' or length(entry.value #>> '{}')>100
    when entry.key='namedSegments' then not public.valid_named_segments(entry.value)
    when entry.key='ropeSkipping' then not public.valid_rope_skipping(entry.value)
    else true
   end
  )
$$;

commit;
