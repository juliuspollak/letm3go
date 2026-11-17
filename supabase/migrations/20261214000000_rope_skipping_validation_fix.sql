-- Forward-only fix for the Rope skipping summary check in 20261213000000 (not edited, it may be applied).
-- Two holes in it:
--  * SQL does not promise that `a and b` stops at the first false, so a summary whose `intervals` was a
--    string or object could reach jsonb_array_length and raise "cannot get array length of a non-array"
--    instead of failing the check cleanly;
--  * a summary without `intervals` made the whole expression NULL, and a CHECK constraint lets NULL through.
-- Every test below is inside a CASE, so a value is only read once its type is known, every field is
-- required, and the function always answers true or false. valid_view_metadata also treats a NULL answer
-- from a nested validator as invalid. Summaries that were valid stay valid.
begin;

create or replace function public.valid_rope_interval(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(case when jsonb_typeof(p_value)<>'object' then false
  when exists(select 1 from jsonb_object_keys(p_value) as k(name) where k.name not in ('start','end','jumps')) then false
  when not (public.rope_number(p_value->'start',0,10000000000) and public.rope_number(p_value->'end',0,10000000000)
   and public.rope_number(p_value->'jumps',1,100000)) then false
  else (p_value->>'end')::numeric>=(p_value->>'start')::numeric
 end,false)
$$;

create or replace function public.valid_rope_skipping(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(case when jsonb_typeof(p_value)<>'object' then false
  when exists(select 1 from jsonb_object_keys(p_value) as k(name)
   where k.name not in ('jumps','totalSeconds','activeSeconds','intervalCount','intervals')) then false
  -- every field is required and numeric
  when not (public.rope_number(p_value->'jumps',0,100000) and public.rope_number(p_value->'totalSeconds',0,1000000)
   and public.rope_number(p_value->'activeSeconds',0,1000000) and public.rope_number(p_value->'intervalCount',0,10000)) then false
  when (p_value->>'activeSeconds')::numeric>(p_value->>'totalSeconds')::numeric then false
  -- no more than 5 jumps a second of skipping time (the counter stops near 3.3), so a count cannot be made up out of nothing
  when (p_value->>'jumps')::numeric>(p_value->>'activeSeconds')::numeric*5+10 then false
  when jsonb_typeof(p_value->'intervals') is distinct from 'array' then false
  when jsonb_array_length(p_value->'intervals')>200 then false
  else not exists(select 1 from jsonb_array_elements(p_value->'intervals') as i(value) where not public.valid_rope_interval(i.value))
 end,false)
$$;

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
    when entry.key='namedSegments' then not coalesce(public.valid_named_segments(entry.value),false)
    when entry.key='ropeSkipping' then not coalesce(public.valid_rope_skipping(entry.value),false)
    else true
   end
  )
$$;

commit;
