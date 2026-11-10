-- Read-only. Run BEFORE 20261126000000_community_segments.sql and
-- 20261126000100_publish_existing_segments.sql to see what exists and what the
-- publish migration will do. Changes nothing.
--
--   npm run supabase -- db query --linked -f supabase/scripts/segments/01_pre_publish_diagnostics.sql
--
-- Works before and after 20261126000000 (it does not use deleted_at or the
-- geometry check that migration adds).

-- 1. Segments by status, visibility and access.
select status, visibility, access, count(*) as segments
from public.mtb_segments
group by status, visibility, access
order by status, visibility, access;

-- 2. Segments by creator (display name where a profile exists).
select coalesce(p.display_name, '(no profile)') as creator, s.creator_id, count(*) as segments,
       count(*) filter (where s.status = 'approved' and s.visibility = 'public') as already_public
from public.mtb_segments s
left join public.profiles p on p.id = s.creator_id
group by p.display_name, s.creator_id
order by segments desc;

-- 3. Geometry problems at the current version: missing, too few points, or a jump
--    over 250 m between consecutive points (the rule publish_segment enforces).
with current_geometry as (
  select s.id, s.name, s.status, g.geometry
  from public.mtb_segments s
  left join public.mtb_segment_geometry g on g.segment_id = s.id and g.version = s.version
), steps as (
  select c.id, max(2 * 6371000 * asin(sqrt(
           power(sin(radians(((c.geometry -> i ->> 0)::float8 - (c.geometry -> (i - 1) ->> 0)::float8) / 2)), 2) +
           cos(radians((c.geometry -> (i - 1) ->> 0)::float8)) * cos(radians((c.geometry -> i ->> 0)::float8)) *
           power(sin(radians(((c.geometry -> i ->> 1)::float8 - (c.geometry -> (i - 1) ->> 1)::float8) / 2)), 2)))) as longest_step_m
  from current_geometry c, generate_series(1, greatest(jsonb_array_length(coalesce(c.geometry, '[]')) - 1, 0)) i
  group by c.id
)
select c.id, c.name, c.status,
       case when c.geometry is null then 'missing geometry'
            when jsonb_array_length(c.geometry) < 5 then 'fewer than 5 points'
            when st.longest_step_m > 250 then 'GPS gap over 250 m'
       end as problem,
       jsonb_array_length(c.geometry) as points, round(st.longest_step_m) as longest_step_m
from current_geometry c
left join steps st on st.id = c.id
where c.geometry is null or jsonb_array_length(c.geometry) < 5 or st.longest_step_m > 250
order by c.status, c.name;

-- 4. What the publish migration would change: eligible statuses, not already
--    public, access that permits publication. (Geometry validity is checked by
--    the migration itself; rows listed in 3 are left as they are.)
select s.status, s.visibility, count(*) as would_publish
from public.mtb_segments s
where s.status in ('draft','submitted','under_review','approved')
  and not (s.status = 'approved' and s.visibility = 'public')
  and s.access not in ('restricted','closed_temporary','closed_permanent','sensitive')
group by s.status, s.visibility;

-- 5. Never republished by the migration.
select status, access, count(*) as left_alone
from public.mtb_segments
where status in ('hidden','rejected','retired','changes_requested')
   or access in ('restricted','closed_temporary','closed_permanent','sensitive')
group by status, access;
