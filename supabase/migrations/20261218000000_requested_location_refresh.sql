begin;

create schema if not exists location_private;
revoke all on schema location_private from public,anon,authenticated;

create function location_private.refresh_audience(p_viewer uuid,p_owners uuid[])
returns table(owner_id uuid)
language sql stable set search_path='' as $$
 select distinct candidate.owner_id
 from unnest(p_owners) as candidate(owner_id)
 where p_viewer is not null and candidate.owner_id<>p_viewer
 and (
  exists(
   select 1 from public.household_memberships viewer
   join public.household_memberships member on member.household_id=viewer.household_id
   join public.household_live_locations sharing on sharing.user_id=member.user_id and sharing.enabled
   where viewer.user_id=p_viewer and member.user_id=candidate.owner_id
  )
  or exists(
   select 1 from public.friend_connections connection
   join public.friend_presence_shares sharing on sharing.user_id=candidate.owner_id and sharing.enabled
   where connection.user_low=least(p_viewer,candidate.owner_id)
     and connection.user_high=greatest(p_viewer,candidate.owner_id)
  )
 )
$$;

-- Authenticated viewers can only enqueue requests for people sharing with them.
-- The same per-owner claim record applies across viewers and scheduled check-ins.
create function public.request_location_refresh(p_owners uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare
 viewer uuid := auth.uid();
 owners uuid[];
 target text;
 secret text;
begin
 if viewer is null then raise exception 'Sign in to request locations' using errcode='42501'; end if;
 if coalesce(cardinality(p_owners),0)=0 then return 0; end if;
 if cardinality(p_owners)>12 then raise exception 'Too many location requests' using errcode='22023'; end if;
 with claimed as (
  insert into public.location_checkins as c(owner_id,last_sent_at)
  select audience.owner_id,now()
  from location_private.refresh_audience(viewer,p_owners) audience
  where exists(select 1 from public.eligible_push_devices(audience.owner_id))
  order by audience.owner_id
  on conflict(owner_id) do update set last_sent_at=excluded.last_sent_at
   where c.last_sent_at<=now()-interval '15 minutes'
  returning c.owner_id
 )
 select array_agg(owner_id) into owners from claimed;
 if owners is null then return 0; end if;

 execute $q$select (select decrypted_secret from vault.decrypted_secrets where name='push_worker_url'),
                   (select decrypted_secret from vault.decrypted_secrets where name='push_worker_secret')$q$ into target,secret;
 if nullif(target,'') is null or nullif(secret,'') is null then
  raise exception 'Location refresh is unavailable';
 end if;
 execute 'select net.http_post(url:=$1,body:=$2,headers:=$3,timeout_milliseconds:=30000)'
 using target,jsonb_build_object('mode','requested-checkin','viewer',viewer,'owners',owners),
       jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret);
 return cardinality(owners);
end $$;

-- Only the worker can resolve device tokens. Recheck consent and membership
-- when it picks up the request so delayed work respects changes to either.
create function public.requested_location_refresh_devices(p_viewer uuid,p_owners uuid[])
returns table(owner_id uuid,apns_token text,environment text)
language sql stable security definer set search_path='' as $$
 select device.owner_id,device.apns_token,device.environment
 from location_private.refresh_audience(p_viewer,p_owners) audience
 cross join lateral public.eligible_push_devices(audience.owner_id) device
 where cardinality(p_owners)<=12
$$;

revoke all on function public.request_location_refresh(uuid[]),
 public.requested_location_refresh_devices(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.request_location_refresh(uuid[]) to authenticated;
grant execute on function public.requested_location_refresh_devices(uuid,uuid[]) to service_role;

commit;
