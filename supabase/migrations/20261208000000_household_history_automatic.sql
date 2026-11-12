-- Household members share their activities with each other by default: new ones (since sharing began) and, for the
-- people who are ALREADY in a household, their earlier completed ones too. This is done here, once, by the
-- migration itself: no switch to turn on, nothing to approve, nothing the phones have to do. A Home place is not
-- required (a household knows where Home is); Home and Work are still hidden from the route if they are saved.
--
-- It replaces the opt-in of 20261207000000 (a consent table and a control that were not needed): those objects are
-- removed, and the eligibility rules go back to the single `activity_auto_share` rule, with `since` moved back for the
-- existing members. Forward-only; safe to run again (nothing already shared is shared twice).
begin;

-- ---------------------------------------------------------------- undo the opt-in
drop function if exists public.my_history_sharing();
drop function if exists public.set_history_sharing(boolean);

create or replace function public.auto_share_allowed(p_owner uuid,p_activity uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.activities a
  join public.activity_auto_share s on s.user_id=a.owner_id and s.enabled
  where a.id=p_activity and a.owner_id=p_owner
   and a.ended_at is not null and a.started_at>=s.since
   and exists(select 1 from public.household_memberships m where m.user_id=p_owner)
   and not exists(select 1 from public.activity_share_decisions d where d.activity_id=a.id)
   and not public.activity_ref_is_private(p_owner,p_activity::text)
 )
$$;

create or replace function public.auto_share_candidates(p_owner uuid) returns setof uuid
language sql stable security definer set search_path='' as $$
 select a.id from public.activities a
 join public.activity_auto_share s on s.user_id=a.owner_id and s.enabled
 where a.owner_id=p_owner
  and exists(select 1 from public.household_memberships m where m.user_id=a.owner_id)
  and a.ended_at is not null and jsonb_typeof(a.route_points)='array' and jsonb_array_length(a.route_points)>=2
  and a.started_at>=s.since
  and not public.activity_ref_is_private(a.owner_id,a.id::text)
  and not exists(select 1 from public.activity_share_decisions d where d.activity_id=a.id)
  and not exists(select 1 from public.shared_journeys j where j.activity_id=a.id)
$$;
revoke all on function public.auto_share_candidates(uuid) from public,anon,authenticated;

create or replace function public.my_auto_share_pending(p_limit integer default 10,p_exclude uuid[] default '{}')
returns table(activity_id uuid,revision integer)
language sql stable security definer set search_path='' as $$
 select a.id,a.revision from public.activities a
 where auth.uid() is not null and a.owner_id=auth.uid()
  and a.id in (select public.auto_share_candidates(auth.uid()))
  and not (a.id=any(coalesce(p_exclude,'{}')))
 order by a.started_at desc limit least(greatest(coalesce(p_limit,10),1),25)
$$;

create or replace function public.remember_manual_share(p_owner uuid,p_activity uuid) returns void
language sql security definer set search_path='' as $$
 insert into public.activity_share_decisions(activity_id,owner_id)
  select a.id,a.owner_id from public.activities a where a.id=p_activity and a.owner_id=p_owner
 on conflict(activity_id) do nothing
$$;

create or replace function public.publish_social_journey(
 p_owner uuid,p_activity uuid,p_revision integer,p_audience text,p_mode text,
 p_recipients uuid[],p_snapshot jsonb,p_auto boolean default false)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare v_token uuid; v_current integer;
begin
 if p_owner is null then raise exception 'Sign in required'; end if;
 perform set_config('request.jwt.claim.sub',p_owner::text,true);
 if auth.uid() is distinct from p_owner then raise exception 'Sign in required'; end if;
 if p_audience not in ('friends','household') or p_mode is null then raise exception 'Invalid social audience'; end if;
 if p_auto then
  if p_audience<>'household' or p_mode<>'household' or coalesce(cardinality(p_recipients),0)<>0 then raise exception 'Automatic sharing is household only'; end if;
  perform 1 from public.household_memberships where user_id=p_owner for share;
  if not found then raise exception 'Automatic sharing consent unavailable'; end if;
  perform 1 from public.activity_auto_share where user_id=p_owner for share;
  if not found then raise exception 'Automatic sharing consent unavailable'; end if;
 end if;
 select revision into v_current from public.activities
 where id=p_activity and owner_id=auth.uid() for update;
 if not found or v_current<>p_revision then raise exception 'Activity revision changed'; end if;
 if p_auto and not public.auto_share_allowed(p_owner,p_activity) then raise exception 'Activity is not eligible for automatic sharing'; end if;
 select public.commit_shared_journey(p_activity,auth.uid(),p_revision,p_audience,p_snapshot) into v_token;
 perform public.configure_social_journey(p_activity,p_mode,coalesce(p_recipients,'{}'::uuid[]));
 if not coalesce(p_auto,false) then perform public.remember_manual_share(p_owner,p_activity); end if;
 return v_token;
end $$;
revoke all on function public.publish_social_journey(uuid,uuid,integer,text,text,uuid[],jsonb,boolean) from public,anon,authenticated;
grant execute on function public.publish_social_journey(uuid,uuid,integer,text,text,uuid[],jsonb,boolean) to service_role;

drop table if exists public.household_history_published;
drop table if exists public.household_history_consent;

