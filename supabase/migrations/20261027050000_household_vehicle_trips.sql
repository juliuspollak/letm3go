-- Household car trips only: linked vehicle required, members only, no route geometry/photos.
-- Household trips are intentionally separate from the opt-in Friends feed.
begin;
create table public.household_vehicle_trips (
 household_id uuid not null references public.households(id) on delete cascade,
 household_vehicle_id uuid not null references public.household_vehicles(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 trip_id text not null check(length(trip_id) between 1 and 200),
 title text not null check(length(trim(title)) between 1 and 150),
 started_at timestamptz not null,
 distance_km numeric(10,2) not null check(distance_km>=0),
 created_at timestamptz not null default now(),
 primary key(owner_id,trip_id)
);
create index household_vehicle_trips_recent on public.household_vehicle_trips(household_id,started_at desc);
alter table public.household_vehicle_trips enable row level security;
revoke all on public.household_vehicle_trips from public,anon,authenticated;
create or replace function public.publish_household_vehicle_trip(
 p_vehicle uuid,p_local_vehicle uuid,p_trip text,p_title text,p_started timestamptz,p_km numeric
) returns void language plpgsql security definer set search_path='' as $$
declare h uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select v.household_id into h
 from public.household_vehicle_links l
 join public.household_vehicles v on v.id=l.household_vehicle_id
 join public.household_memberships m on m.household_id=v.household_id and m.user_id=auth.uid()
 where l.household_vehicle_id=p_vehicle and l.local_vehicle_id=p_local_vehicle and l.user_id=auth.uid();
 if h is null then raise exception 'Link this car to your current household first'; end if;
 if p_trip is null or length(p_trip) not between 1 and 200 or p_title is null or length(trim(p_title)) not between 1 and 150 or
    p_started is null or p_started>now()+interval '1 hour' or p_km is null or p_km<0 or p_km>100000 then raise exception 'Invalid journey'; end if;
 insert into public.household_vehicle_trips(household_id,household_vehicle_id,owner_id,trip_id,title,started_at,distance_km)
 values(h,p_vehicle,auth.uid(),p_trip,trim(p_title),p_started,p_km)
 on conflict(owner_id,trip_id) do update set
 household_id=excluded.household_id, household_vehicle_id=excluded.household_vehicle_id,
 title=excluded.title,started_at=excluded.started_at,distance_km=excluded.distance_km;
end $$;
create or replace function public.my_household_vehicle_trip_feed()
returns table(trip_id text,title text,started_at timestamptz,distance_km numeric,vehicle_name text,driver_name text,owner_id uuid)
language sql stable security definer set search_path='' as $$
 select t.trip_id,t.title,t.started_at,t.distance_km,v.display_name,
 coalesce(nullif(p.display_name,''),nullif(u.raw_user_meta_data->>'display_name',''),'Household member'),t.owner_id
 from public.household_memberships m
 join public.household_vehicle_trips t on t.household_id=m.household_id
 join public.household_vehicles v on v.id=t.household_vehicle_id
 join auth.users u on u.id=t.owner_id
 left join public.account_preferences p on p.user_id=t.owner_id
 where m.user_id=auth.uid()
 order by t.started_at desc limit 200
$$;
create or replace function public.unpublish_household_vehicle_trip(p_trip text) returns void
language sql security definer set search_path='' as $$
 delete from public.household_vehicle_trips where owner_id=auth.uid() and trip_id=p_trip
$$;
create or replace function public.my_published_household_trip_ids()
returns table(trip_id text) language sql security definer set search_path='' as $$
 select trip_id from public.household_vehicle_trips where owner_id=auth.uid()
$$;
-- Leaving a household removes that former member's published summaries.
create or replace function public.cleanup_departing_household_trips()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 delete from public.household_vehicle_trips where owner_id=old.user_id and household_id=old.household_id;
 return old;
end $$;
create trigger cleanup_household_trips_on_leave before delete on public.household_memberships
for each row execute function public.cleanup_departing_household_trips();
revoke all on function public.publish_household_vehicle_trip(uuid,uuid,text,text,timestamptz,numeric),
 public.my_household_vehicle_trip_feed(),public.unpublish_household_vehicle_trip(text),public.my_published_household_trip_ids()
 from public,anon;
grant execute on function public.publish_household_vehicle_trip(uuid,uuid,text,text,timestamptz,numeric),
 public.my_household_vehicle_trip_feed(),public.unpublish_household_vehicle_trip(text),public.my_published_household_trip_ids()
 to authenticated;
commit;
