-- Optional precise household position, separate from coarse activity presence.
-- Apply manually to the current Supabase project. Do not replay historical migrations.
begin;
create table if not exists public.household_live_locations (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 latitude double precision,
 longitude double precision,
 accuracy_m double precision,
 speed_kmh double precision,
 updated_at timestamptz not null default now(),
 expires_at timestamptz,
 constraint live_lat check(latitude is null or latitude between -90 and 90),
 constraint live_lon check(longitude is null or longitude between -180 and 180),
 constraint live_accuracy check(accuracy_m is null or accuracy_m between 0 and 100),
 constraint live_speed check(speed_kmh is null or speed_kmh between 0 and 250)
);
alter table public.household_live_locations enable row level security;
revoke all on public.household_live_locations from public,anon,authenticated;
grant all on public.household_live_locations to service_role;

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
 insert into public.household_live_locations(user_id,enabled,latitude,longitude,accuracy_m,speed_kmh,expires_at,updated_at)
 values(auth.uid(),p_enabled,case when p_enabled then p_latitude end,case when p_enabled then p_longitude end,
 case when p_enabled then p_accuracy end,case when p_enabled then p_speed end,
 case when p_enabled and p_latitude is not null then now()+interval '90 seconds' end,now())
 on conflict(user_id) do update set enabled=excluded.enabled,latitude=excluded.latitude,
 longitude=excluded.longitude,accuracy_m=excluded.accuracy_m,speed_kmh=excluded.speed_kmh,
 expires_at=excluded.expires_at,updated_at=now();
end $$;

create or replace function public.my_live_location_settings()
returns table(enabled boolean) language sql stable security definer set search_path='' as $$
 select l.enabled from public.household_live_locations l where l.user_id=auth.uid()
$$;

create or replace function public.my_household_live_locations()
returns table(user_id uuid,display_name text,latitude double precision,longitude double precision,
 accuracy_m double precision,speed_kmh double precision,updated_at timestamptz)
language sql stable security definer set search_path='' as $$
 select l.user_id,
 coalesce(nullif(p.display_name,''),nullif(u.raw_user_meta_data->>'display_name',''),'Family member'),
 l.latitude,l.longitude,l.accuracy_m,l.speed_kmh,l.updated_at
 from public.household_memberships me
 join public.household_memberships member on member.household_id=me.household_id
 join public.household_live_locations l on l.user_id=member.user_id
 join auth.users u on u.id=l.user_id
 left join public.account_preferences p on p.user_id=l.user_id
 where me.user_id=auth.uid() and l.user_id<>auth.uid() and l.enabled
 and l.expires_at>now() and l.latitude is not null and l.longitude is not null
 order by l.updated_at desc limit 30
$$;
revoke all on function public.set_my_live_location(boolean,double precision,double precision,double precision,double precision),public.my_live_location_settings(),public.my_household_live_locations() from public,anon;
grant execute on function public.set_my_live_location(boolean,double precision,double precision,double precision,double precision),public.my_live_location_settings(),public.my_household_live_locations() to authenticated;
commit;
