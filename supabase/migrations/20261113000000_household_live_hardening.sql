-- Live household hardening. Apply manually after 20261112000000; this migration
-- is additive and safe to re-run.
--
-- 1. set_my_live_location accepts the same captured-at and activity fields as the
--    device publisher, so an in-app WebView update cannot make an old fix look
--    new and can clear a stale movement status.
-- 2. Both publishers use newer-wins semantics on location_at. A delayed request
--    from an earlier position never regresses the map.
-- 3. Captured time is no longer clamped to 30 seconds ago. A fix delivered after
--    a network outage keeps its true age; the map can therefore show "stale"
--    instead of presenting an old position as current.
-- 4. Turning sharing off or leaving a household clears the activity as well as
--    the position and credential.
-- 5. The device publish path locks the consent row and rechecks enabled in the
--    update, so a request that started before an off switch cannot write after it.
-- 6. A position-bearing set_my_live_location call can update an enabled row but
--    can never re-enable a disabled one, even when its captured time is newer
--    than the off switch. Re-enabling requires the explicit status-only call
--    set_my_live_location(true) made by the signed-in owner.
--
-- Earlier app builds call set_my_live_location with five arguments; the new
-- defaults preserve that call for position updates. A legacy position call no
-- longer re-enables sharing after an off switch; an explicit status-only call
-- still does. Earlier publish_live_location calls are unchanged.
begin;

alter table public.household_live_locations add column if not exists activity text;
alter table public.household_live_locations drop constraint if exists household_live_activity;
alter table public.household_live_locations add constraint household_live_activity
 check (activity is null or activity in ('driving','cycling','running','walking','stationary'));

-- A five-argument and a seven-argument overload would make PostgREST ambiguity
-- possible. Drop the old signatures and create one function whose optional tail
-- accepts both old and new clients.
drop function if exists public.set_my_live_location(boolean,double precision,double precision,double precision,double precision);
drop function if exists public.set_my_live_location(boolean,double precision,double precision,double precision,double precision,timestamptz,text);
create function public.set_my_live_location(
 p_enabled boolean,p_latitude double precision default null,
 p_longitude double precision default null,p_accuracy double precision default null,
 p_speed double precision default null,p_captured_at timestamptz default null,
 p_activity text default null)
returns void language plpgsql security definer set search_path='' as $$
declare
 v_at timestamptz;
 v_position boolean:=p_enabled and p_latitude is not null;
 v_activity text:=case when p_activity in ('driving','cycling','running','walking','stationary') then p_activity end;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if p_enabled and (
  p_latitude is not null and (p_latitude not between -90 and 90)
  or p_longitude is not null and (p_longitude not between -180 and 180)
  or p_accuracy is not null and (p_accuracy not between 0 and 100)
  or p_speed is not null and (p_speed not between 0 and 250))
 then raise exception 'Invalid location'; end if;
 if p_enabled and ((p_latitude is null) <> (p_longitude is null)) then raise exception 'Incomplete coordinate'; end if;
 if p_enabled and not exists(select 1 from public.household_memberships m where m.user_id=auth.uid()) then
  raise exception 'Join a household before sharing location';
 end if;

 -- A captured time may be old, but never in the future. A status-only update is
 -- "now" because it describes the current consent/activity, not an old fix.
 v_at:=case when v_position then least(now(),coalesce(p_captured_at,now())) else now() end;

 insert into public.household_live_locations as l
  (user_id,enabled,latitude,longitude,accuracy_m,speed_kmh,expires_at,location_at,activity,updated_at)
 values(auth.uid(),p_enabled,
  case when p_enabled then p_latitude end,case when p_enabled then p_longitude end,
  case when p_enabled then p_accuracy end,case when p_enabled then p_speed end,
  case when v_position then now()+interval '90 seconds' end,
  case when v_position then v_at end,
  case when p_enabled then v_activity end,now())
 on conflict(user_id) do update set
  -- A position request can update an enabled row but can never turn a disabled
  -- row back on, regardless of its captured time. Re-enabling requires the
  -- signed-in owner's explicit status-only set_my_live_location(true) action.
  enabled=case when not excluded.enabled then false
   when l.enabled then true
   when v_position then false
   else true end,
  latitude=case when not excluded.enabled then null
   when l.enabled and v_position
    and (l.location_at is null or l.location_at<=v_at) then excluded.latitude else l.latitude end,
  longitude=case when not excluded.enabled then null
   when l.enabled and v_position
    and (l.location_at is null or l.location_at<=v_at) then excluded.longitude else l.longitude end,
  accuracy_m=case when not excluded.enabled then null
   when l.enabled and v_position
    and (l.location_at is null or l.location_at<=v_at) then excluded.accuracy_m else l.accuracy_m end,
  speed_kmh=case when not excluded.enabled then null
   when l.enabled and v_position
    and (l.location_at is null or l.location_at<=v_at) then excluded.speed_kmh else l.speed_kmh end,
  expires_at=case when not excluded.enabled then null
   when l.enabled and v_position
    and (l.location_at is null or l.location_at<=v_at) then excluded.expires_at else l.expires_at end,
  location_at=case when not excluded.enabled then null
   when l.enabled and v_position
    and (l.location_at is null or l.location_at<=v_at) then v_at else l.location_at end,
  activity=case when not excluded.enabled then null
   when l.enabled and (l.location_at is null or l.location_at<=v_at) then v_activity else l.activity end,
  publish_token_hash=case when excluded.enabled then l.publish_token_hash end,
  publish_token_expires_at=case when excluded.enabled then l.publish_token_expires_at end,
  updated_at=now();
