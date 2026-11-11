-- Periodic location check-ins for people who share their location.
--
-- A phone resting at home, school or work runs no location service, so it sends
-- nothing and viewers only see an ageing "last seen". iOS lets a closed app wake
-- itself only through events (movement, visits), never on a timer, so the server
-- does what Life360 does: every 15 minutes it sends a silent background push to
-- each sharer whose position has gone stale. The app wakes for a few seconds,
-- takes one location and publishes it with the credential in its Keychain.
--
-- Only people who are actively sharing (household or friends) with a current
-- signed-in session are woken, never more often than every 15 minutes, and not
-- once the position is a week old (an abandoned or switched-off phone). A
-- sharer who never published a position is not woken at all. The throttle is
-- 80% of the interval so a 15-minute schedule is never skipped by a claim made a
-- few hundred milliseconds later than the previous run.
begin;

create table if not exists public.location_checkins (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 last_sent_at timestamptz not null default now()
);
alter table public.location_checkins enable row level security;
revoke all on public.location_checkins from anon,authenticated;
grant all on public.location_checkins to service_role;

-- Claims the devices to wake and records the claim, so concurrent or repeated
-- calls cannot wake the same person twice in one interval.
create or replace function public.claim_location_checkins(p_stale interval default interval '15 minutes',p_batch integer default 100)
returns table(owner_id uuid,apns_token text,environment text)
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
begin
 return query
 with sharers as (
  select u.id as uid,
   greatest(h.location_at,f.updated_at) as newest
  from auth.users u
  left join public.household_live_locations h on h.user_id=u.id and h.enabled
   and exists(select 1 from public.household_memberships m where m.user_id=u.id)
  left join public.friend_presence_shares f on f.user_id=u.id and f.enabled
  where (h.user_id is not null or f.user_id is not null)
 ), due as (
  select s.uid from sharers s
  left join public.location_checkins c on c.owner_id=s.uid
  where s.newest<now()-p_stale and s.newest>now()-interval '7 days'
   and (c.last_sent_at is null or c.last_sent_at<now()-p_stale*0.8)
  order by s.newest nulls first limit p_batch
 ), marked as (
  insert into public.location_checkins(owner_id,last_sent_at)
  select uid,now() from due
  on conflict(owner_id) do update set last_sent_at=excluded.last_sent_at
  returning public.location_checkins.owner_id
 )
 select d.owner_id,d.apns_token,d.environment
 from marked mk cross join lateral public.eligible_push_devices(mk.owner_id) d;
end $$;
revoke all on function public.claim_location_checkins(interval,integer) from public,anon,authenticated;
grant execute on function public.claim_location_checkins(interval,integer) to service_role;

-- A claim that could not be delivered (the push provider rejected the key, the
-- network failed) is released so the next run retries instead of waiting out the
-- interval. Dead device tokens are removed by the worker instead.
create or replace function public.release_location_checkins(p_owners uuid[]) returns void
language sql security definer set search_path='' as $$
 delete from public.location_checkins where owner_id=any(p_owners)
$$;
revoke all on function public.release_location_checkins(uuid[]) from public,anon,authenticated;
grant execute on function public.release_location_checkins(uuid[]) to service_role;

-- Asks the push worker to send the check-ins. Never raises, like dispatch_push.
create or replace function public.dispatch_location_checkins() returns void
language plpgsql security definer set search_path='' as $$
declare target text; secret text;
begin
 begin
  execute $q$select (select decrypted_secret from vault.decrypted_secrets where name='push_worker_url'),
                    (select decrypted_secret from vault.decrypted_secrets where name='push_worker_secret')$q$ into target,secret;
 exception when others then return; end;
 if target is null or secret is null then return; end if;
 begin
  execute 'select net.http_post(url:=$1,body:=$2,headers:=$3,timeout_milliseconds:=30000)'
   using target,'{"mode":"checkin"}'::jsonb,jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret);
 exception when others then return; end;
end $$;
revoke all on function public.dispatch_location_checkins() from public,anon,authenticated;

do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.unschedule(jobid) from cron.job where jobname='letm3go-location-checkins';
  perform cron.schedule('letm3go-location-checkins','*/15 * * * *','select public.dispatch_location_checkins()');
 end if;
end $$;

commit;
