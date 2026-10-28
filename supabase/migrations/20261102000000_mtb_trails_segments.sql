-- MTB trail network foundation: community trails, timed segments, versioned
-- geometry, community reports and a server-enforced moderation role.
--
-- Milestone A. A trail is the physical path; a segment is a timed section with its
-- own immutable identity, direction and versioned geometry. Access classification
-- is separate from geometry accuracy: an approved geometry never implies legal
-- permission to ride.
--
-- Geometry is a JSON array of [lat, lon] pairs (matching the app's route format).
-- No PostGIS is required: each geometry row keeps a bounding box (maintained by a
-- trigger) so nearby-trail lookups are an indexed box overlap, and the client
-- simplifies the polyline for display.
begin;

-- ---------------------------------------------------------------- moderators
-- Only service_role may grant moderation. Ordinary users can never approve their
-- own submissions or self-promote through client-side state.
create table public.moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.moderators enable row level security;
revoke all on public.moderators from anon, authenticated;
grant select on public.moderators to authenticated;
grant all on public.moderators to service_role;
create policy moderators_self_read on public.moderators for select to authenticated
  using(user_id = (select auth.uid()));
create function public.is_moderator() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.moderators where user_id = auth.uid());
$$;
revoke all on function public.is_moderator() from public, anon;
grant execute on function public.is_moderator() to authenticated;

