-- Person day map: one person's day of movement for household members and friends.
--
-- Completed activities: nothing new is stored. A day is composed from the
-- redacted snapshots people already share (Home and Work masked, access
-- rechecked on every read by can_view_social_journey), so hiding or unsharing an
-- activity removes its geometry from every viewer in the same transaction.
-- Private audiences additionally get a per-point time `t` (epoch seconds) so the
-- timeline can place the person; public links never do.
--
-- Live activity: one bounded trail per person, written with the same device
-- credentials as live location (household or friend), read only while the viewer
-- may see that person's live location. Friends never see points near Home/Work.
-- The trail is deleted when the activity finishes, is hidden, or sharing stops.
--
-- Household auto-sharing: members' new activities are shared with the household
-- by default, from the moment they joined (or turned it back on). Any manual
-- share/unshare is remembered so auto-sharing never overrides the owner.
--
-- Additive and safe to re-run. Nothing is deleted or rewritten.
begin;

-- ------------------------------------------------- activities kept private live
-- An activity marked private while it is still being recorded. Keyed by the
-- recorder's id (compared case-insensitively with the saved activity's id) so it
-- applies before the activity exists in the cloud: it stops the live trail, blocks
-- every later batch for that activity, and keeps the finished activity out of
-- automatic household sharing.
create table if not exists public.private_activity_refs (
 owner_id uuid not null references auth.users(id) on delete cascade,
 ref text not null check(length(ref) between 1 and 64),
 created_at timestamptz not null default now(),
 primary key(owner_id,ref)
);
alter table public.private_activity_refs enable row level security;
revoke all on public.private_activity_refs from anon,authenticated;
grant all on public.private_activity_refs to service_role;
create or replace function public.activity_ref_is_private(p_owner uuid,p_ref text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.private_activity_refs r where r.owner_id=p_owner and upper(r.ref)=upper(p_ref))
$$;
revoke all on function public.activity_ref_is_private(uuid,text) from public,anon,authenticated;

-- ---------------------------------------------------------------- auto-share
create table if not exists public.activity_auto_share (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default true,
 since timestamptz not null default now()
);
alter table public.activity_auto_share enable row level security;
revoke all on public.activity_auto_share from anon,authenticated;
grant all on public.activity_auto_share to service_role;

