-- Community segments: published without approval, owned and edited by their
-- creator (or an admin), discoverable by every signed-in person, with server-side
-- efforts and segment notifications.
--
-- Builds on 20261102000000_mtb_trails_segments.sql, 20261103000000_mtb_moderation.sql,
-- 20261122000000_mtb_segment_persistence.sql and 20261123000000_notifications_and_pokes.sql.
-- Forward-only and safe to re-run: nothing already applied is edited, no row is
-- deleted, and segment IDs, versions, geometry history and ownership are kept.
--
--   publish_segment     the device's upload: creates, or applies the creator's own
--                       later rename / re-section, never republishes a deleted,
--                       hidden, rejected or retired segment
--   update_segment      creator or admin: rename, metadata, new geometry version
--   delete_segment      creator or admin: soft delete, gone from discovery for good
--   list_segments       the library (All / Nearby / Mine), no geometry
--   segment_detail      one segment with geometry, creator name and effort stats
--   segments_for_map    the map layer for the visible area, capped
--   record_segment_effort  an effort from the athlete's own device: time only, no GPS
--
-- Admin means is_moderator(): an app admin or a listed moderator.
begin;

-- ------------------------------------------------------------------ columns
alter table public.mtb_segments add column if not exists activity text
 check (activity is null or char_length(activity) between 1 and 40);
alter table public.mtb_segments add column if not exists deleted_at timestamptz;
alter table public.mtb_segments add column if not exists deleted_by uuid references auth.users(id) on delete set null;
create index if not exists mtb_segments_live on public.mtb_segments(updated_at desc) where deleted_at is null;
create index if not exists mtb_segments_creator on public.mtb_segments(creator_id) where deleted_at is null;
create index if not exists mtb_segment_geometry_bbox on public.mtb_segment_geometry(min_lat,max_lat,min_lon,max_lon);

-- The audit log learns the ownership actions.
alter table public.mtb_moderation_events drop constraint if exists mtb_moderation_events_action_check;
alter table public.mtb_moderation_events add constraint mtb_moderation_events_action_check check (action in (
 'submitted','start_review','approved','rejected','changes_requested','retired','hidden','geometry_versioned','report_accepted','report_rejected',
 'published','renamed','edited','deleted'));

-- The inbox learns the segment events.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
 'feedback_new','feedback_reply','feedback_status','segment_submitted','poke',
 'segment_completed','segment_pb','segment_record','segment_changed','segment_removed'));

-- ------------------------------------------------------------------ visibility
-- A deleted segment is gone for everyone but admins (who keep the audit trail).
drop policy if exists segments_read on public.mtb_segments;
create policy segments_read on public.mtb_segments for select to authenticated using (
 (deleted_at is null and ((visibility='public' and status='approved') or creator_id=(select auth.uid())))
 or public.is_moderator());
drop policy if exists segment_geometry_read on public.mtb_segment_geometry;
create policy segment_geometry_read on public.mtb_segment_geometry for select to authenticated using (
 exists(select 1 from public.mtb_segments s where s.id=segment_id and (
  (s.deleted_at is null and ((s.visibility='public' and s.status='approved') or s.creator_id=(select auth.uid())))
  or public.is_moderator())));

