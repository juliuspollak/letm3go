-- Milestone B: moderation workflow, submission, versioning and duplicate inspection.
-- Incremental on top of 20261102000000_mtb_trails_segments.sql (already applied).
-- No existing object is altered destructively; geometry versioning preserves history.
begin;

-- ------------------------------------------------------------------ audit log
-- Every moderation decision, submission and report resolution is recorded so the
-- decision history is auditable and reversible.
create table public.mtb_moderation_events (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null check(target_kind in ('trail','segment','report')),
  trail_id uuid references public.mtb_trails(id) on delete cascade,
  segment_id uuid references public.mtb_segments(id) on delete cascade,
  report_id uuid references public.mtb_reports(id) on delete cascade,
  action text not null check(action in ('submitted','start_review','approved','rejected','changes_requested','retired','hidden','geometry_versioned','report_accepted','report_rejected')),
  note text not null default '' check(length(note) <= 4000),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check((target_kind='trail' and trail_id is not null) or (target_kind='segment' and segment_id is not null) or (target_kind='report' and report_id is not null))
);
alter table public.mtb_moderation_events enable row level security;
revoke all on public.mtb_moderation_events from anon, authenticated;
grant select on public.mtb_moderation_events to authenticated;
grant all on public.mtb_moderation_events to service_role;
create policy moderation_events_read on public.mtb_moderation_events for select to authenticated using (public.is_moderator());

