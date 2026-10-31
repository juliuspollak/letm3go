-- Household movement status from native code. Until now it reached other members only
-- through set_household_presence, called from the WebView, which does not run on a
-- locked phone: Driving could not be shared while actually driving.
--
-- The status now travels with the position, in the same row and behind the same check
-- in my_household_location_status(), so it is visible exactly when the position is. It
-- is one coarse word, and it is never derived on the server.
--
-- Additive and safe to re-run. Earlier builds omit p_activity and leave it null, so
-- viewers fall back to household presence for those members.
begin;

alter table public.household_live_locations add column if not exists activity text;
alter table public.household_live_locations drop constraint if exists household_live_activity;
alter table public.household_live_locations add constraint household_live_activity
 check (activity is null or activity in ('driving','cycling','running','walking','stationary'));

drop function if exists public.publish_live_location(text,double precision,double precision,double precision,double precision,timestamptz);
drop function if exists public.publish_live_location(text,double precision,double precision,double precision,double precision,timestamptz,text);
create function public.publish_live_location(
 p_token text,p_latitude double precision,p_longitude double precision,
 p_accuracy double precision default null,p_speed double precision default null,
 p_captured_at timestamptz default null,p_activity text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_at timestamptz;
 -- An unknown word from a newer build must not cost the position.
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
  and exists(select 1 from public.household_memberships m where m.user_id=l.user_id);
 if v_user is null then return false; end if;
 v_at:=least(now(),greatest(coalesce(p_captured_at,now()),now()-interval '30 seconds'));
 update public.household_live_locations
  set latitude=p_latitude,longitude=p_longitude,accuracy_m=p_accuracy,speed_kmh=p_speed,
   location_at=v_at,expires_at=now()+interval '90 seconds',updated_at=now(),activity=v_activity
  where user_id=v_user and (location_at is null or location_at<=v_at);
 return true;
end $$;
revoke all on function public.publish_live_location(text,double precision,double precision,double precision,double precision,timestamptz,text) from public,anon,authenticated;
grant execute on function public.publish_live_location(text,double precision,double precision,double precision,double precision,timestamptz,text) to anon,authenticated;

-- A status change at an unchanged position (arriving, then stopping) still signals.
create or replace function public.signal_household_location() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_topic text;
begin
 if tg_op='UPDATE' and new.location_at is not distinct from old.location_at and new.enabled=old.enabled
  and new.activity is not distinct from old.activity then return null; end if;
 if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then return null; end if;
 for v_topic in select 'household:'||m.household_id from public.household_memberships m where m.user_id=new.user_id loop
  begin
   perform realtime.send('{}'::jsonb,'location',v_topic,true);
  exception when others then null;
  end;
 end loop;
 return null;
end $$;

drop function if exists public.my_household_location_status();
create function public.my_household_location_status()
returns table(user_id uuid,display_name text,sharing_enabled boolean,
 latitude double precision,longitude double precision,accuracy_m double precision,
 speed_kmh double precision,location_at timestamptz,server_now timestamptz,arrived_at timestamptz,activity text)
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
  case when v.visible and public.live_location_arrival(l)>=greatest(me.joined_at,member.joined_at)
   then public.live_location_arrival(l) end,
  case when v.visible then l.activity end
 from public.household_memberships me
 join public.household_memberships member on member.household_id=me.household_id and member.user_id<>me.user_id
 left join public.household_live_locations l on l.user_id=member.user_id
 cross join lateral (select coalesce(l.enabled,false) and l.latitude is not null and l.longitude is not null
  and l.location_at>now()-interval '24 hours'
  and l.location_at>=greatest(me.joined_at,member.joined_at) as visible) v
 where me.user_id=auth.uid()
 order by 2
$$;
revoke all on function public.my_household_location_status() from public,anon,authenticated;
grant execute on function public.my_household_location_status() to authenticated;
commit;