-- ------------------------------------------------------------------ geometry
-- Each element is a [lat, lon] pair. Between 2 and 50000 points; lat/lon bounded.
create function public.valid_mtb_geometry(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select jsonb_typeof(p_value)='array'
  and jsonb_array_length(p_value) between 2 and 50000
  and not exists(
   select 1 from jsonb_array_elements(p_value) as entry
   where jsonb_typeof(entry)<>'array'
    or jsonb_array_length(entry)<>2
    or jsonb_typeof(entry->0) not in ('number','integer')
    or jsonb_typeof(entry->1) not in ('number','integer')
    or (entry->>0)::double precision not between -90 and 90
    or (entry->>1)::double precision not between -180 and 180
  )
$$;
revoke all on function public.valid_mtb_geometry(jsonb) from public, anon;
grant execute on function public.valid_mtb_geometry(jsonb) to authenticated, service_role;

-- -------------------------------------------------------------------- trails
create table public.mtb_trails (
  id uuid primary key default gen_random_uuid(),
  source text not null check(source in ('osm','community','gpx','manual')),
  name text not null check(length(trim(name)) between 1 and 150),
  description text not null default '' check(length(description) <= 4000),
  surface text,
  difficulty text check(difficulty in ('green','blue','black','double_black','unknown')),
  access text not null default 'unknown' check(access in ('sanctioned','unsanctioned','restricted','closed_temporary','closed_permanent','sensitive','unknown')),
  direction text not null default 'both' check(direction in ('uphill','downhill','both')),
  status text not null default 'draft' check(status in ('draft','submitted','under_review','changes_requested','approved','rejected','retired','hidden')),
  visibility text not null default 'private' check(visibility in ('public','private')),
  creator_id uuid references auth.users(id) on delete set null,
  version integer not null default 1 check(version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.mtb_trail_geometry (
  trail_id uuid not null references public.mtb_trails(id) on delete cascade,
  version integer not null default 1 check(version >= 1),
  geometry jsonb not null check(public.valid_mtb_geometry(geometry)),
  distance_meters double precision not null default 0 check(distance_meters >= 0),
  elevation_gain double precision check(elevation_gain >= 0),
  elevation_loss double precision check(elevation_loss >= 0),
  confidence text not null default 'manual' check(confidence in ('manual','gps','verified')),
  source_activity_id uuid references public.activities(id) on delete set null,
  min_lat double precision, max_lat double precision, min_lon double precision, max_lon double precision,
  created_at timestamptz not null default now(),
  primary key (trail_id, version)
);

-- ------------------------------------------------------------------ segments
create table public.mtb_segments (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(trim(name)) between 1 and 150),
  description text not null default '' check(length(description) <= 4000),
  trail_id uuid references public.mtb_trails(id) on delete set null,
  direction text not null default 'both' check(direction in ('uphill','downhill','both')),
  difficulty text check(difficulty in ('green','blue','black','double_black','unknown')),
  access text not null default 'unknown' check(access in ('sanctioned','unsanctioned','restricted','closed_temporary','closed_permanent','sensitive','unknown')),
  status text not null default 'draft' check(status in ('draft','submitted','under_review','changes_requested','approved','rejected','retired','hidden')),
  visibility text not null default 'private' check(visibility in ('public','private')),
  creator_id uuid references auth.users(id) on delete set null,
  version integer not null default 1 check(version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.mtb_segment_geometry (
  segment_id uuid not null references public.mtb_segments(id) on delete cascade,
  version integer not null default 1 check(version >= 1),
  geometry jsonb not null check(public.valid_mtb_geometry(geometry)),
  distance_meters double precision not null default 0 check(distance_meters >= 0),
  elevation_gain double precision check(elevation_gain >= 0),
  elevation_loss double precision check(elevation_loss >= 0),
  confidence text not null default 'manual' check(confidence in ('manual','gps','verified')),
  source_activity_id uuid references public.activities(id) on delete set null,
  min_lat double precision, max_lat double precision, min_lon double precision, max_lon double precision,
  created_at timestamptz not null default now(),
  primary key (segment_id, version)
);

-- ------------------------------------------------------------------ reports
create table public.mtb_reports (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null check(target_kind in ('trail','segment')),
  trail_id uuid references public.mtb_trails(id) on delete cascade,
  segment_id uuid references public.mtb_segments(id) on delete cascade,
  kind text not null check(kind in ('incorrect_geometry','duplicate','closed','name_correction','start_end_correction','reroute','access_restriction')),
  note text not null default '' check(length(note) <= 4000),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'open' check(status in ('open','accepted','rejected')),
  created_at timestamptz not null default now(),
  check((target_kind='trail' and trail_id is not null and segment_id is null) or (target_kind='segment' and segment_id is not null and trail_id is null))
);

-- ------------------------------------------------- bbox maintenance trigger
create function public.mtb_geometry_bbox() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  select min((entry->>0)::double precision), max((entry->>0)::double precision),
         min((entry->>1)::double precision), max((entry->>1)::double precision)
    into new.min_lat, new.max_lat, new.min_lon, new.max_lon
  from jsonb_array_elements(new.geometry) as elem(entry);
  return new;
end $$;
revoke all on function public.mtb_geometry_bbox() from public, anon;
create trigger mtb_trail_geometry_bbox before insert or update on public.mtb_trail_geometry
  for each row execute function public.mtb_geometry_bbox();
create trigger mtb_segment_geometry_bbox before insert or update on public.mtb_segment_geometry
  for each row execute function public.mtb_geometry_bbox();

create index mtb_trail_geometry_bbox_idx on public.mtb_trail_geometry (min_lat, max_lat, min_lon, max_lon);
create index mtb_segment_geometry_bbox_idx on public.mtb_segment_geometry (min_lat, max_lat, min_lon, max_lon);

-- ------------------------------------------------------------------ RLS
alter table public.mtb_trails enable row level security;
alter table public.mtb_trail_geometry enable row level security;
alter table public.mtb_segments enable row level security;
alter table public.mtb_segment_geometry enable row level security;
alter table public.mtb_reports enable row level security;
revoke all on public.mtb_trails, public.mtb_trail_geometry, public.mtb_segments, public.mtb_segment_geometry, public.mtb_reports from anon, authenticated;
grant select on public.mtb_trails, public.mtb_segments to authenticated;
grant select on public.mtb_trail_geometry, public.mtb_segment_geometry to authenticated;
grant select, insert on public.mtb_reports to authenticated;
grant all on public.mtb_trails, public.mtb_trail_geometry, public.mtb_segments, public.mtb_segment_geometry, public.mtb_reports to service_role;

-- Approved public geometry is world-readable; owners and moderators also read their
-- own or hidden rows. Direct insert/update is intentionally NOT granted: all writes
-- go through security-definer RPCs so the draft lifecycle is server-enforced.
create policy trails_read on public.mtb_trails for select to authenticated using (
  (visibility = 'public' and status = 'approved')
  or creator_id = (select auth.uid())
  or public.is_moderator()
);
create policy segments_read on public.mtb_segments for select to authenticated using (
  (visibility = 'public' and status = 'approved')
  or creator_id = (select auth.uid())
  or public.is_moderator()
);
create policy trail_geometry_read on public.mtb_trail_geometry for select to authenticated using (
  exists(select 1 from public.mtb_trails t where t.id = trail_id and
    ((t.visibility='public' and t.status='approved') or t.creator_id=(select auth.uid()) or public.is_moderator()))
);
create policy segment_geometry_read on public.mtb_segment_geometry for select to authenticated using (
  exists(select 1 from public.mtb_segments s where s.id = segment_id and
    ((s.visibility='public' and s.status='approved') or s.creator_id=(select auth.uid()) or public.is_moderator()))
);
create policy reports_read on public.mtb_reports for select to authenticated using (
  reporter_id = (select auth.uid()) or public.is_moderator()
);
create policy reports_insert on public.mtb_reports for insert to authenticated
  with check(reporter_id = (select auth.uid()));

-- ------------------------------------------------------------------ RPCs
-- A rider creates a private draft (trail + its first geometry version) in one step.
create or replace function public.create_mtb_trail(
  p_name text, p_geometry jsonb, p_description text default '', p_surface text default null,
  p_difficulty text default null, p_access text default 'unknown',
  p_source text default 'manual', p_direction text default 'both',
  p_distance_meters double precision default 0
) returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to create a trail.'; end if;
  if length(trim(p_name)) not between 1 and 150 then raise exception 'Trail name required.'; end if;
  if not public.valid_mtb_geometry(p_geometry) then raise exception 'Invalid trail geometry.'; end if;
  if p_source = 'osm' then raise exception 'OSM trails are imported by administrators only.'; end if;
  insert into public.mtb_trails(source,name,description,surface,difficulty,access,direction,status,visibility,creator_id,version)
   values(p_source,trim(p_name),coalesce(p_description,''),nullif(p_surface,''),nullif(p_difficulty,''),p_access,p_direction,'draft','private',auth.uid(),1)
   returning id into new_id;
  insert into public.mtb_trail_geometry(trail_id,version,geometry,distance_meters,confidence)
   values(new_id,1,p_geometry,coalesce(p_distance_meters,0),'manual');
  return new_id;
end $$;

create or replace function public.create_mtb_segment(
  p_name text, p_geometry jsonb, p_description text default '', p_trail_id uuid default null,
  p_direction text default 'both', p_difficulty text default null,
  p_access text default 'unknown', p_distance_meters double precision default 0
) returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to create a segment.'; end if;
  if length(trim(p_name)) not between 1 and 150 then raise exception 'Segment name required.'; end if;
  if not public.valid_mtb_geometry(p_geometry) then raise exception 'Invalid segment geometry.'; end if;
  if p_trail_id is not null and not exists(select 1 from public.mtb_trails where id = p_trail_id) then raise exception 'Unknown trail.'; end if;
  insert into public.mtb_segments(name,description,trail_id,direction,difficulty,access,status,visibility,creator_id,version)
   values(trim(p_name),coalesce(p_description,''),p_trail_id,p_direction,nullif(p_difficulty,''),p_access,'draft','private',auth.uid(),1)
   returning id into new_id;
  insert into public.mtb_segment_geometry(segment_id,version,geometry,distance_meters,confidence)
   values(new_id,1,p_geometry,coalesce(p_distance_meters,0),'manual');
  return new_id;
end $$;
revoke all on function public.create_mtb_trail(text,jsonb,text,text,text,text,text,text,double precision), public.create_mtb_segment(text,jsonb,text,uuid,text,text,text,double precision) from public, anon;
grant execute on function public.create_mtb_trail(text,jsonb,text,text,text,text,text,text,double precision), public.create_mtb_segment(text,jsonb,text,uuid,text,text,text,double precision) to authenticated;

-- Nearby approved public trails/segments within a bounding box, with their current
-- geometry version. Runs as the caller, so RLS hides drafts and sensitive rows.
create or replace function public.mtb_trails_in_bbox(p_min_lat double precision, p_max_lat double precision, p_min_lon double precision, p_max_lon double precision)
returns table(id uuid, name text, source text, surface text, difficulty text, access text, direction text, status text, visibility text, creator_id uuid, version integer, geometry jsonb, distance_meters double precision, elevation_gain double precision, elevation_loss double precision, confidence text, updated_at timestamptz)
language sql stable security invoker set search_path='' as $$
  select t.id, t.name, t.source, t.surface, t.difficulty, t.access, t.direction, t.status, t.visibility, t.creator_id, t.version, g.geometry, g.distance_meters, g.elevation_gain, g.elevation_loss, g.confidence, t.updated_at
  from public.mtb_trails t
  join public.mtb_trail_geometry g on g.trail_id = t.id and g.version = t.version
  where g.min_lat <= p_max_lat and g.max_lat >= p_min_lat and g.min_lon <= p_max_lon and g.max_lon >= p_min_lon
$$;

create or replace function public.mtb_segments_in_bbox(p_min_lat double precision, p_max_lat double precision, p_min_lon double precision, p_max_lon double precision)
returns table(id uuid, name text, trail_id uuid, direction text, difficulty text, access text, status text, visibility text, creator_id uuid, version integer, geometry jsonb, distance_meters double precision, elevation_gain double precision, elevation_loss double precision, confidence text, updated_at timestamptz)
language sql stable security invoker set search_path='' as $$
  select s.id, s.name, s.trail_id, s.direction, s.difficulty, s.access, s.status, s.visibility, s.creator_id, s.version, g.geometry, g.distance_meters, g.elevation_gain, g.elevation_loss, g.confidence, s.updated_at
  from public.mtb_segments s
  join public.mtb_segment_geometry g on g.segment_id = s.id and g.version = s.version
  where g.min_lat <= p_max_lat and g.max_lat >= p_min_lat and g.min_lon <= p_max_lon and g.max_lon >= p_min_lon
$$;
revoke all on function public.mtb_trails_in_bbox(double precision,double precision,double precision,double precision), public.mtb_segments_in_bbox(double precision,double precision,double precision,double precision) from public, anon;
grant execute on function public.mtb_trails_in_bbox(double precision,double precision,double precision,double precision), public.mtb_segments_in_bbox(double precision,double precision,double precision,double precision) to authenticated;

commit;
