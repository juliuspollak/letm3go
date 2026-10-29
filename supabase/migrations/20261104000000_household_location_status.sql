-- Household location status: last-known positions with an explicit freshness
-- policy, per-member sharing state, and a narrowly scoped device credential so a
-- phone can keep publishing while the app is in the background.
--
-- Why: 20261029000000 made a position visible for only 90 seconds after it was
-- published (expires_at), and my_household_live_locations() hid every member
-- without such a row. A locked or stationary phone does not publish that often,
-- so a member who was sharing simply vanished from the map while their sharing
-- switch still read "on". Freshness is now reported, not used to hide people.
--
-- Additive and safe for existing data: columns are added, existing positions are
-- given a location time, consent and households are untouched. The function used
-- by earlier app builds (my_household_live_locations) is unchanged, and
-- set_my_live_location keeps its signature.
-- Apply manually to the current Supabase project after 20261029000000.
begin;

alter table public.household_live_locations
 add column if not exists location_at timestamptz,
 add column if not exists publish_token_hash bytea,
 add column if not exists publish_token_expires_at timestamptz;
update public.household_live_locations set location_at=updated_at
 where location_at is null and enabled and latitude is not null and longitude is not null;
create unique index if not exists household_live_location_publish_token
 on public.household_live_locations(publish_token_hash) where publish_token_hash is not null;

-- Consent and in-app updates. Turning sharing off erases the position and revokes
-- the device credential, so a previous private position is never shown again.
-- Re-asserting consent without a fix keeps the last confirmed position.
create or replace function public.set_my_live_location(
 p_enabled boolean,p_latitude double precision default null,
 p_longitude double precision default null,p_accuracy double precision default null,
 p_speed double precision default null)
returns void language plpgsql security definer set search_path='' as $$
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
 insert into public.household_live_locations as l(user_id,enabled,latitude,longitude,accuracy_m,speed_kmh,expires_at,location_at,updated_at)
 values(auth.uid(),p_enabled,case when p_enabled then p_latitude end,case when p_enabled then p_longitude end,
  case when p_enabled then p_accuracy end,case when p_enabled then p_speed end,
  case when p_enabled and p_latitude is not null then now()+interval '90 seconds' end,
  case when p_enabled and p_latitude is not null then now() end,now())
 on conflict(user_id) do update set
  enabled=excluded.enabled,
  latitude=case when not excluded.enabled then null when excluded.latitude is not null then excluded.latitude else l.latitude end,
  longitude=case when not excluded.enabled then null when excluded.latitude is not null then excluded.longitude else l.longitude end,
  accuracy_m=case when not excluded.enabled then null when excluded.latitude is not null then excluded.accuracy_m else l.accuracy_m end,
  speed_kmh=case when not excluded.enabled then null when excluded.latitude is not null then excluded.speed_kmh else l.speed_kmh end,
  expires_at=case when not excluded.enabled then null when excluded.latitude is not null then excluded.expires_at else l.expires_at end,
  location_at=case when not excluded.enabled then null when excluded.latitude is not null then excluded.location_at else l.location_at end,
  publish_token_hash=case when excluded.enabled then l.publish_token_hash end,
  publish_token_expires_at=case when excluded.enabled then l.publish_token_expires_at end,
  updated_at=now();
end $$;

-- One row per other member of the caller's household, including members who do
-- not share. Coordinates are returned only while the member shares, only for a
-- position confirmed within the last 24 hours, and only for a position confirmed
-- after both people were in this household. `location_at` lets the app show how
-- old a position is; `server_now` lets it measure age without trusting the phone
-- clock. Freshness labels (live, stale) are a presentation policy in the app.
create or replace function public.my_household_location_status()
returns table(user_id uuid,display_name text,sharing_enabled boolean,
 latitude double precision,longitude double precision,accuracy_m double precision,
 speed_kmh double precision,location_at timestamptz,server_now timestamptz)
language sql stable security definer set search_path='' as $$
 select member.user_id,
  coalesce(nullif(p.display_name,''),nullif(u.raw_user_meta_data->>'display_name',''),'Family member'),
  coalesce(l.enabled,false),
  case when v.visible then l.latitude end,
  case when v.visible then l.longitude end,
  case when v.visible then l.accuracy_m end,
  case when v.visible then l.speed_kmh end,
  case when coalesce(l.enabled,false) and l.location_at>=greatest(me.joined_at,member.joined_at) then l.location_at end,
  now()
 from public.household_memberships me
 join public.household_memberships member on member.household_id=me.household_id and member.user_id<>me.user_id
 join auth.users u on u.id=member.user_id
 left join public.account_preferences p on p.user_id=member.user_id
 left join public.household_live_locations l on l.user_id=member.user_id
 cross join lateral (select coalesce(l.enabled,false) and l.latitude is not null and l.longitude is not null
  and l.location_at>now()-interval '24 hours'
  and l.location_at>=greatest(me.joined_at,member.joined_at) as visible) v
 where me.user_id=auth.uid()
 order by 2
$$;

-- A device credential that can only publish the owner's own position. The app
-- obtains it while signed in and keeps it in the Keychain, so a backgrounded or
-- relaunched phone keeps publishing after its one-hour session token expires.
-- Only a SHA-256 hash is stored. It is revoked when sharing is turned off or the
-- member leaves the household, and it expires after 30 days.
create or replace function public.issue_my_live_location_token()
returns table(publish_token text,valid_until timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_token text; v_until timestamptz:=now()+interval '30 days';
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if not exists(select 1 from public.household_memberships m where m.user_id=auth.uid()) then
  raise exception 'Join a household before sharing location';
 end if;
 v_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 update public.household_live_locations
  set publish_token_hash=sha256(convert_to(v_token,'UTF8')),publish_token_expires_at=v_until
  where user_id=auth.uid() and enabled;
 if not found then raise exception 'Turn on location sharing first'; end if;
 return query select v_token,v_until;
end $$;

-- Publish with the device credential. Returns false (never an error) for an
-- unknown, expired or revoked credential, or a member who left the household,
-- so the phone can discard it.
create or replace function public.publish_live_location(
 p_token text,p_latitude double precision,p_longitude double precision,
 p_accuracy double precision default null,p_speed double precision default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user uuid;
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
 update public.household_live_locations
  set latitude=p_latitude,longitude=p_longitude,accuracy_m=p_accuracy,speed_kmh=p_speed,
   location_at=now(),expires_at=now()+interval '90 seconds',updated_at=now()
  where user_id=v_user;
 return true;
end $$;

-- Leaving a household (or the household being deleted) ends location sharing:
-- consent was given to that household, so it must not carry over to another one.
create or replace function public.end_live_location_on_leave() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.household_live_locations
  set enabled=false,latitude=null,longitude=null,accuracy_m=null,speed_kmh=null,
   expires_at=null,location_at=null,publish_token_hash=null,publish_token_expires_at=null,updated_at=now()
  where user_id=old.user_id;
 return old;
end $$;
drop trigger if exists end_live_location_on_leave on public.household_memberships;
create trigger end_live_location_on_leave after delete on public.household_memberships
 for each row execute function public.end_live_location_on_leave();

revoke all on function public.my_household_location_status(),public.issue_my_live_location_token(),
 public.publish_live_location(text,double precision,double precision,double precision,double precision),
 public.end_live_location_on_leave() from public,anon,authenticated;
grant execute on function public.my_household_location_status(),public.issue_my_live_location_token() to authenticated;
grant execute on function public.publish_live_location(text,double precision,double precision,double precision,double precision) to anon,authenticated;
commit;