-- ------------------------------------------------------------------ submit
-- A creator moves their own draft (or a returned-for-changes proposal) to submitted.
-- It then becomes read-only until a moderator reviews it.
create or replace function public.submit_mtb(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare target uuid; kind text := lower(p_kind);
begin
  if auth.uid() is null then raise exception 'Sign in to submit.'; end if;
  if kind not in ('trail','segment') then raise exception 'Unknown target.'; end if;
  if kind = 'trail' then
    update public.mtb_trails set status='submitted', updated_at=now()
     where id=p_id and creator_id=auth.uid() and status in ('draft','changes_requested')
     returning id into target;
    if target is null then raise exception 'Only your own draft can be submitted.'; end if;
    insert into public.mtb_moderation_events(target_kind,trail_id,action,actor_id) values('trail',target,'submitted',auth.uid());
  else
    update public.mtb_segments set status='submitted', updated_at=now()
     where id=p_id and creator_id=auth.uid() and status in ('draft','changes_requested')
     returning id into target;
    if target is null then raise exception 'Only your own draft can be submitted.'; end if;
    insert into public.mtb_moderation_events(target_kind,segment_id,action,actor_id) values('segment',target,'submitted',auth.uid());
  end if;
end $$;

-- ------------------------------------------------------------------ moderate
-- Server-enforced moderation. Approval publishes the geometry publicly only when
-- the access classification permits it; a restricted/closed/sensitive trail is
-- approved but stays private so it is never publicly promoted.
create or replace function public.moderate_mtb(p_kind text, p_id uuid, p_action text, p_note text default '') returns void
language plpgsql security definer set search_path='' as $$
declare kind text := lower(p_kind); action text := lower(p_action); target uuid;
begin
  if not public.is_moderator() then raise exception 'Moderator required.'; end if;
  if kind not in ('trail','segment') then raise exception 'Unknown target.'; end if;
  if action not in ('start_review','approved','rejected','changes_requested','retired','hidden') then raise exception 'Unknown moderation action.'; end if;
  if kind = 'trail' then
    if action = 'approved' then
      update public.mtb_trails set status='approved',
        visibility = case when access in ('restricted','closed_temporary','closed_permanent','sensitive') then 'private' else 'public' end,
        moderation_note = coalesce(p_note,''), updated_at=now() where id=p_id returning id into target;
    else
      update public.mtb_trails set status=action, moderation_note=coalesce(p_note,''), updated_at=now() where id=p_id returning id into target;
    end if;
    if target is null then raise exception 'Trail not found.'; end if;
    insert into public.mtb_moderation_events(target_kind,trail_id,action,note,actor_id) values('trail',target,action,coalesce(p_note,''),auth.uid());
  else
    if action = 'approved' then
      update public.mtb_segments set status='approved',
        visibility = case when access in ('restricted','closed_temporary','closed_permanent','sensitive') then 'private' else 'public' end,
        moderation_note = coalesce(p_note,''), updated_at=now() where id=p_id returning id into target;
    else
      update public.mtb_segments set status=action, moderation_note=coalesce(p_note,''), updated_at=now() where id=p_id returning id into target;
    end if;
    if target is null then raise exception 'Segment not found.'; end if;
    insert into public.mtb_moderation_events(target_kind,segment_id,action,note,actor_id) values('segment',target,action,coalesce(p_note,''),auth.uid());
  end if;
end $$;

create or replace function public.moderate_mtb_report(p_id uuid, p_action text, p_note text default '') returns void
language plpgsql security definer set search_path='' as $$
declare action text := lower(p_action); target uuid;
begin
  if not public.is_moderator() then raise exception 'Moderator required.'; end if;
  if action not in ('accepted','rejected') then raise exception 'Unknown report action.'; end if;
  update public.mtb_reports set status=action where id=p_id returning id into target;
  if target is null then raise exception 'Report not found.'; end if;
  insert into public.mtb_moderation_events(target_kind,report_id,action,note,actor_id)
   values('report',target,case when action='accepted' then 'report_accepted' else 'report_rejected' end,coalesce(p_note,''),auth.uid());
end $$;

-- ------------------------------------------------------------------ columns
-- Latest moderation note is shown to the owner (e.g. why changes were requested)
-- without exposing the full moderation audit log to non-moderators.
alter table public.mtb_trails add column moderation_note text not null default '' check(length(moderation_note) <= 4000);
alter table public.mtb_segments add column moderation_note text not null default '' check(length(moderation_note) <= 4000);

-- ------------------------------------------------------------------ my work
-- A creator's own proposals across every status, with distance and the latest note.
create or replace function public.mtb_my_submissions()
returns table(kind text, id uuid, name text, status text, visibility text, access text, difficulty text, direction text, distance_meters double precision, moderation_note text, updated_at timestamptz)
language sql stable security invoker set search_path='' as $$
  select 'trail', t.id, t.name, t.status, t.visibility, t.access, t.difficulty, t.direction, g.distance_meters, t.moderation_note, t.updated_at
  from public.mtb_trails t join public.mtb_trail_geometry g on g.trail_id = t.id and g.version = t.version
  where t.creator_id = auth.uid()
  union all
  select 'segment', s.id, s.name, s.status, s.visibility, s.access, s.difficulty, s.direction, g.distance_meters, s.moderation_note, s.updated_at
  from public.mtb_segments s join public.mtb_segment_geometry g on g.segment_id = s.id and g.version = s.version
  where s.creator_id = auth.uid()
$$;

-- ------------------------------------------------------------------ geometry
-- Replace geometry: a creator edits their own draft in place; a moderator reroute
-- creates a new immutable version so historical attempts stay comparable.
create or replace function public.mtb_set_geometry(p_kind text, p_id uuid, p_geometry jsonb, p_distance_meters double precision default 0, p_note text default '') returns integer
language plpgsql security definer set search_path='' as $$
declare kind text := lower(p_kind); next_v integer; is_owner boolean := false; target uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to edit geometry.'; end if;
  if kind not in ('trail','segment') then raise exception 'Unknown target.'; end if;
  if not public.valid_mtb_geometry(p_geometry) then raise exception 'Invalid geometry.'; end if;
  if kind = 'trail' then
    select (creator_id = auth.uid() and status in ('draft','changes_requested')) into is_owner from public.mtb_trails where id = p_id;
    if not is_owner and not public.is_moderator() then raise exception 'You may not edit this trail.'; end if;
    if is_owner then
      update public.mtb_trail_geometry set geometry = p_geometry, distance_meters = coalesce(p_distance_meters,0) where trail_id = p_id and version = (select version from public.mtb_trails where id = p_id) returning trail_id into target;
      if target is null then raise exception 'Trail geometry not found.'; end if;
      update public.mtb_trails set updated_at = now() where id = p_id;
      return (select version from public.mtb_trails where id = p_id);
    else
      select version + 1 into next_v from public.mtb_trails where id = p_id;
      insert into public.mtb_trail_geometry(trail_id, version, geometry, distance_meters, confidence) values(p_id, next_v, p_geometry, coalesce(p_distance_meters,0), 'verified');
      update public.mtb_trails set version = next_v, updated_at = now() where id = p_id;
      insert into public.mtb_moderation_events(target_kind, trail_id, action, note, actor_id) values('trail', p_id, 'geometry_versioned', coalesce(p_note,''), auth.uid());
      return next_v;
    end if;
  else
    select (creator_id = auth.uid() and status in ('draft','changes_requested')) into is_owner from public.mtb_segments where id = p_id;
    if not is_owner and not public.is_moderator() then raise exception 'You may not edit this segment.'; end if;
    if is_owner then
      update public.mtb_segment_geometry set geometry = p_geometry, distance_meters = coalesce(p_distance_meters,0) where segment_id = p_id and version = (select version from public.mtb_segments where id = p_id) returning segment_id into target;
      if target is null then raise exception 'Segment geometry not found.'; end if;
      update public.mtb_segments set updated_at = now() where id = p_id;
      return (select version from public.mtb_segments where id = p_id);
    else
      select version + 1 into next_v from public.mtb_segments where id = p_id;
      insert into public.mtb_segment_geometry(segment_id, version, geometry, distance_meters, confidence) values(p_id, next_v, p_geometry, coalesce(p_distance_meters,0), 'verified');
      update public.mtb_segments set version = next_v, updated_at = now() where id = p_id;
      insert into public.mtb_moderation_events(target_kind, segment_id, action, note, actor_id) values('segment', p_id, 'geometry_versioned', coalesce(p_note,''), auth.uid());
      return next_v;
    end if;
  end if;
end $$;

-- ------------------------------------------------------------------ duplicates
-- Nearby approved segments whose bounding box overlaps an expanded box around the
-- given segment, used by the moderation queue to inspect duplicates.
create or replace function public.mtb_segments_near(p_segment_id uuid, p_radius_meters double precision default 250)
returns table(id uuid, name text, version integer, distance_meters double precision, updated_at timestamptz)
language sql stable security invoker set search_path='' as $$
  with centre as (
    select (min_lat + max_lat) / 2 as lat, (min_lon + max_lon) / 2 as lon
    from public.mtb_segment_geometry where segment_id = p_segment_id and version = (select version from public.mtb_segments where id = p_segment_id)
  )
  select s.id, s.name, s.version, g.distance_meters, s.updated_at
  from public.mtb_segments s
  join public.mtb_segment_geometry g on g.segment_id = s.id and g.version = s.version
  cross join centre
  where s.id <> p_segment_id
    and s.status = 'approved'
    and g.min_lat <= centre.lat + p_radius_meters / 111320
    and g.max_lat >= centre.lat - p_radius_meters / 111320
    and g.min_lon <= centre.lon + p_radius_meters / (111320 * cos(radians(centre.lat)))
    and g.max_lon >= centre.lon - p_radius_meters / (111320 * cos(radians(centre.lat)))
$$;

-- ------------------------------------------------------------------ queue
-- Submitted/under-review items with their current geometry, for the moderator
-- interface. Runs as definer so the queue is not limited by row visibility, but
-- it still refuses non-moderators.
create or replace function public.mtb_moderation_queue()
returns table(kind text, id uuid, name text, status text, access text, difficulty text, direction text, description text, creator_id uuid, geometry jsonb, distance_meters double precision, updated_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_moderator() then raise exception 'Moderator required.'; end if;
  return query
    select 'trail', t.id, t.name, t.status, t.access, t.difficulty, t.direction, t.description, t.creator_id, g.geometry, g.distance_meters, t.updated_at
    from public.mtb_trails t join public.mtb_trail_geometry g on g.trail_id = t.id and g.version = t.version
    where t.status in ('submitted','under_review')
    union all
    select 'segment', s.id, s.name, s.status, s.access, s.difficulty, s.direction, s.description, s.creator_id, g.geometry, g.distance_meters, s.updated_at
    from public.mtb_segments s join public.mtb_segment_geometry g on g.segment_id = s.id and g.version = s.version
    where s.status in ('submitted','under_review');
end $$;

revoke all on function public.submit_mtb(text,uuid), public.moderate_mtb(text,uuid,text,text), public.moderate_mtb_report(uuid,text,text), public.mtb_my_submissions(), public.mtb_set_geometry(text,uuid,jsonb,double precision,text), public.mtb_segments_near(uuid,double precision), public.mtb_moderation_queue() from public, anon;
grant execute on function public.submit_mtb(text,uuid), public.mtb_my_submissions(), public.mtb_set_geometry(text,uuid,jsonb,double precision,text), public.mtb_segments_near(uuid,double precision) to authenticated;
grant execute on function public.moderate_mtb(text,uuid,text,text), public.moderate_mtb_report(uuid,text,text), public.mtb_moderation_queue() to authenticated;

commit;