-- ------------------------------------------------------------------ helpers
create or replace function public.can_edit_segment(p_creator uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (p_creator=auth.uid() or public.is_moderator());
$$;
revoke all on function public.can_edit_segment(uuid) from public,anon;
grant execute on function public.can_edit_segment(uuid) to authenticated;

-- Great-circle metres between two [lat,lon] pairs.
create or replace function public.segment_metres(a jsonb,b jsonb) returns double precision
language sql immutable set search_path='' as $$
 select 2*6371000*asin(sqrt(
  power(sin(radians(((b->>0)::double precision-(a->>0)::double precision)/2)),2)+
  cos(radians((a->>0)::double precision))*cos(radians((b->>0)::double precision))*
  power(sin(radians(((b->>1)::double precision-(a->>1)::double precision)/2)),2)));
$$;

-- A segment route the community can rely on: the general geometry rule, at least
-- five points, 50 m to 100 km long, and no GPS jump longer than 250 m between
-- consecutive points (a gap would otherwise become a straight-line shortcut).
create or replace function public.segment_geometry_problem(p_geometry jsonb) returns text
language plpgsql immutable set search_path='' as $$
declare total double precision:=0; step double precision; i integer; n integer;
begin
 if not public.valid_mtb_geometry(p_geometry) then return 'invalid geometry'; end if;
 n:=jsonb_array_length(p_geometry);
 if n<5 then return 'too few points'; end if;
 for i in 1..n-1 loop
  step:=public.segment_metres(p_geometry->(i-1),p_geometry->i);
  if step>250 then return 'GPS gap'; end if;
  total:=total+step;
 end loop;
 if total<50 then return 'too short'; end if;
 if total>100000 then return 'too long'; end if;
 return null;
end $$;

create or replace function public.segment_length(p_geometry jsonb) returns double precision
language sql immutable set search_path='' as $$
 select coalesce(sum(public.segment_metres(p_geometry->(i-1),p_geometry->i)),0)
 from generate_series(1,greatest(jsonb_array_length(p_geometry)-1,0)) i;
$$;

-- ------------------------------------------------------------------ preferences
-- Segment notifications can be turned off; in-app delivery does not depend on push.
create table if not exists public.notification_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 segment_community boolean not null default true,  -- others completing / beating my segments
 segment_personal boolean not null default true,   -- my personal bests
 updated_at timestamptz not null default now()
);
alter table public.notification_settings enable row level security;
revoke all on public.notification_settings from public,anon,authenticated;
grant select,insert,update on public.notification_settings to authenticated;
grant all on public.notification_settings to service_role;
drop policy if exists notification_settings_own on public.notification_settings;
create policy notification_settings_own on public.notification_settings for all to authenticated
 using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create or replace function public.wants_segment_notification(p_user uuid,p_personal boolean) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select case when p_personal then segment_personal else segment_community end
  from public.notification_settings where user_id=p_user),true);
$$;
revoke all on function public.wants_segment_notification(uuid,boolean) from public,anon,authenticated;

-- ------------------------------------------------------------------ geometry versions
-- One place that writes a new geometry version and points the segment at it.
create or replace function public.version_segment_geometry(p_id uuid,p_geometry jsonb,p_confidence text,p_note text) returns integer
language plpgsql security definer set search_path='' as $$
declare next_v integer;
begin
 select version+1 into next_v from public.mtb_segments where id=p_id for update;
 insert into public.mtb_segment_geometry(segment_id,version,geometry,distance_meters,confidence)
  values(p_id,next_v,p_geometry,public.segment_length(p_geometry),p_confidence);
 update public.mtb_segments set version=next_v,updated_at=now() where id=p_id;
 insert into public.mtb_moderation_events(target_kind,segment_id,action,note,actor_id)
  values('segment',p_id,'geometry_versioned',left(coalesce(p_note,''),4000),auth.uid());
 return next_v;
end $$;
revoke all on function public.version_segment_geometry(uuid,jsonb,text,text) from public,anon,authenticated;

-- ------------------------------------------------------------------ publish
-- The device's upload of a segment selected in one of the creator's activities.
-- Only the selected route is sent: never the activity, its times or metrics.
-- The section ID from the device is the segment ID, so a retry is idempotent and a
-- later rename or re-section on that device becomes an edit of the same segment.
-- `p_rename` / `p_reroute` say whether the device itself changed the name or the
-- section since its last upload: a resend that did not, never undoes a rename or
-- route correction made on the server (by the creator or an admin).
create or replace function public.publish_segment(p_client_id uuid,p_name text,p_geometry jsonb,p_activity text default null,
 p_rename boolean default true,p_reroute boolean default true)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.mtb_segments; current_geometry jsonb; problem text; v_name text:=btrim(coalesce(p_name,''));
