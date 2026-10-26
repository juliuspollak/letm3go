-- Opt-in friend feed: summaries only, never paths, coordinates or private photos.
create table if not exists public.friend_shared_trips (
 owner_id uuid not null references auth.users(id) on delete cascade,
 trip_id text not null,
 title text not null check(length(title) between 1 and 150),
 activity text not null,
 started_at timestamptz not null,
 distance_km numeric(10,2),
 published_at timestamptz not null default now(),
 primary key(owner_id,trip_id)
);
alter table public.friend_shared_trips enable row level security;
revoke all on public.friend_shared_trips from anon,authenticated;
create or replace function public.publish_friend_trip(p_id text,p_title text,p_activity text,p_started_at timestamptz,p_distance_km numeric)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if length(p_id) not between 1 and 200 or length(trim(p_title)) not between 1 and 150 or length(p_activity)>50 or p_started_at>now()+interval '1 hour' or p_distance_km<0 then raise exception 'Invalid activity'; end if;
 insert into public.friend_shared_trips(owner_id,trip_id,title,activity,started_at,distance_km)
 values(auth.uid(),p_id,trim(p_title),p_activity,p_started_at,p_distance_km)
 on conflict(owner_id,trip_id) do update set title=excluded.title,activity=excluded.activity,started_at=excluded.started_at,distance_km=excluded.distance_km;
end $$;
create or replace function public.unpublish_friend_trip(p_id text)
returns void language sql security definer set search_path=public,pg_temp as $$
 delete from public.friend_shared_trips where owner_id=auth.uid() and trip_id=p_id
$$;
create or replace function public.my_friend_trip_feed()
returns table(owner_id uuid,display_name text,trip_id text,title text,activity text,started_at timestamptz,distance_km numeric)
language sql security definer set search_path=public,pg_temp as $$
 select t.owner_id,f.display_name::text,t.trip_id,t.title,t.activity,t.started_at,t.distance_km
 from public.my_friends() f join public.friend_shared_trips t on t.owner_id=f.user_id
 where auth.uid() is not null order by t.started_at desc limit 100
$$;
create or replace function public.my_published_friend_trip_ids()
returns table(trip_id text) language sql security definer set search_path=public,pg_temp as $$
 select t.trip_id from public.friend_shared_trips t where t.owner_id=auth.uid()
$$;
revoke all on function public.publish_friend_trip(text,text,text,timestamptz,numeric),public.unpublish_friend_trip(text),public.my_friend_trip_feed(),public.my_published_friend_trip_ids() from public;
grant execute on function public.publish_friend_trip(text,text,text,timestamptz,numeric),public.unpublish_friend_trip(text),public.my_friend_trip_feed(),public.my_published_friend_trip_ids() to authenticated;
