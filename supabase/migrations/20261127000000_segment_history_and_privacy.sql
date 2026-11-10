-- Segment efforts: participation privacy and matching older rides against newer
-- segments. Builds on 20261126000000_community_segments.sql (already applied);
-- nothing applied there is edited. Forward-only and safe to re-run.
--
-- Participation (Account & settings → Segment efforts), per person:
--   anonymous  (default) efforts count in totals and best times; the person is
--              never named ("Someone completed your segment")
--   public     the person's display name may appear in the segment creator's
--              notifications
--   off        no efforts are stored; delete_my_segment_efforts removes earlier ones
-- Nobody else can ever read an effort row (RLS: own rows only), its start time or
-- which activity it came from; segment_detail shows others only aggregates.
--
-- segment_catalogue_since: the public segments that appeared or changed after a
-- cursor, oldest first, in small pages. Devices use it to match rides they already
-- recorded against segments published later, without editing those rides.
begin;

alter table public.notification_settings add column if not exists segment_participation text not null default 'anonymous';
alter table public.notification_settings drop constraint if exists notification_settings_segment_participation_check;
alter table public.notification_settings add constraint notification_settings_segment_participation_check
 check (segment_participation in ('public','anonymous','off'));

-- Recording, changing participation and removing efforts share a per-athlete
-- lock. An in-flight recording cannot reappear after opt-out and removal finish.
create or replace function public.lock_segment_participation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('segment-athlete:'||new.user_id,0));
 return new;
end $$;
revoke all on function public.lock_segment_participation() from public,anon,authenticated;
drop trigger if exists lock_segment_participation on public.notification_settings;
create trigger lock_segment_participation before insert or update on public.notification_settings
 for each row execute function public.lock_segment_participation();

create or replace function public.segment_participation_of(p_user uuid) returns text
language sql stable security definer set search_path='' as $$
 select coalesce((select segment_participation from public.notification_settings where user_id=p_user),'anonymous');
$$;
revoke all on function public.segment_participation_of(uuid) from public,anon,authenticated;

create or replace function public.segment_athlete_name(p_user uuid) returns text
language sql stable security definer set search_path='' as $$
 select case when public.segment_participation_of(p_user)='public' then public.display_name_of(p_user) else 'Someone' end;
$$;
revoke all on function public.segment_athlete_name(uuid) from public,anon,authenticated;

create or replace function public.record_segment_effort(p_client_key text,p_segment_id uuid,p_elapsed_seconds double precision,
 p_started_at timestamptz,p_matcher_version integer default 1) returns uuid
language plpgsql security definer set search_path='' as $$
declare seg public.mtb_segments; v_length double precision; new_id uuid; my_best double precision; others_best double precision;
 me uuid:=auth.uid(); day text; done_today integer; athlete text; actor uuid;
begin
 if me is null or not public.account_is_active() then raise exception 'Sign in to record an effort.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('segment-athlete:'||me,0));
 -- The athlete chose not to take part: nothing is stored.
 if public.segment_participation_of(me)='off' then raise exception 'Segment efforts are off'; end if;
 -- Named only to people who chose to be named; otherwise "Someone".
 athlete:=public.segment_athlete_name(me);
 actor:=case when public.segment_participation_of(me)='public' then me else null end;
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
   values('segment-done:'||seg.id||':'||day,seg.creator_id,actor,'segment_completed','Your segment was completed',
    left(left(seg.name,120)||': '||athlete||' completed it',180),jsonb_build_object('screen','segment','id',seg.id))
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
  perform public.notify('segment-record:'||new_id,seg.creator_id,actor,'segment_record','New record on your segment',
   left(seg.name,120)||': '||athlete||' set '||to_char(make_interval(secs=>round(p_elapsed_seconds)),'HH24:MI:SS'),
   jsonb_build_object('screen','segment','id',seg.id));
 end if;
 return new_id;
end $$;

revoke all on function public.record_segment_effort(text,uuid,double precision,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.record_segment_effort(text,uuid,double precision,timestamptz,integer) to authenticated;

-- Remove every effort I recorded (choosing "off" stops new ones; this clears the rest).
create or replace function public.delete_my_segment_efforts() returns integer
language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('segment-athlete:'||auth.uid(),0));
 delete from public.segment_efforts where athlete_id=auth.uid();
 get diagnostics removed = row_count;
 return removed;
end;
$$;
revoke all on function public.delete_my_segment_efforts() from public,anon,authenticated;
grant execute on function public.delete_my_segment_efforts() to authenticated;

-- Public segments changed after (p_since, p_after), oldest first. A rename moves a
-- segment forward too; matching it again is harmless (efforts are idempotent).
create index if not exists mtb_segments_catalogue on public.mtb_segments(updated_at,id) where deleted_at is null;
create or replace function public.segment_catalogue_since(p_since timestamptz default null,p_after uuid default null,p_limit integer default 50)
returns table(id uuid,version integer,changed_at timestamptz,min_lat double precision,max_lat double precision,min_lon double precision,max_lon double precision)
language sql stable security invoker set search_path='' as $$
 select s.id,s.version,s.updated_at,g.min_lat,g.max_lat,g.min_lon,g.max_lon
 from public.mtb_segments s join public.mtb_segment_geometry g on g.segment_id=s.id and g.version=s.version
 where s.deleted_at is null and s.visibility='public' and s.status='approved'
  and (p_since is null or (s.updated_at,s.id)>(p_since,coalesce(p_after,'00000000-0000-0000-0000-000000000000'::uuid)))
 order by s.updated_at,s.id
 limit least(greatest(coalesce(p_limit,50),1),100);
$$;
revoke all on function public.segment_catalogue_since(timestamptz,uuid,integer) from public,anon;
grant execute on function public.segment_catalogue_since(timestamptz,uuid,integer) to authenticated;

commit;
