-- Server-side push dispatch. The outbox (20261123000000) is unchanged; this only
-- decides who calls send-push-notifications, so pushes are sent while every app is
-- closed. ImBored calls the same worker from a GitHub Actions schedule, which GitHub
-- runs hours apart in practice; here the database calls it instead:
--
--   * immediately, once per statement that adds notifications (pg_net, async), and
--   * every 5 minutes, only when a delivery is due (retries, expired leases, a
--     dispatch that failed). An idle outbox costs one indexed query, no request.
--
-- The worker URL and its bearer secret live in Vault ('push_worker_url',
-- 'push_worker_secret'); the same secret is the function's PUSH_WORKER_SECRET.
-- pg_net sends after the transaction commits, so the worker sees the new rows.
-- Until both are set, dispatch does nothing and notifications simply wait.
begin;

do $$ begin
 -- Supabase's convention: extension objects in 'extensions' (pg_net's functions
 -- still live in its own 'net' schema; pg_cron's in 'cron').
 if exists(select 1 from pg_available_extensions where name='pg_net') then create extension if not exists pg_net with schema extensions; end if;
 if exists(select 1 from pg_available_extensions where name='pg_cron') then create extension if not exists pg_cron with schema pg_catalog; end if;
end $$;

-- One asynchronous request to the worker per transaction (feedback to several admins
-- is one call, not one per admin). Never raises: a failed dispatch leaves the rows
-- queued for the recovery check, and must not roll back the poke or feedback.
create or replace function public.dispatch_push() returns void
language plpgsql security definer set search_path='' as $$
declare target text; secret text;
begin
 if current_setting('letm3go.push_dispatched',true)='1' then return; end if;
 begin
  execute $q$select (select decrypted_secret from vault.decrypted_secrets where name='push_worker_url'),
                    (select decrypted_secret from vault.decrypted_secrets where name='push_worker_secret')$q$ into target,secret;
 exception when others then return; end;
 if target is null or secret is null then return; end if;
 perform set_config('letm3go.push_dispatched','1',true);
 begin
  execute 'select net.http_post(url:=$1,body:=$2,headers:=$3,timeout_milliseconds:=30000)'
   using target,'{}'::jsonb,jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret);
 exception when others then return; end;
end $$;
revoke all on function public.dispatch_push() from public,anon,authenticated;

create or replace function public.dispatch_new_notifications() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform public.dispatch_push(); return null; end $$;
revoke all on function public.dispatch_new_notifications() from public,anon,authenticated;
drop trigger if exists dispatch_new_notifications on public.notifications;
create trigger dispatch_new_notifications after insert on public.notifications
 for each statement execute function public.dispatch_new_notifications();

-- Fan-out fix. The 20261123 claim inserted deliveries for the unprocessed
-- notifications, then marked *all* unprocessed ones processed in a second
-- statement. A notification committed between the two statements was marked
-- processed with no delivery and never pushed. Now the batch is locked first and
-- exactly that batch is fanned out and marked; concurrent workers skip it.
create or replace function public.claim_push_deliveries(p_batch integer default 20)
returns table(delivery_id bigint,claim_token uuid,apns_token text,environment text,notification_id bigint,kind text,title text,body text,route jsonb,badge integer)
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare due bigint[];
begin
 select coalesce(array_agg(n.id),'{}') into due from (
  select id from public.notifications where push_processed_at is null order by id limit 500 for update skip locked) n;
 insert into public.notification_deliveries(notification_id,installation_id)
  select n.id,d.installation_id from public.notifications n
  join public.push_devices d on d.owner_id=n.recipient_id
  join auth.sessions s on s.id=d.session_id and s.user_id=d.owner_id
  -- Already seen in the app (or too old to matter): no push for it.
  where n.id=any(due) and n.read_at is null and n.created_at>now()-interval '1 day'
 on conflict do nothing;
 update public.notifications set push_processed_at=now() where id=any(due);
 -- A push not delivered within a day is no longer worth sending.
 update public.notification_deliveries set status='failed',claim_token=null,lease_expires_at=null,last_reason='Expired'
  where status in ('pending','retry','sending') and notification_id in (select id from public.notifications where created_at<now()-interval '1 day');
 update public.notification_deliveries set status='failed',claim_token=null,lease_expires_at=null,last_reason='LeaseExpiredAfterMaxAttempts'
  where status='sending' and lease_expires_at<=now() and attempt_count>=5;
 return query
 with claimed as (
  select x.id from public.notification_deliveries x
  where ((x.status in ('pending','retry') and x.next_attempt_at<=now()) or (x.status='sending' and x.lease_expires_at<=now())) and x.attempt_count<5
  order by x.id for update skip locked limit greatest(1,least(coalesce(p_batch,20),50))
 ), updated as (
  update public.notification_deliveries x set status='sending',attempt_count=x.attempt_count+1,
   lease_expires_at=now()+interval '2 minutes',claim_token=gen_random_uuid()
  from claimed where x.id=claimed.id returning x.*
 )
 select u.id,u.claim_token,d.apns_token,d.environment,n.id,n.kind,n.title,n.body,n.route,
  (select count(*)::integer from public.notifications r where r.recipient_id=n.recipient_id and r.read_at is null)
 from updated u join public.push_devices d on d.installation_id=u.installation_id join public.notifications n on n.id=u.notification_id;
end $$;
revoke all on function public.claim_push_deliveries(integer) from public,anon,authenticated;
grant execute on function public.claim_push_deliveries(integer) to service_role;

-- The recovery check: call the worker only when something is due.
create or replace function public.dispatch_due_pushes() returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.notifications where push_processed_at is null and read_at is null and created_at>now()-interval '1 day')
  or exists(select 1 from public.notification_deliveries where attempt_count<5 and (
   (status in ('pending','retry') and next_attempt_at<=now()) or (status='sending' and lease_expires_at<=now()))) then
  perform public.dispatch_push();
  return true;
 end if;
 return false;
end $$;
revoke all on function public.dispatch_due_pushes() from public,anon,authenticated;

do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.unschedule(jobid) from cron.job where jobname='letm3go-push-recovery';
  perform cron.schedule('letm3go-push-recovery','*/5 * * * *','select public.dispatch_due_pushes()');
 end if;
end $$;

commit;
