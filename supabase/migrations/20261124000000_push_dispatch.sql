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
 if exists(select 1 from pg_available_extensions where name='pg_net') then create extension if not exists pg_net; end if;
 if exists(select 1 from pg_available_extensions where name='pg_cron') then create extension if not exists pg_cron; end if;
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
  execute 'select net.http_post(url:=$1,body:=$2,headers:=$3,timeout_milliseconds:=10000)'
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
