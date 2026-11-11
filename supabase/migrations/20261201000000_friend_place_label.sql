-- Friends see "At School · since 8:46" instead of an ageing "last seen".
--
-- A resting phone sends nothing, and iOS wakes a closed app only for movement,
-- so a quiet phone means "still there". The phone therefore publishes, with its
-- position, the name of the saved place it is resting at, but only for a place
-- its owner switched on with "Show friends when I'm here" (off by default).
-- The name is the owner's own label for the place; coordinates are unchanged.
begin;

alter table public.saved_places
 add column if not exists share_with_friends boolean not null default false;

alter table public.friend_presence_shares
 add column if not exists place_name text check (place_name is null or length(place_name) between 1 and 100),
 add column if not exists place_since timestamptz;

-- The app also reports its position from the foreground every 30 seconds through
-- this session path, which carries no place. The label survives a position
-- within 300 m of the labelled one (the same stay) and is cleared by a position
-- anywhere else, so it always describes where the phone actually is.
create or replace function public.set_friend_location(p_enabled boolean,p_latitude double precision default null,p_longitude double precision default null,p_accuracy double precision default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_enabled and (p_latitude is null or p_longitude is null or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 or p_accuracy is null or p_accuracy not between 0 and 100) then
   raise exception 'A fresh accurate position is required'; end if;
 insert into public.friend_presence_shares(user_id,enabled,latitude,longitude,accuracy_m,updated_at)
 values(auth.uid(),p_enabled,case when p_enabled then p_latitude end,case when p_enabled then p_longitude end,case when p_enabled then p_accuracy end,case when p_enabled then now() end)
 on conflict(user_id) do update set enabled=excluded.enabled,latitude=excluded.latitude,longitude=excluded.longitude,accuracy_m=excluded.accuracy_m,updated_at=excluded.updated_at,
  place_name=case when excluded.enabled and friend_presence_shares.latitude is not null and friend_presence_shares.updated_at>now()-interval '24 hours'
   and sqrt(power((excluded.latitude-friend_presence_shares.latitude)*111320,2)+power((excluded.longitude-friend_presence_shares.longitude)*111320*cos(radians(excluded.latitude)),2))<=300
   then friend_presence_shares.place_name end,
  place_since=case when excluded.enabled and friend_presence_shares.latitude is not null and friend_presence_shares.updated_at>now()-interval '24 hours'
   and sqrt(power((excluded.latitude-friend_presence_shares.latitude)*111320,2)+power((excluded.longitude-friend_presence_shares.longitude)*111320*cos(radians(excluded.latitude)),2))<=300
   then friend_presence_shares.place_since end,
  publish_token_hash=case when excluded.enabled then friend_presence_shares.publish_token_hash end,
  publish_token_expires_at=case when excluded.enabled then friend_presence_shares.publish_token_expires_at end;
end $$;

drop function if exists public.publish_friend_location(text,double precision,double precision,double precision,timestamptz);
create or replace function public.publish_friend_location(
 p_token text,p_latitude double precision,p_longitude double precision,
 p_accuracy double precision default null,p_captured_at timestamptz default null,
 p_place_name text default null,p_place_since timestamptz default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_at timestamptz; v_name text:=nullif(btrim(p_place_name),'');
begin
 if p_token is null or length(p_token)<>64 then return false; end if;
 if p_latitude is null or p_longitude is null
  or p_latitude not between -90 and 90 or p_longitude not between -180 and 180
  or p_accuracy is null or p_accuracy not between 0 and 100
 then raise exception 'Invalid location'; end if;
 select s.user_id into v_user from public.friend_presence_shares s
  where s.publish_token_hash=sha256(convert_to(p_token,'UTF8'))
  and s.publish_token_expires_at>now() and s.enabled;
 if v_user is null then return false; end if;
 v_at:=least(coalesce(p_captured_at,now()),now());
 update public.friend_presence_shares
  set latitude=p_latitude,longitude=p_longitude,accuracy_m=p_accuracy,updated_at=v_at,
   place_name=left(v_name,100),
   place_since=case when v_name is null then null else least(coalesce(p_place_since,v_at),v_at) end
  where user_id=v_user and (updated_at is null or updated_at<v_at);
 return true;
end $$;

drop function if exists public.my_friend_locations();
create or replace function public.my_friend_locations()
returns table(user_id uuid,display_name text,latitude double precision,longitude double precision,updated_at timestamptz,place_name text,place_since timestamptz)
language sql security definer set search_path=public,pg_temp as $$
 select p.user_id,f.display_name::text,p.latitude,p.longitude,p.updated_at,p.place_name,p.place_since
 from public.my_friends() f join public.friend_presence_shares p on p.user_id=f.user_id
 where auth.uid() is not null and p.enabled and p.updated_at>now()-interval '24 hours' order by p.updated_at desc
$$;

revoke all on function public.publish_friend_location(text,double precision,double precision,double precision,timestamptz,text,timestamptz),
 public.my_friend_locations() from public,anon,authenticated;
grant execute on function public.publish_friend_location(text,double precision,double precision,double precision,timestamptz,text,timestamptz) to anon,authenticated;
grant execute on function public.my_friend_locations() to authenticated;
commit;
