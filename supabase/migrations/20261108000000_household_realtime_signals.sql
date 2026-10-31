-- Near-real-time household map. Apply manually to the current Supabase project
-- after 20261107000000; the app keeps polling until this is applied.
--
-- Why a signal and not the row: household_live_locations is deliberately closed to
-- clients, and my_household_location_status() is the one place that decides who may
-- see which position. A broadcast carries only "this member's location changed" and
-- each client re-reads through that function, so no coordinate ever enters
-- Realtime, and no access rule exists twice. The broadcast is empty: a viewer has
-- nothing to learn from it except that something changed.
--
-- Realtime checks the policy when a client joins and on each new token, so someone
-- removed from a household can keep receiving these empty signals until their token
-- next refreshes. They still read nothing: the status function rejects them at once.
--
-- Safe to re-run. Requires nothing in the dashboard: private channels work with
-- "Allow public access" on or off.
--
-- Additive: existing rows and earlier app builds are unaffected. Earlier builds call
-- publish_live_location with fewer arguments, which the new defaults accept.
begin;

-- p_captured_at is when the fix was taken. It can only move a position back by a
-- bounded amount and never into the future, and an older fix arriving late never
-- replaces a newer one.
drop function if exists public.publish_live_location(text,double precision,double precision,double precision,double precision);
create or replace function public.publish_live_location(
 p_token text,p_latitude double precision,p_longitude double precision,
 p_accuracy double precision default null,p_speed double precision default null,
 p_captured_at timestamptz default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_at timestamptz;
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
   location_at=v_at,expires_at=now()+interval '90 seconds',updated_at=now()
  where user_id=v_user and (location_at is null or location_at<=v_at);
 return true;
end $$;
revoke all on function public.publish_live_location(text,double precision,double precision,double precision,double precision,timestamptz) from public,anon,authenticated;
grant execute on function public.publish_live_location(text,double precision,double precision,double precision,double precision,timestamptz) to anon,authenticated;

-- A failed broadcast must never fail a publish: polling still delivers the position.
create or replace function public.signal_household_location() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_topic text;
begin
 if tg_op='UPDATE' and new.location_at is not distinct from old.location_at and new.enabled=old.enabled then return null; end if;
 if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then return null; end if;
 for v_topic in select 'household:'||m.household_id from public.household_memberships m where m.user_id=new.user_id loop
  begin
   perform realtime.send('{}'::jsonb,'location',v_topic,true);
  exception when others then null;
  end;
 end loop;
 return null;
end $$;
revoke all on function public.signal_household_location() from public,anon,authenticated;
drop trigger if exists signal_household_location on public.household_live_locations;
create trigger signal_household_location after insert or update on public.household_live_locations
 for each row execute function public.signal_household_location();

-- Someone leaving must disappear from the other maps now, not at the next poll.
create or replace function public.signal_household_membership() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then return null; end if;
 begin
  perform realtime.send('{}'::jsonb,'location','household:'||coalesce(old.household_id,new.household_id),true);
 exception when others then null;
 end;
 return null;
end $$;
revoke all on function public.signal_household_membership() from public,anon,authenticated;
drop trigger if exists signal_household_membership on public.household_memberships;
create trigger signal_household_membership after insert or delete on public.household_memberships
 for each row execute function public.signal_household_membership();

-- The private channels the caller may join.
create or replace function public.my_household_signal_topics()
returns table(topic text) language sql stable security definer set search_path='' as $$
 select 'household:'||m.household_id from public.household_memberships m where m.user_id=auth.uid()
$$;
revoke all on function public.my_household_signal_topics() from public,anon,authenticated;
grant execute on function public.my_household_signal_topics() to authenticated;

-- Memberships are closed to clients, so the policy below asks through this.
create or replace function public.can_join_household_topic(p_topic text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.household_memberships m where m.user_id=auth.uid() and 'household:'||m.household_id=p_topic)
$$;
revoke all on function public.can_join_household_topic(text) from public,anon,authenticated;
grant execute on function public.can_join_household_topic(text) to authenticated;

-- Joining a private channel is authorised here. Skipped where Realtime is absent.
do $$
begin
 if to_regclass('realtime.messages') is not null then
  drop policy if exists household_location_signals on realtime.messages;
  create policy household_location_signals on realtime.messages for select to authenticated
   using (extension='broadcast' and public.can_join_household_topic((select realtime.topic())));
 end if;
end $$;
commit;
