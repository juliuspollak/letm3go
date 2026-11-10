-- Publish the segments that already exist on the server, now that segments are
-- public without admin approval (20261126000000_community_segments.sql).
--
-- Eligible: a live (not deleted) segment in draft, submitted, under_review or
-- approved, with valid current geometry, whose access does not keep it private
-- (restricted, closed or sensitive), that is not already public and approved.
-- Never touched: hidden, rejected, retired, changes_requested, deleted, or a
-- restricted/closed/sensitive segment that an approval deliberately kept private.
--
-- Non-destructive and idempotent: only status, visibility and updated_at change on
-- eligible rows, each change is recorded in mtb_moderation_events, and a second
-- run finds nothing to do. IDs, geometry versions and creators are untouched.
--
-- Segments that exist only on a device are not on the server, so SQL cannot reach
-- them: the app uploads them through publish_segment on its next sync.
--
-- Run supabase/scripts/segments/01_pre_publish_diagnostics.sql before and
-- 03_post_publish_verification.sql after (docs/community-segments.md).
begin;

with eligible as (
 select s.id from public.mtb_segments s
 join public.mtb_segment_geometry g on g.segment_id=s.id and g.version=s.version
 where s.deleted_at is null
  and s.status in ('draft','submitted','under_review','approved')
  and not (s.status='approved' and s.visibility='public')
  and s.access not in ('restricted','closed_temporary','closed_permanent','sensitive')
  and public.segment_geometry_problem(g.geometry) is null
), published as (
 update public.mtb_segments s set status='approved',visibility='public',updated_at=now()
 from eligible e where s.id=e.id
 returning s.id
)
insert into public.mtb_moderation_events(target_kind,segment_id,action,note,actor_id)
select 'segment',id,'published','published by migration 20261126000100 (no approval required)',null from published;

commit;