begin
 if auth.uid() is null or not public.account_is_active() then raise exception 'Sign in to publish a segment.'; end if;
 if p_client_id is null or char_length(v_name) not between 1 and 150 then raise exception 'Invalid segment proposal'; end if;
 problem:=public.segment_geometry_problem(p_geometry);
 if problem is not null then raise exception 'Invalid segment proposal: %',problem; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_client_id::text,0));
 select * into existing from public.mtb_segments where id=p_client_id for update;
 if found then
  if existing.creator_id is distinct from auth.uid() then raise exception 'Segment ID belongs to another creator'; end if;
  -- Deleted, hidden, rejected or retired stays that way: a retry never republishes.
  if existing.deleted_at is not null or existing.status in ('hidden','rejected','retired') then return p_client_id; end if;
  -- The same statuses the publish migration (20261126000100) publishes; a segment
  -- returned with changes requested stays as it is.
  if existing.status in ('draft','submitted','under_review') and existing.access not in ('restricted','closed_temporary','closed_permanent','sensitive') then
   update public.mtb_segments set status='approved',visibility='public',updated_at=now() where id=p_client_id;
   insert into public.mtb_moderation_events(target_kind,segment_id,action,actor_id) values('segment',p_client_id,'published',auth.uid());
  end if;
  if p_rename and existing.name<>v_name then
   update public.mtb_segments set name=v_name,updated_at=now() where id=p_client_id;
   insert into public.mtb_moderation_events(target_kind,segment_id,action,actor_id) values('segment',p_client_id,'renamed',auth.uid());
  end if;
  if p_activity is not null and existing.activity is distinct from left(p_activity,40) then
   update public.mtb_segments set activity=left(p_activity,40),updated_at=now() where id=p_client_id;
  end if;
  select g.geometry into current_geometry from public.mtb_segment_geometry g where g.segment_id=p_client_id and g.version=existing.version;
  if p_reroute and current_geometry is distinct from p_geometry then perform public.version_segment_geometry(p_client_id,p_geometry,'gps','re-sectioned by creator'); end if;
  return p_client_id;
 end if;
 insert into public.mtb_segments(id,name,description,direction,access,status,visibility,creator_id,version,activity)
  values(p_client_id,v_name,'','both','unknown','approved','public',auth.uid(),1,left(p_activity,40));
 insert into public.mtb_segment_geometry(segment_id,version,geometry,distance_meters,confidence)
  values(p_client_id,1,p_geometry,public.segment_length(p_geometry),'gps');
 insert into public.mtb_moderation_events(target_kind,segment_id,action,actor_id) values('segment',p_client_id,'published',auth.uid());
 return p_client_id;