create table if not exists public.activity_share_decisions (
 activity_id uuid primary key references public.activities(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 decided_at timestamptz not null default now(),
 private boolean not null default false
);
alter table public.activity_share_decisions add column if not exists private boolean not null default false;
alter table public.activity_share_decisions enable row level security;
revoke all on public.activity_share_decisions from anon,authenticated;
grant all on public.activity_share_decisions to service_role;

-- Joining a household switches automatic sharing on from now; earlier activities
-- are never swept in.
create or replace function public.start_auto_share_on_join() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.activity_auto_share(user_id,enabled,since) values(new.user_id,true,now())
 on conflict(user_id) do update set enabled=true,since=now();
 return new;
end $$;
drop trigger if exists start_auto_share_on_join on public.household_memberships;
create trigger start_auto_share_on_join after insert on public.household_memberships
for each row execute function public.start_auto_share_on_join();

-- What counts as the owner's decision about an activity: choosing to keep it private
-- (keep_activity_private), or sharing it by hand (remember_manual_share, called by the journeys
-- function for a non-automatic publication). A share that the SYSTEM removes (an edit, Home or
-- Work moving) is not a decision, so an automatically shared activity is shared again after it.
create or replace function public.remember_manual_share(p_owner uuid,p_activity uuid) returns void
language sql security definer set search_path='' as $$
 insert into public.activity_share_decisions(activity_id,owner_id)
  select a.id,a.owner_id from public.activities a where a.id=p_activity and a.owner_id=p_owner
 on conflict(activity_id) do nothing
$$;
revoke all on function public.remember_manual_share(uuid,uuid) from public,anon,authenticated;
grant execute on function public.remember_manual_share(uuid,uuid) to service_role;

create or replace function public.keep_activity_private(p_activity uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 -- Any copy already published (for example by automatic sharing a moment earlier) goes
 -- first, which also clears who it was shared with; the decision is recorded after, so
 -- the removal cannot overwrite it.
 -- Serialise with a publication of the same activity (commit_shared_journey locks this row too).
 perform 1 from public.activities a where a.id=p_activity and a.owner_id=auth.uid() for update;
 delete from public.shared_journeys where activity_id=p_activity and owner_id=auth.uid();
 insert into public.private_activity_refs(owner_id,ref) select a.owner_id,a.id::text from public.activities a where a.id=p_activity and a.owner_id=auth.uid() on conflict do nothing;
 insert into public.activity_share_decisions(activity_id,owner_id,private)
  select a.id,a.owner_id,true from public.activities a where a.id=p_activity and a.owner_id=auth.uid()
 on conflict(activity_id) do update set private=true;
end $$;

-- The journeys function asks this before an AUTOMATIC publication, so one that was
-- already under way when the owner made the activity private cannot publish it.
create or replace function public.auto_share_allowed(p_owner uuid,p_activity uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.activity_share_decisions d where d.activity_id=p_activity and d.owner_id=p_owner and d.private)
  and not public.activity_ref_is_private(p_owner,p_activity::text)
$$;
revoke all on function public.auto_share_allowed(uuid,uuid) from public,anon,authenticated;
grant execute on function public.auto_share_allowed(uuid,uuid) to service_role;
revoke all on function public.keep_activity_private(uuid) from public,anon,authenticated;
grant execute on function public.keep_activity_private(uuid) to authenticated;

create or replace function public.my_auto_share() returns jsonb
language sql stable security definer set search_path='' as $$
 select case when auth.uid() is null then null else jsonb_build_object(
  'enabled',coalesce((select a.enabled from public.activity_auto_share a where a.user_id=auth.uid()),false)
   and exists(select 1 from public.household_memberships m where m.user_id=auth.uid()),
  'since',(select a.since from public.activity_auto_share a where a.user_id=auth.uid())) end
$$;
create or replace function public.set_auto_share(p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 -- Turning it back on starts from now: what was recorded while it was off stays private.
 insert into public.activity_auto_share(user_id,enabled,since) values(auth.uid(),p_enabled,now())
 on conflict(user_id) do update set enabled=excluded.enabled,
  since=case when excluded.enabled and not public.activity_auto_share.enabled then now() else public.activity_auto_share.since end;
end $$;
-- Finished activities waiting to be shared with the household: recorded since
-- sharing began, never decided by the owner, not yet shared.
create or replace function public.my_auto_share_pending(p_limit integer default 10,p_exclude uuid[] default '{}')
returns table(activity_id uuid,revision integer)
language sql stable security definer set search_path='' as $$
 select a.id,a.revision from public.activities a
 join public.activity_auto_share s on s.user_id=a.owner_id and s.enabled
 where auth.uid() is not null and a.owner_id=auth.uid()
  and exists(select 1 from public.household_memberships m where m.user_id=a.owner_id)
  and a.ended_at is not null and a.started_at>=s.since
  and not (a.id=any(coalesce(p_exclude,'{}')))
  and not public.activity_ref_is_private(a.owner_id,a.id::text)
  and not exists(select 1 from public.activity_share_decisions d where d.activity_id=a.id)
  and not exists(select 1 from public.shared_journeys j where j.activity_id=a.id)
 order by a.started_at desc limit least(greatest(coalesce(p_limit,10),1),25)
$$;
revoke all on function public.my_auto_share(),public.set_auto_share(boolean),public.my_auto_share_pending(integer,uuid[]) from public,anon,authenticated;
grant execute on function public.my_auto_share(),public.set_auto_share(boolean),public.my_auto_share_pending(integer,uuid[]) to authenticated;


-- ----------------------------------------------------- road estimates (shared)
-- Estimated roads are computed once, on the owner's phone, and read from there:
-- viewers never reconstruct. A road is shown to someone else only when no point
-- of it lies within the masked area around the owner's Home or Work.
create or replace function public.decode_polyline(p_line text)
returns table(latitude double precision,longitude double precision)
language plpgsql immutable set search_path='' as $$
declare i integer:=1; n integer:=coalesce(length(p_line),0); lat integer:=0; lon integer:=0; shift integer; result integer; b integer;
begin
 while i<=n loop
  shift:=0;result:=0;
  loop b:=ascii(substr(p_line,i,1))-63;i:=i+1;result:=result|((b&31)<<shift);shift:=shift+5;exit when b<32 or i>n or shift>30;end loop;
  lat:=lat+case when (result&1)=1 then ~(result>>1) else (result>>1) end;
  shift:=0;result:=0;
  loop b:=ascii(substr(p_line,i,1))-63;i:=i+1;result:=result|((b&31)<<shift);shift:=shift+5;exit when b<32 or i>n or shift>30;end loop;
  lon:=lon+case when (result&1)=1 then ~(result>>1) else (result>>1) end;
  latitude:=lat/1e5;longitude:=lon/1e5;return next;
 end loop;
end $$;
-- A well-formed encoded polyline: only the polyline alphabet, and it ends on a character
-- that closes a value (not in the middle of one).
create or replace function public.valid_polyline(p_line text) returns boolean
language sql immutable set search_path='' as $$
 select p_line is not null and length(p_line) between 4 and 20000 and p_line ~ '^[?-~]+$' and p_line ~ '[?-^]$'
$$;

-- Does the straight stretch between two points pass within the masked distance
-- (radius + 300 m) of the owner's Home or Work, even with no point inside it?
create or replace function public.segment_near_private_place(p_owner uuid,p_alat double precision,p_alon double precision,p_blat double precision,p_blon double precision)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.saved_places sp,
   lateral (select cos(radians(sp.latitude)) as c) k,
   lateral (select (p_alon-sp.longitude)*111320*k.c as ax,(p_alat-sp.latitude)*111320 as ay,
                   (p_blon-sp.longitude)*111320*k.c as bx,(p_blat-sp.latitude)*111320 as by) q,
   lateral (select least(1,greatest(0,case when (q.bx-q.ax)^2+(q.by-q.ay)^2=0 then 0
              else -(q.ax*(q.bx-q.ax)+q.ay*(q.by-q.ay))/((q.bx-q.ax)^2+(q.by-q.ay)^2) end)) as t) u
  where sp.owner_id=p_owner and sp.kind in ('home','work')
   and sqrt((q.ax+u.t*(q.bx-q.ax))^2+(q.ay+u.t*(q.by-q.ay))^2)<=sp.radius+300)
$$;
revoke all on function public.segment_near_private_place(uuid,double precision,double precision,double precision,double precision) from public,anon,authenticated;

-- A stored road is clear only if no stretch of it (not just no vertex) passes the masked
-- distance of Home/Work: roads are simplified, so long straight stretches have few vertices.
create or replace function public.road_clear_of_private_places(p_owner uuid,p_line text) returns boolean
language sql stable security definer set search_path='' as $$
 -- No Home/Work saved: nothing to mask, nothing to decode.
 select public.valid_polyline(p_line) and (not exists(select 1 from public.saved_places sp0 where sp0.owner_id=p_owner and sp0.kind in ('home','work')) or not exists(
  select 1 from (select d.latitude,d.longitude,lag(d.latitude) over (order by d.n) as plat,lag(d.longitude) over (order by d.n) as plon
                 from public.decode_polyline(p_line) with ordinality as d(latitude,longitude,n)) v
  where public.segment_near_private_place(p_owner,coalesce(v.plat,v.latitude),coalesce(v.plon,v.longitude),v.latitude,v.longitude)))
$$;
revoke all on function public.decode_polyline(text),public.valid_polyline(text),public.road_clear_of_private_places(uuid,text) from public,anon,authenticated;

-- Route points for the owner's own day: at most about 1500 per activity, with the first and
-- last fix and both ends of every GPS segment kept, in {latitude, longitude, segment, t} form.
create or replace function public.thin_route_points(p jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('latitude',z.x->'latitude','longitude',z.x->'longitude','segment',coalesce(z.x->'segment','0'::jsonb),
   't',round((z.x->>'timestamp')::float8)) order by z.ord),'[]'::jsonb)
 from (select e.x,e.ord,jsonb_array_length(p) as n,
        lag(e.x->>'segment') over (order by e.ord) as ps,lead(e.x->>'segment') over (order by e.ord) as ns
       from jsonb_array_elements(p) with ordinality e(x,ord) where jsonb_typeof(e.x->'timestamp')='number') z
 where z.ord=1 or z.ord=z.n or z.ord % greatest(1,ceil(z.n/1500.0)::int)=0
  or z.ps is distinct from (z.x->>'segment') or z.ns is distinct from (z.x->>'segment')
$$;
revoke all on function public.thin_route_points(jsonb) from public,anon,authenticated;

-- ------------------------------------------------------------- completed day
-- Who may open this person's map: themselves, a household member, or a friend.
-- Access to each activity is still decided by can_view_social_journey.
create or replace function public.my_shared_day(p_owner uuid,p_from timestamptz,p_to timestamptz,p_known text[] default '{}')
returns table(activity_id uuid,started_at timestamptz,ended_at timestamptz,activity text,title text,etag text,points jsonb,roads jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or p_owner is null or p_from is null or p_to is null or p_to<=p_from
  or p_to-p_from>interval '3 days' then return; end if;
 if auth.uid()=p_owner then
  -- My own day: every activity I have, private or not, in the same shape. Points
  -- are thinned to at most ~1500 per activity (segment breaks and times kept).
  return query
   with mine as (
    select a.id,a.started_at,a.ended_at,a.activity,a.title,a.revision,
     a.route_points as raw,
     coalesce((select jsonb_object_agg(r.ref,r.record->>'line') from public.journey_road_metadata r
      where r.owner_id=a.owner_id and r.record->>'status'='route' and upper(split_part(r.ref,':',1))=upper(a.id::text)),'{}'::jsonb) as road_lines
    from public.activities a
    where a.owner_id=p_owner and a.started_at<p_to and coalesce(a.ended_at,a.started_at)>p_from
    order by a.started_at limit 100),
   tagged as (select m.*,md5(m.revision::text||m.road_lines::text) as tag from mine m)
   select t.id,t.started_at,t.ended_at,t.activity,t.title,t.tag,
    -- thinned only when the viewer does not already hold this version
    case when t.tag=any(coalesce(p_known,'{}')) then null else public.thin_route_points(t.raw) end,
    case when t.tag=any(coalesce(p_known,'{}')) then null else t.road_lines end
   from tagged t order by t.started_at;
  return;
 end if;
 return query
  with visible as (
   select j.activity_id,a.started_at,a.ended_at,j.snapshot,
    coalesce((select jsonb_object_agg(r.ref,r.record->>'line') from public.journey_road_metadata r
     left join public.road_privacy rp on rp.owner_id=r.owner_id and rp.ref=r.ref
     where r.owner_id=p_owner and r.record->>'status'='route' and upper(split_part(r.ref,':',1))=upper(j.activity_id::text)
      and coalesce(rp.clear,public.road_clear_of_private_places(p_owner,r.record->>'line'))),'{}'::jsonb) as road_lines
   from public.shared_journeys j join public.activities a on a.id=j.activity_id
   where j.owner_id=p_owner and a.started_at<p_to and coalesce(a.ended_at,a.started_at)>p_from
    and public.can_view_social_journey(j.activity_id)
   order by a.started_at limit 100),
  tagged as (select v.*,md5(v.snapshot::text||v.road_lines::text) as tag from visible v)
  -- The tag covers the roads as well as the route, so a road found or withdrawn
  -- later changes it and reaches viewers who already hold the activity.
  select t.activity_id,t.started_at,t.ended_at,t.snapshot->>'activity',t.snapshot->>'title',t.tag,
   case when t.tag=any(coalesce(p_known,'{}')) then null else coalesce(t.snapshot->'points','[]'::jsonb) end,
   case when t.tag=any(coalesce(p_known,'{}')) then null else t.road_lines end
  from tagged t order by t.started_at;
end $$;
revoke all on function public.my_shared_day(uuid,timestamptz,timestamptz,text[]) from public,anon,authenticated;
grant execute on function public.my_shared_day(uuid,timestamptz,timestamptz,text[]) to authenticated;

-- ---------------------------------------------------------------- live trail
create table if not exists public.live_trails (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 activity_ref text not null check(length(activity_ref) between 1 and 64),
 started_at timestamptz not null default now(),
 last_seq integer not null default 0,
 points jsonb not null default '[]'::jsonb,
 roads jsonb not null default '{}'::jsonb,
 ended_at jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
alter table public.live_trails add column if not exists ended_at jsonb not null default '{}'::jsonb;
alter table public.live_trails add column if not exists roads jsonb not null default '{}'::jsonb;
alter table public.live_trails enable row level security;
revoke all on public.live_trails from anon,authenticated;
grant all on public.live_trails to service_role;


-- Thins the older half of a trail until it fits. Times are kept as recorded. Points on
-- either side of a Home/Work-masked stretch, and the masked points themselves, are never
-- dropped, so the cut a friend sees there is the same before and after thinning.
create or replace function public.compact_trail(p_owner uuid,p_points jsonb,p_limit integer) returns jsonb
language plpgsql stable set search_path='' as $$
declare v_pts jsonb:=p_points; v_n integer; v_old jsonb; v_new jsonb; v_guard integer:=0;
begin
 loop
  v_n:=jsonb_array_length(v_pts);
  exit when v_n<=p_limit or v_guard>=6;
  v_guard:=v_guard+1;
  select coalesce(jsonb_agg(e.x order by e.ord),'[]'::jsonb) into v_old from (
   select x,ord,
    lag(x->>3) over (order by ord) as prev_seg,lead(x->>3) over (order by ord) as next_seg,
    h,coalesce(lag(h) over (order by ord),false) as prev_h,coalesce(lead(h) over (order by ord),false) as next_h
   from (select t.x,t.ord,exists(select 1 from public.saved_places sp where sp.owner_id=p_owner and sp.kind in ('home','work')
      and sqrt(power(((t.x->>0)::float8-sp.latitude)*111320,2)+power(((t.x->>1)::float8-sp.longitude)*111320*cos(radians(sp.latitude)),2))<=sp.radius+300) as h
     from jsonb_array_elements(v_pts) with ordinality t(x,ord) where t.ord<=v_n/2) z) e
   where e.ord % 2=1 or e.prev_seg is distinct from (e.x->>3) or e.next_seg is distinct from (e.x->>3) or e.h or e.prev_h or e.next_h;
  select coalesce(jsonb_agg(x order by ord),'[]'::jsonb) into v_new from jsonb_array_elements(v_pts) with ordinality t(x,ord) where ord>v_n/2;
  v_pts:=v_old||v_new;
 end loop;
 -- Still too long (a very long drive): drop the oldest rather than exceed the bound.
 if jsonb_array_length(v_pts)>p_limit then
  select jsonb_agg(x order by ord) into v_pts from jsonb_array_elements(v_pts) with ordinality t(x,ord) where ord>jsonb_array_length(v_pts)-p_limit;
 end if;
 return v_pts;
end $$;
revoke all on function public.compact_trail(uuid,jsonb,integer) from public,anon,authenticated;

-- Appends [lat, lon, t, segment] points. Idempotent and order-free: a repeated or
-- late batch merges by time `t`, and only the newest 3000 points are kept.
create or replace function public.append_live_trail(p_token text,p_ref text,p_seq integer,p_points jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_hash bytea; v_old public.live_trails; v_merged jsonb; v_el jsonb; v_had boolean; v_endt float8;
begin
 if p_token is null or length(p_token)<>64 or p_ref is null or length(p_ref) not between 1 and 64 then return false; end if;
 if p_points is null or jsonb_typeof(p_points)<>'array' or jsonb_array_length(p_points)>200 then raise exception 'Invalid trail'; end if;
 for v_el in select * from jsonb_array_elements(p_points) loop
  if jsonb_typeof(v_el)<>'array' or jsonb_array_length(v_el)<>4
   or jsonb_typeof(v_el->0)<>'number' or jsonb_typeof(v_el->1)<>'number' or jsonb_typeof(v_el->2)<>'number' or jsonb_typeof(v_el->3)<>'number'
   or (v_el->>0)::float8 not between -90 and 90 or (v_el->>1)::float8 not between -180 and 180
   or (v_el->>2)::float8 not between 946684800 and extract(epoch from now()+interval '5 minutes')
  then raise exception 'Invalid trail'; end if;
 end loop;
 v_hash:=sha256(convert_to(p_token,'UTF8'));
 select l.user_id into v_user from public.household_live_locations l
  where l.publish_token_hash=v_hash and l.publish_token_expires_at>now() and l.enabled
   and exists(select 1 from public.household_memberships m where m.user_id=l.user_id);
 if v_user is null then
  select s.user_id into v_user from public.friend_presence_shares s
   where s.publish_token_hash=v_hash and s.publish_token_expires_at>now() and s.enabled;
 end if;
 if v_user is null then return false; end if;
 -- p_seq = -2: the owner made this activity private. Recorded for good (it also keeps
 -- the finished activity out of automatic sharing), the trail is cleared, and no later
 -- batch for it is accepted, however late it arrives.
 if p_seq=-2 then
  insert into public.private_activity_refs(owner_id,ref) values(v_user,p_ref) on conflict do nothing;
  update public.live_trails set points='[]'::jsonb,roads='{}'::jsonb,updated_at=now() where owner_id=v_user and upper(activity_ref)=upper(p_ref);
  return true;
 end if;
 -- p_seq = -1: the phone says this activity is over (finished, or momentarily stopped: it
 -- may resume). The trail is cleared now, and the time it ended is remembered (the last few
 -- activities), so a late or retried batch of points from before that moment cannot bring it
 -- back as a ghost, while a resumed activity's newer points are accepted as normal.
 if p_seq is not null and p_seq<0 then
  insert into public.live_trails(owner_id,activity_ref,points,ended_at,updated_at)
   values(v_user,p_ref,'[]'::jsonb,jsonb_build_object(p_ref,extract(epoch from now())),now())
  on conflict(owner_id) do update set
   points=case when public.live_trails.activity_ref=excluded.activity_ref then '[]'::jsonb else public.live_trails.points end,
   ended_at=(select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) from (
     select e.key as k,e.value as v from jsonb_each(public.live_trails.ended_at||jsonb_build_object(p_ref,extract(epoch from now()))) e
     order by (e.value#>>'{}')::float8 desc limit 8) z),
   updated_at=now();
  return true;
 end if;
 if public.activity_ref_is_private(v_user,p_ref) then return false; end if;
 select * into v_old from public.live_trails where owner_id=v_user for update;
 v_had:=found;
 if v_had then
  select (e.value#>>'{}')::float8 into v_endt from jsonb_each(v_old.ended_at) e where upper(e.key)=upper(p_ref);
  if v_endt is not null then
   select coalesce(jsonb_agg(x),'[]'::jsonb) into p_points from jsonb_array_elements(p_points) x where (x->>2)::float8>v_endt;
   if jsonb_array_length(p_points)=0 then return true; end if;   -- all older than the stop: accepted, nothing kept
  end if;
 end if;
 if not v_had or v_old.activity_ref<>p_ref then
  v_merged:='[]'::jsonb;
 else v_merged:=v_old.points; end if;
 select coalesce(jsonb_agg(e.p order by e.t),'[]'::jsonb) into v_merged from (
  select distinct on (t) p,t from (
   select x as p,(x->>2)::float8 as t from jsonb_array_elements(v_merged) x
   union all select x,(x->>2)::float8 from jsonb_array_elements(p_points) x) u
  order by t desc limit 6000) e;
 -- Bounded, not truncated: past 3000 points the OLDER half is thinned (every second
 -- point, keeping both ends of each GPS segment), so a long drive keeps its whole
 -- timeline at lower resolution at the start and full resolution for what is recent.
 v_merged:=public.compact_trail(v_user,v_merged,3000);
 insert into public.live_trails(owner_id,activity_ref,started_at,last_seq,points,updated_at)
 values(v_user,p_ref,now(),coalesce(p_seq,0),v_merged,now())
 on conflict(owner_id) do update set activity_ref=excluded.activity_ref,
  started_at=case when public.live_trails.activity_ref=excluded.activity_ref then public.live_trails.started_at else now() end,
  last_seq=greatest(case when public.live_trails.activity_ref=excluded.activity_ref then public.live_trails.last_seq else 0 end,excluded.last_seq),
  points=excluded.points,roads=case when public.live_trails.activity_ref=excluded.activity_ref then public.live_trails.roads else '{}'::jsonb end,updated_at=now();
 return true;
end $$;
revoke all on function public.append_live_trail(text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.append_live_trail(text,text,integer,jsonb) to anon,authenticated;


-- The owner's app rebuilt a GPS gap as a road (JavaScript asking Apple Maps, so only while the
-- app is open). Stored once so no viewer repeats it; at most 40 per trail, each bounded and
-- validated. Only the owner's own current trail can receive a road.
create or replace function public.put_my_live_road(p_ref text,p_gap text,p_line text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_ref is null or p_gap is null or length(p_gap) not between 1 and 120
  or not public.valid_polyline(p_line) then return false; end if;
 update public.live_trails set roads=roads||jsonb_build_object(p_gap,jsonb_build_object('l',p_line,'c',public.road_clear_of_private_places(auth.uid(),p_line))),updated_at=now()
  where owner_id=auth.uid() and activity_ref=p_ref and not public.activity_ref_is_private(owner_id,p_ref)
   and (roads ? p_gap or (select count(*) from jsonb_object_keys(roads))<40);
 return found;
end $$;
revoke all on function public.put_my_live_road(text,text,text) from public,anon,authenticated;
grant execute on function public.put_my_live_road(text,text,text) to authenticated;

-- The owner finished, discarded or hid the activity: its live trail is gone.
create or replace function public.end_live_trail(p_ref text default null,p_hide boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if p_hide and p_ref is not null then
  -- Same effect as the phone's own request (p_seq = -2): private for good, cleared now.
  insert into public.private_activity_refs(owner_id,ref) values(auth.uid(),p_ref) on conflict do nothing;
  update public.live_trails set points='[]'::jsonb,roads='{}'::jsonb,updated_at=now() where owner_id=auth.uid() and upper(activity_ref)=upper(p_ref);
 elsif p_ref is null or exists(select 1 from public.live_trails t where t.owner_id=auth.uid() and t.activity_ref=p_ref) then
  update public.live_trails set points='[]'::jsonb,roads='{}'::jsonb,
   ended_at=case when p_ref is null then ended_at else (select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) from (
     select e.key as k,e.value as v from jsonb_each(ended_at||jsonb_build_object(p_ref,extract(epoch from now()))) e order by (e.value#>>'{}')::float8 desc limit 8) z) end,
   updated_at=now()
   where owner_id=auth.uid() and (p_ref is null or activity_ref=p_ref);
 end if;
end $$;
revoke all on function public.end_live_trail(text,boolean) from public,anon,authenticated;
grant execute on function public.end_live_trail(text,boolean) to authenticated;

-- Turning live sharing off (or leaving the household, which turns it off) clears the
-- trail only when no way of seeing it remains: someone sharing with both the household and
-- friends who turns one off keeps the other audience's trail.
create or replace function public.clear_live_trail_on_stop() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_other boolean;
begin
 if not new.enabled then
  if tg_table_name='household_live_locations' then
   v_other:=exists(select 1 from public.friend_presence_shares f where f.user_id=new.user_id and f.enabled);
  else
   v_other:=exists(select 1 from public.household_live_locations h where h.user_id=new.user_id and h.enabled
    and exists(select 1 from public.household_memberships m where m.user_id=new.user_id));
  end if;
  if not v_other then
   update public.live_trails set points='[]'::jsonb,roads='{}'::jsonb,updated_at=now() where owner_id=new.user_id;
  end if;
 end if;
 return new;
end $$;
drop trigger if exists clear_live_trail_on_stop on public.household_live_locations;
create trigger clear_live_trail_on_stop after update of enabled on public.household_live_locations
for each row execute function public.clear_live_trail_on_stop();
drop trigger if exists clear_live_trail_on_stop on public.friend_presence_shares;
create trigger clear_live_trail_on_stop after update of enabled on public.friend_presence_shares
for each row execute function public.clear_live_trail_on_stop();

-- What a viewer may see of someone's live trail. p_after returns only newer points.
-- point_count and newest_t describe the whole trail, so a viewer can tell when it was
-- cleared. For anyone but the owner and the household, points near Home/Work are left
-- out AND the line is cut there (the segment changes), so no line is drawn across the
-- hidden area.
create or replace function public.my_live_trail(p_owner uuid,p_after double precision default 0)
returns table(activity_ref text,started_at timestamptz,updated_at timestamptz,points jsonb,roads jsonb,point_count integer,newest_t double precision)
language plpgsql stable security definer set search_path='' as $$
declare v_household boolean; v_friend boolean; v_self boolean; v_t public.live_trails; v_open boolean;
begin
 if auth.uid() is null or p_owner is null then return; end if;
 v_self:=auth.uid()=p_owner;
 v_household:=exists(select 1 from public.household_memberships me join public.household_memberships o on o.household_id=me.household_id
   where me.user_id=auth.uid() and o.user_id=p_owner and me.user_id<>o.user_id)
  and exists(select 1 from public.household_live_locations l where l.user_id=p_owner and l.enabled);
 v_friend:=exists(select 1 from public.my_friends() f where f.user_id=p_owner)
  and exists(select 1 from public.friend_presence_shares s where s.user_id=p_owner and s.enabled);
 if not (v_self or v_household or v_friend) then return; end if;
 v_open:=v_self or v_household;
 select * into v_t from public.live_trails t where t.owner_id=p_owner and t.updated_at>now()-interval '10 minutes';
 if not found then return; end if;
 -- The common poll finds nothing new: answer without evaluating the mask for every point.
 if jsonb_array_length(v_t.points)>0 and coalesce(p_after,0)>=(v_t.points->-1->>2)::float8 then
  return query select v_t.activity_ref,v_t.started_at,v_t.updated_at,'[]'::jsonb,
   coalesce((select jsonb_object_agg(e.k,e.val->>'l') from jsonb_each(v_t.roads) e(k,val) where v_open or coalesce((e.val->>'c')::boolean,false)),'{}'::jsonb),
   jsonb_array_length(v_t.points),case when v_open then (v_t.points->-1->>2)::float8 end;
  return;
 end if;
 return query
  with pts as (
   select x,(x->>2)::float8 as t,(x->>3)::numeric as seg,
    (not v_open) and exists(select 1 from public.saved_places sp
     where sp.owner_id=p_owner and sp.kind in ('home','work')
      and sqrt(power(((x->>0)::float8-sp.latitude)*111320,2)+power(((x->>1)::float8-sp.longitude)*111320*cos(radians(sp.latitude)),2))<=sp.radius+300) as hidden
   from jsonb_array_elements(v_t.points) x),
  -- A visible point whose stretch from the previous fix passes the masked distance also
  -- starts a new run, even though no point lies inside it (sparse fixes at speed).
  linked as (select pts.*,lag(x) over (order by t) as px,lag(hidden) over (order by t) as ph from pts),
  marked as (select l.*,(not l.hidden) and l.px is not null and not coalesce(l.ph,false) and (not v_open)
     and public.segment_near_private_place(p_owner,(l.px->>0)::float8,(l.px->>1)::float8,(l.x->>0)::float8,(l.x->>1)::float8) as crossing from linked l),
  counted as (select m.*,count(*) filter (where m.hidden or m.crossing) over (order by m.t rows between unbounded preceding and current row) as hid from marked m)
  select v_t.activity_ref,v_t.started_at,v_t.updated_at,
   coalesce((select jsonb_agg(jsonb_build_array(c.x->0,c.x->1,c.x->2,c.seg*100000+c.hid) order by c.t) from counted c
    where not c.hidden and c.t>coalesce(p_after,0)),'[]'::jsonb),
   coalesce((select jsonb_object_agg(e.k,e.val->>'l') from jsonb_each(v_t.roads) e(k,val)
    where v_open or coalesce((e.val->>'c')::boolean,false)),'{}'::jsonb),
   jsonb_array_length(v_t.points),
   case when v_open then (select max(t) from pts) end;
end $$;
revoke all on function public.my_live_trail(uuid,double precision) from public,anon,authenticated;
grant execute on function public.my_live_trail(uuid,double precision) to authenticated;


-- ------------------------------------------------- indexes for the new reads
-- Roads are looked up by the activity they belong to (the first part of the reference,
-- compared without regard to case); shared activities by owner.
create index if not exists journey_road_metadata_activity_idx on public.journey_road_metadata(owner_id,(upper(split_part(ref,':',1))));
create index if not exists shared_journeys_owner_idx on public.shared_journeys(owner_id);
create index if not exists private_activity_refs_upper_idx on public.private_activity_refs(owner_id,(upper(ref)));

-- ------------------------------------------- telling open maps that access changed
-- Same mechanism as the household map (20261108000000): an EMPTY broadcast on a private
-- Realtime channel says "something about who may see what changed", and the app then
-- re-reads through the access-checked functions. No geometry ever travels over Realtime.
-- Each person has their own channel, 'user:<id>', which only they may join. Sent when a
-- share is removed, when someone is dropped from a share, and when a friendship or
-- household membership ends. Best effort by design: a failed or missed broadcast never
-- fails the change that caused it, and the app's periodic revalidation recovers it.
create or replace function public.signal_user_shares(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_user is null or to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then return; end if;
 begin
  perform realtime.send('{}'::jsonb,'share','user:'||p_user,true);
 exception when others then null;
 end;
end $$;
revoke all on function public.signal_user_shares(uuid) from public,anon,authenticated;

create or replace function public.signal_share_removed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- Runs before the delete, while the recipients still exist.
 perform public.signal_user_shares(old.owner_id);
 perform public.signal_user_shares(r.user_id) from public.social_journey_recipients r where r.activity_id=old.activity_id;
 return old;
end $$;
revoke all on function public.signal_share_removed() from public,anon,authenticated;
drop trigger if exists signal_share_removed on public.shared_journeys;
create trigger signal_share_removed before delete on public.shared_journeys
for each row execute function public.signal_share_removed();

create or replace function public.signal_recipient_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform public.signal_user_shares(coalesce(old.user_id,new.user_id));
 return null;
end $$;
revoke all on function public.signal_recipient_changed() from public,anon,authenticated;
drop trigger if exists signal_recipient_changed on public.social_journey_recipients;
create trigger signal_recipient_changed after insert or delete on public.social_journey_recipients
for each row execute function public.signal_recipient_changed();

create or replace function public.signal_friendship_ended() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform public.signal_user_shares(old.user_low);
 perform public.signal_user_shares(old.user_high);
 return null;
end $$;
revoke all on function public.signal_friendship_ended() from public,anon,authenticated;
drop trigger if exists signal_friendship_ended on public.friend_connections;
create trigger signal_friendship_ended after delete on public.friend_connections
for each row execute function public.signal_friendship_ended();

create or replace function public.signal_membership_ended() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform public.signal_user_shares(old.user_id);
 perform public.signal_user_shares(m.user_id) from public.household_memberships m where m.household_id=old.household_id;
 return null;
end $$;
revoke all on function public.signal_membership_ended() from public,anon,authenticated;
drop trigger if exists signal_membership_ended on public.household_memberships;
create trigger signal_membership_ended after delete on public.household_memberships
for each row execute function public.signal_membership_ended();

-- A person may join only their own channel. Skipped where Realtime is absent.
do $$
begin
 if to_regclass('realtime.messages') is not null then
  drop policy if exists user_share_signals on realtime.messages;
  create policy user_share_signals on realtime.messages for select to authenticated
   using (extension='broadcast' and (select realtime.topic())='user:'||(select auth.uid())::text);
 end if;
end $$;


-- ------------------------------------- road privacy decided once, not on every read
-- Whether a stored road passes the masked distance of Home/Work used to be decoded on
-- every request by a non-owner (measured locally: ~2.9 s for a day of 30 activities x 3
-- roads, even when nothing had changed). It is now decided when the road is written, when
-- the activity is shared and when the owner's Home/Work change, and readers use the flag.
-- The flag lives in its own table, NOT on journey_road_metadata: that table's changes are
-- journalled for the owner's sync (20261121000000), and re-deciding flags must never make
-- the app think the owner's roads changed. A road with no flag (or an unknown one) is
-- decoded on read, so a missed refresh can only make a read slower, never reveal a road.
create table if not exists public.road_privacy (
 owner_id uuid not null references auth.users(id) on delete cascade,
 ref text not null,
 clear boolean,
 primary key(owner_id,ref)
);
alter table public.road_privacy enable row level security;
revoke all on public.road_privacy from anon,authenticated;
grant all on public.road_privacy to service_role;

create or replace function public.road_privacy_on_write() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  delete from public.road_privacy where owner_id=old.owner_id and ref=old.ref;
  return null;
 end if;
 insert into public.road_privacy(owner_id,ref,clear)
  values(new.owner_id,new.ref,case when new.record->>'status'='route' then public.road_clear_of_private_places(new.owner_id,new.record->>'line') end)
 on conflict(owner_id,ref) do update set clear=excluded.clear;
 return null;
end $$;
revoke all on function public.road_privacy_on_write() from public,anon,authenticated;
drop trigger if exists road_privacy_on_write on public.journey_road_metadata;
create trigger road_privacy_on_write after insert or update of record or delete on public.journey_road_metadata
for each row execute function public.road_privacy_on_write();

-- Decides the unknown or missing flags of an owner's roads (all, or those of one activity).
create or replace function public.refresh_road_privacy(p_owner uuid,p_activity uuid default null) returns void
language sql security definer set search_path='' as $$
 insert into public.road_privacy(owner_id,ref,clear)
  select r.owner_id,r.ref,public.road_clear_of_private_places(r.owner_id,r.record->>'line')
  from public.journey_road_metadata r
  left join public.road_privacy p on p.owner_id=r.owner_id and p.ref=r.ref
  where r.owner_id=p_owner and r.record->>'status'='route' and p.clear is null
   and (p_activity is null or upper(split_part(r.ref,':',1))=upper(p_activity::text))
 on conflict(owner_id,ref) do update set clear=excluded.clear
$$;
revoke all on function public.refresh_road_privacy(uuid,uuid) from public,anon,authenticated;

-- Home or Work changed.
create or replace function public.road_privacy_places_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=coalesce(new.owner_id,old.owner_id);
begin
 if coalesce(new.kind,old.kind) not in ('home','work') then return null; end if;
 if tg_op='UPDATE' and new.kind=old.kind and new.latitude=old.latitude and new.longitude=old.longitude and new.radius=old.radius then return null; end if;
 -- Every flag becomes unknown (a cheap update that is not journalled). They are decided again when an
 -- activity is shared (road_privacy_on_share); until then a read decodes the road itself.
 update public.road_privacy set clear=null where owner_id=v_owner and clear is not null;
 -- Roads on a live trail in progress are checked against the new places straight away.
 update public.live_trails t set roads=(select coalesce(jsonb_object_agg(e.key,jsonb_build_object('l',e.value->>'l','c',public.road_clear_of_private_places(v_owner,e.value->>'l'))),'{}'::jsonb) from jsonb_each(t.roads) e) where t.owner_id=v_owner and t.roads<>'{}'::jsonb;
 return null;
end $$;
revoke all on function public.road_privacy_places_changed() from public,anon,authenticated;
drop trigger if exists road_privacy_places_changed on public.saved_places;
create trigger road_privacy_places_changed after insert or update or delete on public.saved_places
for each row execute function public.road_privacy_places_changed();

create or replace function public.road_privacy_on_share() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform public.refresh_road_privacy(new.owner_id,new.activity_id);
 return null;
end $$;
revoke all on function public.road_privacy_on_share() from public,anon,authenticated;
drop trigger if exists road_privacy_on_share on public.shared_journeys;
create trigger road_privacy_on_share after insert on public.shared_journeys
for each row execute function public.road_privacy_on_share();

commit;
