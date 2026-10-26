-- Friend-only visibility: separate from household and disabled by default.
-- Requires the existing my_friends() RPC returning user_id.
create table if not exists public.friend_presence_shares (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 latitude double precision,
 longitude double precision,
 accuracy_m double precision,
 updated_at timestamptz,
 constraint friend_position_valid check ((latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180))
);
alter table public.friend_presence_shares enable row level security;
revoke all on public.friend_presence_shares from anon, authenticated;
create or replace function public.set_friend_location(p_enabled boolean,p_latitude double precision default null,p_longitude double precision default null,p_accuracy double precision default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_enabled and (p_latitude is null or p_longitude is null or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 or p_accuracy is null or p_accuracy not between 0 and 100) then
   raise exception 'A fresh accurate position is required'; end if;
 insert into public.friend_presence_shares(user_id,enabled,latitude,longitude,accuracy_m,updated_at)
 values(auth.uid(),p_enabled,case when p_enabled then p_latitude end,case when p_enabled then p_longitude end,case when p_enabled then p_accuracy end,case when p_enabled then now() end)
 on conflict(user_id) do update set enabled=excluded.enabled,latitude=excluded.latitude,longitude=excluded.longitude,accuracy_m=excluded.accuracy_m,updated_at=excluded.updated_at;
end $$;
create or replace function public.my_friend_locations()
returns table(user_id uuid,display_name text,latitude double precision,longitude double precision,updated_at timestamptz)
language sql security definer set search_path=public,pg_temp as $$
 select p.user_id,f.display_name::text,p.latitude,p.longitude,p.updated_at
 from public.my_friends() f join public.friend_presence_shares p on p.user_id=f.user_id
 where auth.uid() is not null and p.enabled and p.updated_at>now()-interval '30 minutes' order by p.updated_at desc
$$;
create or replace function public.my_friend_location_setting()
returns boolean language sql security definer set search_path=public,pg_temp as $$
 select coalesce((select enabled from public.friend_presence_shares where user_id=auth.uid()),false)
$$;
revoke all on function public.set_friend_location(boolean,double precision,double precision,double precision), public.my_friend_locations(), public.my_friend_location_setting() from public;
grant execute on function public.set_friend_location(boolean,double precision,double precision,double precision), public.my_friend_locations(), public.my_friend_location_setting() to authenticated;