end $$;
revoke all on function public.publish_segment(uuid,text,jsonb,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.publish_segment(uuid,text,jsonb,text,boolean,boolean) to authenticated;

-- Builds that predate publish_segment keep working: their upload now publishes.
create or replace function public.create_mtb_segment(
 p_client_id uuid,p_name text,p_geometry jsonb,p_description text default '',p_trail_id uuid default null,
 p_direction text default 'both',p_difficulty text default null,p_access text default 'unknown',p_distance_meters double precision default 0
) returns uuid language sql security definer set search_path='' as $$
 select public.publish_segment(p_client_id,p_name,p_geometry,null);
$$;
-- The hand-drawn draft from Community Trails is retired with that screen: segments
-- are created from a recorded activity only.
drop function if exists public.create_mtb_segment(text,jsonb,text,uuid,text,text,text,double precision);

-- ------------------------------------------------------------------ edit
create or replace function public.update_segment(p_id uuid,p_name text default null,p_geometry jsonb default null,
 p_activity text default null,p_description text default null,p_note text default '')
returns integer language plpgsql security definer set search_path='' as $$
declare seg public.mtb_segments; problem text; admin_edit boolean; changed text[]:='{}'; current_geometry jsonb;
begin
 select * into seg from public.mtb_segments where id=p_id for update;
 if not found or not public.can_edit_segment(seg.creator_id) or (seg.deleted_at is not null and not public.is_moderator()) then
  raise exception 'You may not edit this segment.'; end if;
 if seg.deleted_at is not null then raise exception 'This segment was deleted.'; end if;
 admin_edit:=seg.creator_id is distinct from auth.uid();
 if p_name is not null and btrim(p_name)<>seg.name then
  if char_length(btrim(p_name)) not between 1 and 150 then raise exception 'Segment name required.'; end if;
  update public.mtb_segments set name=btrim(p_name),updated_at=now() where id=p_id;
  insert into public.mtb_moderation_events(target_kind,segment_id,action,note,actor_id) values('segment',p_id,'renamed',left(coalesce(p_note,''),4000),auth.uid());
  changed:=array_append(changed,'name');
 end if;
 if p_description is not null and p_description<>seg.description or p_activity is not null and p_activity is distinct from seg.activity then
  update public.mtb_segments set description=left(coalesce(p_description,seg.description),4000),activity=left(coalesce(p_activity,seg.activity),40),updated_at=now() where id=p_id;
  insert into public.mtb_moderation_events(target_kind,segment_id,action,note,actor_id) values('segment',p_id,'edited',left(coalesce(p_note,''),4000),auth.uid());
  changed:=array_append(changed,'details');
 end if;
 if p_geometry is not null then
  problem:=public.segment_geometry_problem(p_geometry);
  if problem is not null then raise exception 'Invalid segment geometry: %',problem; end if;
  select g.geometry into current_geometry from public.mtb_segment_geometry g where g.segment_id=p_id and g.version=seg.version;
  if current_geometry is distinct from p_geometry then
   perform public.version_segment_geometry(p_id,p_geometry,case when admin_edit then 'verified' else 'gps' end,p_note);
   changed:=array_append(changed,'route');
  end if;
 end if;
 if admin_edit and cardinality(changed)>0 then
  perform public.notify('segment-changed:'||p_id||':'||extract(epoch from clock_timestamp())::bigint,seg.creator_id,auth.uid(),'segment_changed',
   'An admin updated your segment',left(seg.name,120)||': '||array_to_string(changed,', ')||' changed',jsonb_build_object('screen','segment','id',p_id));
 end if;
 return (select version from public.mtb_segments where id=p_id);
end $$;
revoke all on function public.update_segment(uuid,text,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.update_segment(uuid,text,jsonb,text,text,text) to authenticated;

create or replace function public.delete_segment(p_id uuid,p_note text default '') returns void
language plpgsql security definer set search_path='' as $$
declare seg public.mtb_segments;
begin
 select * into seg from public.mtb_segments where id=p_id for update;
 if not found or not public.can_edit_segment(seg.creator_id) then raise exception 'You may not delete this segment.'; end if;
 if seg.deleted_at is not null then return; end if;
 -- Soft delete: the ID stays taken, so a device retry can never bring it back, and
 -- the geometry history and efforts are kept for the audit trail.
 update public.mtb_segments set deleted_at=now(),deleted_by=auth.uid(),status='retired',updated_at=now() where id=p_id;
 insert into public.mtb_moderation_events(target_kind,segment_id,action,note,actor_id) values('segment',p_id,'deleted',left(coalesce(p_note,''),4000),auth.uid());
 if seg.creator_id is distinct from auth.uid() then
  perform public.notify('segment-removed:'||p_id,seg.creator_id,auth.uid(),'segment_removed','An admin removed your segment',
   left(seg.name,160),jsonb_build_object('screen','segment','id',p_id));
 end if;
end $$;
revoke all on function public.delete_segment(uuid,text) from public,anon,authenticated;
grant execute on function public.delete_segment(uuid,text) to authenticated;

-- ------------------------------------------------------------------ efforts
-- Only what a leaderboard needs: who, which segment version, how long and when it
-- started. No route, no activity ID: an effort never exposes a recording.
create table if not exists public.segment_efforts (
 id uuid primary key default gen_random_uuid(),
 -- The device's idempotency key for one pass (activity, segment, start), hashed
 -- on the device so it carries no identifiable detail.
 client_key text not null unique check (char_length(client_key) between 16 and 100),
 segment_id uuid not null references public.mtb_segments(id) on delete cascade,
 segment_version integer not null check (segment_version>=1),
 athlete_id uuid not null references auth.users(id) on delete cascade,
 elapsed_seconds double precision not null check (elapsed_seconds>0 and elapsed_seconds<=86400),
 started_at timestamptz not null,
 matcher_version integer not null default 1,
 created_at timestamptz not null default now()
);
create index if not exists segment_efforts_board on public.segment_efforts(segment_id,elapsed_seconds);
create index if not exists segment_efforts_athlete on public.segment_efforts(athlete_id,segment_id);
alter table public.segment_efforts enable row level security;
revoke all on public.segment_efforts from public,anon,authenticated;
grant select on public.segment_efforts to authenticated;
grant all on public.segment_efforts to service_role;
drop policy if exists segment_efforts_own on public.segment_efforts;
create policy segment_efforts_own on public.segment_efforts for select to authenticated using (athlete_id=(select auth.uid()));

create or replace function public.record_segment_effort(p_client_key text,p_segment_id uuid,p_elapsed_seconds double precision,
 p_started_at timestamptz,p_matcher_version integer default 1) returns uuid
language plpgsql security definer set search_path='' as $$
declare seg public.mtb_segments; v_length double precision; new_id uuid; my_best double precision; others_best double precision;
 me uuid:=auth.uid(); day text; done_today integer;
begin
 if me is null or not public.account_is_active() then raise exception 'Sign in to record an effort.'; end if;
 if p_client_key is null or char_length(p_client_key) not between 16 and 100 then raise exception 'Invalid effort'; end if;
 select * into seg from public.mtb_segments where id=p_segment_id;
 if not found or seg.deleted_at is not null or not ((seg.visibility='public' and seg.status='approved') or seg.creator_id=me) then
  raise exception 'Segment unavailable'; end if;
 if p_started_at is null or p_started_at>now()+interval '10 minutes' or p_started_at<now()-interval '2 years' then raise exception 'Invalid effort'; end if;
 select g.distance_meters into v_length from public.mtb_segment_geometry g where g.segment_id=seg.id and g.version=seg.version;
 -- A time no human can ride (over 40 m/s) or a pass slower than 0.1 m/s is refused.
 if p_elapsed_seconds is null or p_elapsed_seconds<=0 or p_elapsed_seconds>86400
  or (v_length>0 and (v_length/p_elapsed_seconds>40 or v_length/p_elapsed_seconds<0.1)) then raise exception 'Invalid effort'; end if;
 perform pg_advisory_xact_lock(hashtextextended('segment-effort:'||p_segment_id,0));
 -- Times compare only on the same route: a trimmed or replaced route (a new
 -- geometry version) starts its own board; earlier efforts stay as history.
 select min(elapsed_seconds) into my_best from public.segment_efforts where segment_id=seg.id and segment_version=seg.version and athlete_id=me;
 select min(elapsed_seconds) into others_best from public.segment_efforts where segment_id=seg.id and segment_version=seg.version and athlete_id<>me;
 insert into public.segment_efforts(client_key,segment_id,segment_version,athlete_id,elapsed_seconds,started_at,matcher_version)
  values(p_client_key,seg.id,seg.version,me,p_elapsed_seconds,p_started_at,coalesce(p_matcher_version,1))
  on conflict (client_key) do nothing returning id into new_id;
 -- A retry: the effort exists and every notification for it was already written.
 if new_id is null then
  select id into new_id from public.segment_efforts where client_key=p_client_key and athlete_id=me;
  if new_id is null then raise exception 'Invalid effort'; end if;
  return new_id;
 end if;
 -- Someone else completed my segment: one notification per segment per day, its
 -- text kept current, so a busy segment never floods the creator.
 if seg.creator_id is not null and seg.creator_id<>me and public.wants_segment_notification(seg.creator_id,false) then
  day:=to_char(now() at time zone 'utc','YYYY-MM-DD');
  select count(distinct athlete_id) into done_today from public.segment_efforts
   where segment_id=seg.id and athlete_id<>seg.creator_id and created_at>=date_trunc('day',now() at time zone 'utc') at time zone 'utc';
  insert into public.notifications(event_key,recipient_id,actor_id,kind,title,body,route)
   values('segment-done:'||seg.id||':'||day,seg.creator_id,me,'segment_completed','Your segment was completed',
    left(left(seg.name,120)||': '||public.display_name_of(me)||' completed it',180),jsonb_build_object('screen','segment','id',seg.id))
   on conflict (event_key) do update set body=left(left(seg.name,120)||': '||done_today||' people completed it today',180);
 end if;
 if my_best is not null and p_elapsed_seconds<my_best and public.wants_segment_notification(me,true) then
  perform public.notify('segment-pb:'||new_id,me,null,'segment_pb','New personal best',
   left(seg.name,120)||': '||to_char(make_interval(secs=>round(p_elapsed_seconds)),'HH24:MI:SS'),jsonb_build_object('screen','segment','id',seg.id));
 end if;
 -- A new record on my segment, set by someone else: faster than every earlier
 -- effort by anyone (the first effort ever is a completion, not a record).
 if seg.creator_id is not null and seg.creator_id<>me and (my_best is not null or others_best is not null)
  and p_elapsed_seconds<least(coalesce(my_best,'infinity'),coalesce(others_best,'infinity'))
  and public.wants_segment_notification(seg.creator_id,false) then
  perform public.notify('segment-record:'||new_id,seg.creator_id,me,'segment_record','New record on your segment',
   left(seg.name,120)||': '||public.display_name_of(me)||' set '||to_char(make_interval(secs=>round(p_elapsed_seconds)),'HH24:MI:SS'),
   jsonb_build_object('screen','segment','id',seg.id));
 end if;
 return new_id;
end $$;
revoke all on function public.record_segment_effort(text,uuid,double precision,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.record_segment_effort(text,uuid,double precision,timestamptz,integer) to authenticated;

-- ------------------------------------------------------------------ discovery
-- The library: no geometry, so a list of many segments stays small. `mine` lists
-- my own segments in every status (so a hidden one is explained, not missing).
create or replace function public.list_segments(p_scope text default 'all',p_query text default null,p_activity text default null,
 p_min_lat double precision default null,p_max_lat double precision default null,p_min_lon double precision default null,p_max_lon double precision default null,
 p_limit integer default 50,p_offset integer default 0)
returns table(id uuid,name text,activity text,distance_meters double precision,creator_name text,mine boolean,can_edit boolean,status text,visibility text,
 start_point jsonb,updated_at timestamptz,efforts bigint)
language plpgsql stable security definer set search_path='' as $$
declare me uuid:=auth.uid(); scope text:=lower(coalesce(p_scope,'all'));
begin
 if me is null or not public.account_is_active() then raise exception 'Sign in to see segments.'; end if;
 if scope not in ('all','mine','nearby') then raise exception 'Unknown scope'; end if;
 if scope='nearby' and (p_min_lat is null or p_max_lat is null or p_min_lon is null or p_max_lon is null) then raise exception 'Nearby needs an area'; end if;
 return query
 select s.id,s.name,s.activity,g.distance_meters,public.display_name_of(s.creator_id),s.creator_id=me,public.can_edit_segment(s.creator_id),
  s.status,s.visibility,g.geometry->0,s.updated_at,(select count(*) from public.segment_efforts e where e.segment_id=s.id and e.segment_version=s.version)
 from public.mtb_segments s join public.mtb_segment_geometry g on g.segment_id=s.id and g.version=s.version
 where s.deleted_at is null
  and (case when scope='mine' then s.creator_id=me else s.visibility='public' and s.status='approved' end)
  and (p_query is null or btrim(p_query)='' or s.name ilike '%'||replace(replace(btrim(p_query),'%','\%'),'_','\_')||'%')
  and (p_activity is null or p_activity='' or s.activity=p_activity)
  and (scope<>'nearby' or (g.min_lat<=p_max_lat and g.max_lat>=p_min_lat and g.min_lon<=p_max_lon and g.max_lon>=p_min_lon))
 order by case when scope='nearby' then abs((g.min_lat+g.max_lat)/2-(p_min_lat+p_max_lat)/2)+abs((g.min_lon+g.max_lon)/2-(p_min_lon+p_max_lon)/2) end nulls last,
  s.updated_at desc,s.id
 limit least(greatest(coalesce(p_limit,50),1),100) offset greatest(coalesce(p_offset,0),0);
end $$;
revoke all on function public.list_segments(text,text,text,double precision,double precision,double precision,double precision,integer,integer) from public,anon;
grant execute on function public.list_segments(text,text,text,double precision,double precision,double precision,double precision,integer,integer) to authenticated;

create or replace function public.segment_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid:=auth.uid(); seg public.mtb_segments; g public.mtb_segment_geometry;
begin
 if me is null or not public.account_is_active() then raise exception 'Sign in to see segments.'; end if;
 select * into seg from public.mtb_segments where id=p_id;
 if not found or not ((seg.deleted_at is null and ((seg.visibility='public' and seg.status='approved') or seg.creator_id=me)) or public.is_moderator()) then
  return null; end if;
 select * into g from public.mtb_segment_geometry where segment_id=seg.id and version=seg.version;
 return jsonb_build_object('id',seg.id,'name',seg.name,'activity',seg.activity,'description',seg.description,'status',seg.status,'visibility',seg.visibility,
  'deleted',seg.deleted_at is not null,'version',seg.version,'geometry',g.geometry,'distance_meters',g.distance_meters,'created_at',seg.created_at,'updated_at',seg.updated_at,
  'creator_name',public.display_name_of(seg.creator_id),'mine',seg.creator_id=me,'can_edit',public.can_edit_segment(seg.creator_id),
  'stats',(select jsonb_build_object('efforts',count(*),'athletes',count(distinct athlete_id),'best_seconds',min(elapsed_seconds),
    'my_efforts',count(*) filter (where athlete_id=me),'my_best_seconds',min(elapsed_seconds) filter (where athlete_id=me),
    'my_last_at',max(started_at) filter (where athlete_id=me))
   from public.segment_efforts where segment_id=seg.id and segment_version=seg.version));
end $$;
revoke all on function public.segment_detail(uuid) from public,anon;
grant execute on function public.segment_detail(uuid) to authenticated;

-- The Map's Segments layer for the visible area (60, what the native map draws),
-- and effort matching around a ride (up to 200): current geometry, capped so a
-- wide view never downloads every segment in the world.
create or replace function public.segments_for_map(p_min_lat double precision,p_max_lat double precision,p_min_lon double precision,p_max_lon double precision,p_limit integer default 60)
returns table(id uuid,name text,activity text,geometry jsonb,distance_meters double precision,version integer)
language sql stable security invoker set search_path='' as $$
 select s.id,s.name,s.activity,g.geometry,g.distance_meters,s.version
 from public.mtb_segments s join public.mtb_segment_geometry g on g.segment_id=s.id and g.version=s.version
 where s.deleted_at is null and s.visibility='public' and s.status='approved'
  and g.min_lat<=p_max_lat and g.max_lat>=p_min_lat and g.min_lon<=p_max_lon and g.max_lon>=p_min_lon
  and p_max_lat-p_min_lat<=5 and p_max_lon-p_min_lon<=5
 order by g.distance_meters desc,s.id
 limit least(greatest(coalesce(p_limit,60),1),200);
$$;
revoke all on function public.segments_for_map(double precision,double precision,double precision,double precision,integer) from public,anon;
grant execute on function public.segments_for_map(double precision,double precision,double precision,double precision,integer) to authenticated;

-- ------------------------------------------------------------------ inbox
-- The profile's notification list marks exactly what was opened.
create or replace function public.mark_notifications_read_ids(p_ids bigint[]) returns integer
language sql security definer set search_path='' as $$
 with done as (update public.notifications set read_at=now() where recipient_id=auth.uid() and read_at is null and id=any(p_ids) returning 1)
 select count(*)::integer from done;
$$;
revoke all on function public.mark_notifications_read_ids(bigint[]) from public,anon;
grant execute on function public.mark_notifications_read_ids(bigint[]) to authenticated;

commit;