-- ---------------------------------------------------------------- the household copy of a recording
create or replace function public.meters_between(a_lat double precision,a_lon double precision,b_lat double precision,b_lon double precision)
returns double precision language sql immutable set search_path='' as $$
 select 6371000*2*atan2(sqrt(least(1,q.s)),sqrt(greatest(0,1-q.s)))
 from (select power(sin(radians(b_lat-a_lat)/2),2)+cos(radians(a_lat))*cos(radians(b_lat))*power(sin(radians(b_lon-a_lon)/2),2) as s) q
$$;

-- What a household member receives for an activity: exactly the snapshot the journeys function builds for a private
-- audience (supabase/functions/_shared/activityPrivacy.js, redactRoute with times): points within 300 m of the owner's
-- Home or Work (radius + 300 m) are left out, a route is cut where it leaves and re-enters, or crosses, a masked area,
-- and only latitude, longitude, segment and capture time survive. Computed from the route already stored in Supabase;
-- nothing is looked up again. With no Home or Work saved there is nothing to hide.
create or replace function public.household_snapshot(p_activity uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.activities; v_points jsonb;
begin
 select * into a from public.activities where id=p_activity;
 if not found then return null; end if;
 with places as (
   select sp.latitude,sp.longitude,sp.radius from public.saved_places sp where sp.owner_id=a.owner_id and sp.kind in ('home','work')),
 raw as (
   select e.ord,e.x->'latitude' as jlat,e.x->'longitude' as jlon,
          case when jsonb_typeof(e.x->'latitude')='number' then (e.x->>'latitude')::float8 end as lat,
          case when jsonb_typeof(e.x->'longitude')='number' then (e.x->>'longitude')::float8 end as lon,
          coalesce(e.x->>'segment','') as sg,e.x->'timestamp' as ts
   from jsonb_array_elements(case when jsonb_typeof(a.route_points)='array' then a.route_points else '[]'::jsonb end) with ordinality e(x,ord)
   where jsonb_typeof(e.x->'latitude')='number' and jsonb_typeof(e.x->'longitude')='number'),
 flagged as (
   select r.*,exists(select 1 from places p where public.meters_between(r.lat,r.lon,p.latitude,p.longitude)<=p.radius+300) as hidden from raw r),
 paired as (
   select f.*,lag(f.lat) over w as plat,lag(f.lon) over w as plon,lag(f.sg) over w as psg,lag(f.hidden) over w as phidden
   from flagged f window w as (order by f.ord)),
 marked as (
   select p.*,(not p.hidden) and p.phidden is false and (p.psg is distinct from p.sg
     or (exists(select 1 from places) and (public.meters_between(p.plat,p.plon,p.lat,p.lon)>10000
          or public.segment_near_private_place(a.owner_id,p.plat,p.plon,p.lat,p.lon)))) as cut
   from paired p),
 numbered as (
   select m.*,sum(case when m.hidden or m.cut then 1 else 0 end) over (order by m.ord) as seg from marked m)
 select coalesce(jsonb_agg(case when jsonb_typeof(n.ts)='number'
          then jsonb_build_object('latitude',n.jlat,'longitude',n.jlon,'segment',n.seg,'t',floor((n.ts#>>'{}')::float8+0.5))
          else jsonb_build_object('latitude',n.jlat,'longitude',n.jlon,'segment',n.seg) end order by n.ord),'[]'::jsonb)
 into v_points from numbered n where not n.hidden;
 return jsonb_build_object('title',a.title,'activity',a.activity,'description',a.description,'startedAt',a.started_at,'endedAt',a.ended_at,
   'distanceMeters',a.distance_meters,'durationSeconds',a.duration_seconds,'points',v_points,'photos','[]'::jsonb);
end $$;
revoke all on function public.household_snapshot(uuid) from public,anon,authenticated;

-- Publishes, to the household, every eligible activity (same rules as automatic sharing: household member with sharing on,
-- finished, has a route, not private, not already shared). One that cannot be published is skipped and does not stop the rest
-- (and is still listed for the next run, and for the phone's own automatic sharing). Safe to run again.
create or replace function public.publish_household_history(p_owner uuid default null) returns integer
language plpgsql security definer set search_path='' as $$
declare r record; n integer:=0;
begin
 for r in
  select a.id,a.owner_id,a.revision from public.activities a
  where a.owner_id in (select m.user_id from public.household_memberships m where p_owner is null or m.user_id=p_owner)
   and a.id in (select public.auto_share_candidates(a.owner_id))
  order by a.owner_id,a.started_at
 loop
  begin
   perform public.publish_social_journey(r.owner_id,r.id,r.revision,'household','household','{}'::uuid[],public.household_snapshot(r.id),true);
   n:=n+1;
  exception when others then
   raise notice 'Household history: one activity was not published (%)',sqlerrm;
  end;
 end loop;
 return n;
end $$;
revoke all on function public.publish_household_history(uuid) from public,anon,authenticated;
grant execute on function public.publish_household_history(uuid) to service_role;

-- ---------------------------------------------------------------- the people already in a household
-- Household sharing is on for every existing member who has not chosen otherwise (a row with enabled = false is a
-- choice and is left alone), and it covers their earlier activities. People who join later start from their joining.
insert into public.activity_auto_share(user_id,enabled,since)
select distinct m.user_id,true,'epoch'::timestamptz from public.household_memberships m
on conflict(user_id) do update set since='epoch'::timestamptz where public.activity_auto_share.enabled;

select public.publish_household_history();
commit;