end $$;
revoke all on function public.set_my_live_location(boolean,double precision,double precision,double precision,double precision,timestamptz,text) from public,anon,authenticated;
grant execute on function public.set_my_live_location(boolean,double precision,double precision,double precision,double precision,timestamptz,text) to authenticated;

-- The device credential never receives an earlier fix from a newer location.
-- p_captured_at may be old; only the future is bounded.
create or replace function public.publish_live_location(
 p_token text,p_latitude double precision,p_longitude double precision,
 p_accuracy double precision default null,p_speed double precision default null,
 p_captured_at timestamptz default null,p_activity text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_at timestamptz;
 v_activity text:=case when p_activity in ('driving','cycling','running','walking','stationary') then p_activity end;
begin
 if p_token is null or length(p_token)<>64 then return false; end if;
 if p_latitude is null or p_longitude is null
  or p_latitude not between -90 and 90 or p_longitude not between -180 and 180
  or p_accuracy is not null and p_accuracy not between 0 and 100
  or p_speed is not null and p_speed not between 0 and 250
 then raise exception 'Invalid location'; end if;
 select l.user_id into v_user from public.household_live_locations l
  where l.publish_token_hash=sha256(convert_to(p_token,'UTF8'))
  and l.publish_token_expires_at>now() and l.enabled
  and exists(select 1 from public.household_memberships m where m.user_id=l.user_id)
  for update;
 if v_user is null then return false; end if;
 v_at:=least(now(),coalesce(p_captured_at,now()));
 update public.household_live_locations
  set latitude=p_latitude,longitude=p_longitude,accuracy_m=p_accuracy,speed_kmh=p_speed,
   location_at=v_at,expires_at=now()+interval '90 seconds',updated_at=now(),activity=v_activity
  where user_id=v_user and enabled and (location_at is null or location_at<=v_at);
 return true;
end $$;
revoke all on function public.publish_live_location(text,double precision,double precision,double precision,double precision,timestamptz,text) from public,anon,authenticated;
grant execute on function public.publish_live_location(text,double precision,double precision,double precision,double precision,timestamptz,text) to anon,authenticated;

-- Consent was to this household, so leaving clears both the position and the
-- movement status; the old trigger did not know about activity.
create or replace function public.end_live_location_on_leave() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.household_live_locations
  set enabled=false,latitude=null,longitude=null,accuracy_m=null,speed_kmh=null,
   expires_at=null,location_at=null,activity=null,publish_token_hash=null,publish_token_expires_at=null,updated_at=now()
  where user_id=old.user_id;
 return old;
end $$;

commit;

