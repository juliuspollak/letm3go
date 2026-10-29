-- Time at a place for household location sharing.
--
-- Why: the map can only say "Last updated 12 min ago". location_at is when a
-- position was last confirmed, not when the person arrived, so it cannot say
-- "At Home · 2h 15m". No existing table records an arrival that viewers are
-- authorised to see: the recorder's own place model stays on the phone, and
-- household_presence carries only an expiring label.
--
-- What: every accepted position (from the in-app publisher and from the device
-- credential) passes one trigger that keeps a private anchor for where the
-- member currently is and when they were first observed there. A viewer is given
-- `arrived_at` only when that arrival was observed continuously and the member has
-- been confirmed stationary there for at least five minutes. Otherwise it is null
-- and the app shows the last-updated time. No extra location polling is added:
-- the phone already confirms an unchanged position every five minutes.
--
-- Rules (also in docs/live-household-map.md):
-- - Same place: within 150 m of the anchor. A fix counts as a departure only when
--   it is clearly outside: distance minus its accuracy (capped at 100 m) is more
--   than 150 m. A coarse Wi-Fi fix that jumps around therefore never resets a visit.
-- - Continuity: consecutive fixes at most 15 minutes apart (three missed
--   five-minute confirmations). After a longer silence the member may have left
--   and come back, so the arrival becomes unknown and stays unknown for that visit.
--   An arrival is never estimated or backdated.
-- - A confirmed departure starts a new anchor at the first fix outside, whose time
--   is a real observation that follows a continuously observed fix elsewhere.
-- - Turning sharing off, leaving the household, or the first fix after enabling
--   sharing clears the anchor, so a previous visit is never carried over.
--
-- Privacy: the anchor coordinates are never returned. arrived_at is returned only
-- where coordinates are already returned (same household, sharing on, position
-- confirmed within 24 hours and after both people joined). Friends are not given
-- arrival times; their access is unchanged.
--
-- Additive and replay-safe: new nullable columns, a trigger, one new function and
-- my_household_location_status() with one extra column. Apply after 20261105000000.
begin;

alter table public.household_live_locations
 add column if not exists place_latitude double precision,
 add column if not exists place_longitude double precision,
 add column if not exists place_since timestamptz,
 add column if not exists place_known boolean not null default false;

create or replace function public.track_live_location_place() returns trigger
language plpgsql set search_path='' as $$
declare
 v_distance double precision;
 v_uncertainty double precision;
 v_continuous boolean;
begin
 if not new.enabled or new.latitude is null or new.longitude is null or new.location_at is null then
  new.place_latitude:=null;new.place_longitude:=null;new.place_since:=null;new.place_known:=false;
  return new;
 end if;
 -- Consent re-asserted or a credential issued: no new fix, nothing to decide.
 if tg_op='UPDATE' and new.location_at is not distinct from old.location_at then return new; end if;
 if tg_op='INSERT' or not old.enabled or old.place_latitude is null or old.location_at is null then
  -- First fix after enabling: where they are is known, when they arrived is not.
  new.place_latitude:=new.latitude;new.place_longitude:=new.longitude;
  new.place_since:=new.location_at;new.place_known:=false;
  return new;
 end if;
 v_distance:=6371000*2*asin(least(1,sqrt(
  power(sin(radians(new.latitude-old.place_latitude)/2),2)+
  cos(radians(old.place_latitude))*cos(radians(new.latitude))*power(sin(radians(new.longitude-old.place_longitude)/2),2))));
 v_uncertainty:=least(100,greatest(0,coalesce(new.accuracy_m,100)));
 v_continuous:=new.location_at-old.location_at<=interval '15 minutes';
 if v_distance-v_uncertainty>150 then
  -- Clearly somewhere else. The arrival here is known only when the previous fix
  -- was recent enough that this is the first time they were seen here.
  new.place_latitude:=new.latitude;new.place_longitude:=new.longitude;
  new.place_since:=new.location_at;new.place_known:=v_continuous;
 else
  -- Same place, or not clearly elsewhere: keep the anchor and its arrival. A
  -- silence longer than the continuity window makes the arrival unknown.
  new.place_latitude:=old.place_latitude;new.place_longitude:=old.place_longitude;
  new.place_since:=old.place_since;new.place_known:=old.place_known and v_continuous;
 end if;
 return new;
end $$;
revoke all on function public.track_live_location_place() from public,anon,authenticated;
drop trigger if exists track_live_location_place on public.household_live_locations;
create trigger track_live_location_place before insert or update on public.household_live_locations
 for each row execute function public.track_live_location_place();

-- The arrival a viewer may see: observed continuously, stationary for at least
-- five minutes (the latest fix is still at the anchor and not moving fast).
create or replace function public.live_location_arrival(l public.household_live_locations)
returns timestamptz language sql stable set search_path='' as $$
 select case when l.enabled and l.place_known and l.place_since is not null and l.location_at is not null
  and l.location_at-l.place_since>=interval '5 minutes' and coalesce(l.speed_kmh,0)<10
  then l.place_since end
$$;
revoke all on function public.live_location_arrival(public.household_live_locations) from public,anon,authenticated;

-- The return type gains arrived_at, which create or replace cannot change.
drop function if exists public.my_household_location_status();
create function public.my_household_location_status()
returns table(user_id uuid,display_name text,sharing_enabled boolean,
 latitude double precision,longitude double precision,accuracy_m double precision,
 speed_kmh double precision,location_at timestamptz,server_now timestamptz,arrived_at timestamptz)
language sql stable security definer set search_path='' as $$
 select member.user_id,
  public.person_display_name(member.user_id),
  coalesce(l.enabled,false),
  case when v.visible then l.latitude end,
  case when v.visible then l.longitude end,
  case when v.visible then l.accuracy_m end,
  case when v.visible then l.speed_kmh end,
  case when coalesce(l.enabled,false) and l.location_at>=greatest(me.joined_at,member.joined_at) then l.location_at end,
  now(),
  -- An arrival before either person joined is not shared with this household.
  case when v.visible and public.live_location_arrival(l)>=greatest(me.joined_at,member.joined_at)
   then public.live_location_arrival(l) end
 from public.household_memberships me
 join public.household_memberships member on member.household_id=me.household_id and member.user_id<>me.user_id
 left join public.household_live_locations l on l.user_id=member.user_id
 cross join lateral (select coalesce(l.enabled,false) and l.latitude is not null and l.longitude is not null
  and l.location_at>now()-interval '24 hours'
  and l.location_at>=greatest(me.joined_at,member.joined_at) as visible) v
 where me.user_id=auth.uid()
 order by 2
$$;

-- The caller's own arrival, as their household sees it.
create or replace function public.my_live_location_arrival()
returns table(arrived_at timestamptz,location_at timestamptz,server_now timestamptz)
language sql stable security definer set search_path='' as $$
 select public.live_location_arrival(l),case when l.enabled then l.location_at end,now()
 from public.household_live_locations l where l.user_id=auth.uid()
$$;

revoke all on function public.my_household_location_status(),public.my_live_location_arrival() from public,anon,authenticated;
grant execute on function public.my_household_location_status(),public.my_live_location_arrival() to authenticated;
commit;
