-- Friend location keeps publishing while the app is closed.
--
-- Household sharing already uses a device credential held in the phone's
-- Keychain. Friend sharing used the one-hour session token, so a phone that had
-- not been opened for an hour stopped publishing and friends saw an old place.
-- This gives friends the same credential, a capture time (so a position taken
-- while offline keeps its true age) and a 24 hour visibility window (so a
-- resting phone, which sends nothing, still shows its last place with its age).
begin;

alter table public.friend_presence_shares
 add column if not exists publish_token_hash bytea,
 add column if not exists publish_token_expires_at timestamptz;

-- Turning sharing off revokes the credential. Turning it on from the app does
-- not touch an existing credential.
create or replace function public.set_friend_location(p_enabled boolean,p_latitude double precision default null,p_longitude double precision default null,p_accuracy double precision default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_enabled and (p_latitude is null or p_longitude is null or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 or p_accuracy is null or p_accuracy not between 0 and 100) then
   raise exception 'A fresh accurate position is required'; end if;
 insert into public.friend_presence_shares(user_id,enabled,latitude,longitude,accuracy_m,updated_at)
 values(auth.uid(),p_enabled,case when p_enabled then p_latitude end,case when p_enabled then p_longitude end,case when p_enabled then p_accuracy end,case when p_enabled then now() end)
 on conflict(user_id) do update set enabled=excluded.enabled,latitude=excluded.latitude,longitude=excluded.longitude,accuracy_m=excluded.accuracy_m,updated_at=excluded.updated_at,
  publish_token_hash=case when excluded.enabled then friend_presence_shares.publish_token_hash end,
  publish_token_expires_at=case when excluded.enabled then friend_presence_shares.publish_token_expires_at end;
end $$;

-- A credential that can only publish the owner's own friend position. Only a
-- SHA-256 hash is stored; it expires after 30 days or when sharing is turned off.
create or replace function public.issue_my_friend_location_token()
returns table(publish_token text,valid_until timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_token text; v_until timestamptz:=now()+interval '30 days';
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 v_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 update public.friend_presence_shares
  set publish_token_hash=sha256(convert_to(v_token,'UTF8')),publish_token_expires_at=v_until
  where user_id=auth.uid() and enabled;
 if not found then raise exception 'Turn on friend location sharing first'; end if;
 return query select v_token,v_until;
end $$;

-- Publish with the device credential. Returns false (never an error) for an
-- unknown, expired or revoked credential so the phone can discard it. The
-- capture time only orders positions: it can never be in the future, and an
-- older position never replaces a newer one. It never re-enables sharing.
create or replace function public.publish_friend_location(
 p_token text,p_latitude double precision,p_longitude double precision,
 p_accuracy double precision default null,p_captured_at timestamptz default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_at timestamptz;
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
  set latitude=p_latitude,longitude=p_longitude,accuracy_m=p_accuracy,updated_at=v_at
  where user_id=v_user and (updated_at is null or updated_at<v_at);
 return true;
end $$;

-- A resting phone sends nothing, so its last place stays visible for a day with
-- its real age; the app shows it as "last seen", never as live.
create or replace function public.my_friend_locations()
returns table(user_id uuid,display_name text,latitude double precision,longitude double precision,updated_at timestamptz)
language sql security definer set search_path=public,pg_temp as $$
 select p.user_id,f.display_name::text,p.latitude,p.longitude,p.updated_at
 from public.my_friends() f join public.friend_presence_shares p on p.user_id=f.user_id
 where auth.uid() is not null and p.enabled and p.updated_at>now()-interval '24 hours' order by p.updated_at desc
$$;

revoke all on function public.issue_my_friend_location_token(),
 public.publish_friend_location(text,double precision,double precision,double precision,timestamptz) from public,anon,authenticated;
grant execute on function public.issue_my_friend_location_token() to authenticated;
grant execute on function public.publish_friend_location(text,double precision,double precision,double precision,timestamptz) to anon,authenticated;
commit;
