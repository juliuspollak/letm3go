-- Read-only. Run AFTER 20261126000000_community_segments.sql and
-- 20261126000100_publish_existing_segments.sql. Every check returns rows only
-- when something is wrong, except the summaries (1 and 6).
--
--   npm run supabase -- db query --linked -f supabase/scripts/segments/03_post_publish_verification.sql

-- 1. Summary after publishing.
select status, visibility, (deleted_at is not null) as deleted, count(*) as segments
from public.mtb_segments group by 1, 2, 3 order by 1, 2, 3;

-- 2. EXPECT NO ROWS: an eligible live segment with valid geometry that is still not public.
select s.id, s.name, s.status, s.visibility
from public.mtb_segments s
join public.mtb_segment_geometry g on g.segment_id = s.id and g.version = s.version
where s.deleted_at is null
  and s.status in ('draft','submitted','under_review')
  and s.access not in ('restricted','closed_temporary','closed_permanent','sensitive')
  and public.segment_geometry_problem(g.geometry) is null;

-- 3. EXPECT NO ROWS: something published that must not be (hidden, rejected,
--    retired, deleted or restricted).
select id, name, status, visibility, access, deleted_at
from public.mtb_segments
where visibility = 'public' and status = 'approved'
  and (deleted_at is not null or access in ('restricted','closed_temporary','closed_permanent','sensitive'));

-- 4. EXPECT NO ROWS: a segment without geometry at its current version (versions
--    and history are preserved, so every segment still points at a real row).
select s.id, s.name, s.version
from public.mtb_segments s
left join public.mtb_segment_geometry g on g.segment_id = s.id and g.version = s.version
where g.segment_id is null;

-- 5. EXPECT NO ROWS: a migration event without a segment, or a published segment
--    whose creator was lost (ownership is never changed by the migration).
select e.id from public.mtb_moderation_events e
left join public.mtb_segments s on s.id = e.segment_id
where e.note like 'published by migration 20261126000100%' and s.id is null;
select s.id, s.name from public.mtb_segments s
where s.status = 'approved' and s.visibility = 'public' and s.creator_id is null;

-- 6. What the migration published, with creators.
select s.id, s.name, coalesce(p.display_name, '(no profile)') as creator, e.created_at as published_at
from public.mtb_moderation_events e
join public.mtb_segments s on s.id = e.segment_id
left join public.profiles p on p.id = s.creator_id
where e.note like 'published by migration 20261126000100%'
order by e.created_at;

-- 7. Cross-user visibility, as an ordinary signed-in person sees it. Replace the
--    UUID with someone who did NOT create the segments (for example the other
--    test account) and expect every public segment by others in the result.
--   begin;
--   set local role authenticated;
--   select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
--   select id, name, creator_name, mine from public.list_segments('all') limit 20;
--   rollback;
