-- Notifications: one inbox row per person per event, shown as the badge on the
-- profile bubble and delivered as an iOS push to that person's signed-in devices.
--
--   new feedback, or a sender's reply  -> every admin
--   staff reply, resolved or closed     -> the person who sent the feedback
--   trail or segment submitted          -> every moderator (admins moderate too)
--   poke from Home                      -> that friend or household member
--
-- Events are written by triggers in the same transaction as the change, so a
-- notification can never exist without its cause, or the cause without it. Push
-- delivery is an outbox (notification_deliveries) drained by the
-- send-push-notifications Edge Function, which the app wakes straight after an
-- action. There is no scheduled job: an undelivered push is retried on the next wake.
begin;

-- 1. One admin list. An app admin (feedback) is also a trail/segment moderator.
create or replace function public.is_moderator() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
  exists(select 1 from public.moderators where user_id=auth.uid())
  or exists(select 1 from public.app_admins where user_id=auth.uid()));
$$;

-- 2. The inbox.
create table if not exists public.notifications (
 id bigint generated always as identity primary key,
 -- Makes an event idempotent: a retried trigger or RPC cannot notify twice.
 event_key text not null unique check (char_length(event_key) between 3 and 200),
 recipient_id uuid not null references auth.users(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 kind text not null check (kind in ('feedback_new','feedback_reply','feedback_status','segment_submitted','poke')),
 title text not null check (char_length(title) between 1 and 80),
 body text not null check (char_length(body) between 1 and 180),
 -- Where tapping it goes. Small and fixed-shape: never user content.
 route jsonb not null default '{}' check (jsonb_typeof(route)='object' and octet_length(route::text)<=300),
 created_at timestamptz not null default now(),
 read_at timestamptz,
 push_processed_at timestamptz
);
create index if not exists notifications_unread on public.notifications(recipient_id,created_at desc) where read_at is null;
create index if not exists notifications_push_pending on public.notifications(id) where push_processed_at is null;
alter table public.notifications enable row level security;
revoke all on public.notifications from public,anon,authenticated;
grant select on public.notifications to authenticated;
grant all on public.notifications to service_role;
drop policy if exists notifications_recipient on public.notifications;
create policy notifications_recipient on public.notifications for select to authenticated using (recipient_id=(select auth.uid()));
drop policy if exists account_active on public.notifications;
create policy account_active on public.notifications as restrictive for select to authenticated using ((select public.account_is_active()));

-- 3. The push outbox: one row per notification per registered device.
create table if not exists public.notification_deliveries (
 id bigint generated always as identity primary key,
 notification_id bigint not null references public.notifications(id) on delete cascade,
 installation_id uuid not null references public.push_devices(installation_id) on delete cascade,
 status text not null default 'pending' check (status in ('pending','sending','sent','retry','failed')),
 attempt_count integer not null default 0 check (attempt_count between 0 and 5),
 next_attempt_at timestamptz not null default now(),
 lease_expires_at timestamptz,
 claim_token uuid,
 last_status integer,
 last_reason text check (last_reason is null or char_length(last_reason)<=160),
 sent_at timestamptz,
 unique (notification_id,installation_id),
 check ((status='sending')=(claim_token is not null and lease_expires_at is not null))
);
create index if not exists notification_deliveries_ready on public.notification_deliveries(next_attempt_at,id) where status in ('pending','retry','sending');
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from public,anon,authenticated;
grant all on public.notification_deliveries to service_role;

-- 4. Writing an event. Internal only: called by the triggers and send_poke below.
create or replace function public.notify(p_key text,p_recipient uuid,p_actor uuid,p_kind text,p_title text,p_body text,p_route jsonb default '{}')
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_recipient is null or p_recipient=p_actor then return; end if;
 insert into public.notifications(event_key,recipient_id,actor_id,kind,title,body,route)
 values(p_key,p_recipient,p_actor,p_kind,left(p_title,80),left(coalesce(nullif(btrim(p_body),''),p_title),180),coalesce(p_route,'{}'))
 on conflict (event_key) do nothing;
 -- Keep the inbox small without a cleanup job: read items older than 60 days go.
 delete from public.notifications where recipient_id=p_recipient and read_at is not null and read_at<now()-interval '60 days';
end $$;
revoke all on function public.notify(text,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;

create or replace function public.display_name_of(p_user uuid) returns text
language sql stable security definer set search_path='' as $$
 select coalesce(nullif(btrim((select display_name from public.profiles where id=p_user)),''),'Someone');
$$;
revoke all on function public.display_name_of(uuid) from public,anon,authenticated;

-- 5. Feedback.
create or replace function public.notify_feedback_created() returns trigger
language plpgsql security definer set search_path='' as $$
declare admin uuid;
begin
 for admin in select user_id from public.app_admins loop
  perform public.notify('feedback:'||new.id||':'||admin,admin,new.owner_id,'feedback_new','New feedback',
   public.display_name_of(new.owner_id)||': '||coalesce(nullif(btrim(new.title),''),left(new.description,120)),
   jsonb_build_object('screen','feedback','id',new.id));
 end loop;
 return null;
end $$;
revoke all on function public.notify_feedback_created() from public,anon,authenticated;
drop trigger if exists notify_feedback_created on public.feedback;
create trigger notify_feedback_created after insert on public.feedback for each row execute function public.notify_feedback_created();

create or replace function public.notify_feedback_message() returns trigger
language plpgsql security definer set search_path='' as $$
declare ticket public.feedback; admin uuid;
begin
 select * into ticket from public.feedback where id=new.feedback_id;
 if not found then return null; end if;
 if new.is_staff then
  perform public.notify('feedback-message:'||new.id,ticket.owner_id,new.author_id,'feedback_reply','Reply to your feedback',
   left(new.body,160),jsonb_build_object('screen','feedback','id',ticket.id));
 else
  for admin in select user_id from public.app_admins loop
   perform public.notify('feedback-message:'||new.id||':'||admin,admin,new.author_id,'feedback_new','New feedback reply',
    public.display_name_of(new.author_id)||': '||left(new.body,140),jsonb_build_object('screen','feedback','id',ticket.id));
  end loop;
 end if;
 return null;
end $$;
revoke all on function public.notify_feedback_message() from public,anon,authenticated;
drop trigger if exists notify_feedback_message on public.feedback_messages;
create trigger notify_feedback_message after insert on public.feedback_messages for each row execute function public.notify_feedback_message();

create or replace function public.notify_feedback_status() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status is distinct from old.status and new.status in ('resolved','closed') then
  perform public.notify('feedback-status:'||new.id||':'||new.status||':'||extract(epoch from now())::bigint,new.owner_id,auth.uid(),'feedback_status',
   case new.status when 'resolved' then 'Your feedback was resolved' else 'Your feedback was closed' end,
   coalesce(nullif(btrim(new.title),''),left(new.description,160)),jsonb_build_object('screen','feedback','id',new.id));
 end if;
 return null;
end $$;
revoke all on function public.notify_feedback_status() from public,anon,authenticated;
drop trigger if exists notify_feedback_status on public.feedback;
create trigger notify_feedback_status after update of status on public.feedback for each row execute function public.notify_feedback_status();

-- 6. Trails and segments waiting for review.
create or replace function public.notify_mtb_submitted() returns trigger
language plpgsql security definer set search_path='' as $$
declare reviewer uuid; item_name text;
begin
 if new.action<>'submitted' or new.target_kind not in ('trail','segment') then return null; end if;
 if new.target_kind='trail' then select name into item_name from public.mtb_trails where id=new.trail_id;
 else select name into item_name from public.mtb_segments where id=new.segment_id; end if;
 for reviewer in select user_id from public.moderators union select user_id from public.app_admins loop
  perform public.notify('mtb:'||new.id||':'||reviewer,reviewer,new.actor_id,'segment_submitted',
   case new.target_kind when 'trail' then 'New trail to review' else 'New segment to review' end,
   coalesce(item_name,'Unnamed')||' · '||public.display_name_of(new.actor_id),jsonb_build_object('screen','review'));
 end loop;
 return null;
end $$;
revoke all on function public.notify_mtb_submitted() from public,anon,authenticated;
drop trigger if exists notify_mtb_submitted on public.mtb_moderation_events;
create trigger notify_mtb_submitted after insert on public.mtb_moderation_events for each row execute function public.notify_mtb_submitted();

-- 7. Pokes: only between friends or members of the same household.
create table if not exists public.pokes (
 id bigint generated always as identity primary key,
 from_user uuid not null references auth.users(id) on delete cascade,
 to_user uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 check (from_user<>to_user)
);
create index if not exists pokes_pair on public.pokes(from_user,to_user,created_at desc);
alter table public.pokes enable row level security;
revoke all on public.pokes from public,anon,authenticated;
grant all on public.pokes to service_role;

create or replace function public.send_poke(p_to uuid) returns text
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); poke_id bigint; message text; name text;
 messages text[]:=array['%s poked you 👋','%s says hi 👋','%s is thinking of you 💭','%s says get moving 🚴','%s wants to know where you are 📍','%s sent you a high five ✋'];
begin
 if me is null or not public.account_is_active() then raise exception 'Sign in to poke someone.' using errcode='42501'; end if;
 if p_to is null or p_to=me then raise exception 'Choose someone to poke.' using errcode='22023'; end if;
 if not exists(select 1 from public.friend_connections where user_low=least(me,p_to) and user_high=greatest(me,p_to))
  and not exists(select 1 from public.household_memberships a join public.household_memberships b on b.household_id=a.household_id where a.user_id=me and b.user_id=p_to) then
  raise exception 'You can only poke friends and household members.' using errcode='42501';
 end if;
 if exists(select 1 from public.pokes where from_user=me and to_user=p_to and created_at>now()-interval '1 minute') then
  raise exception 'You just poked them. Try again in a minute.' using errcode='P0001';
 end if;
 if (select count(*) from public.pokes where from_user=me and created_at>now()-interval '1 hour')>=60 then
  raise exception 'That is a lot of pokes. Try again later.' using errcode='P0001';
 end if;
 delete from public.pokes where created_at<now()-interval '1 day';
 insert into public.pokes(from_user,to_user) values(me,p_to) returning id into poke_id;
 name:=public.display_name_of(me);
 message:=format(messages[1+floor(random()*array_length(messages,1))::int],name);
 perform public.notify('poke:'||poke_id,p_to,me,'poke','Poke',message,jsonb_build_object('screen','home','from',me));
 return message;
end $$;
revoke all on function public.send_poke(uuid) from public,anon,authenticated;
grant execute on function public.send_poke(uuid) to authenticated;

-- 8. Reading the inbox.
create or replace function public.mark_notifications_read(p_kinds text[] default null) returns integer
language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501'; end if;
 update public.notifications set read_at=now()
  where recipient_id=auth.uid() and read_at is null and (p_kinds is null or kind=any(p_kinds));
 get diagnostics changed=row_count;
 return changed;
end $$;
revoke all on function public.mark_notifications_read(text[]) from public,anon,authenticated;
grant execute on function public.mark_notifications_read(text[]) to authenticated;

-- 9. Push delivery, service role only. A device receives pushes only while the
--    session that registered it still exists (the existing push_devices binding).
create or replace function public.claim_push_deliveries(p_batch integer default 20)
returns table(delivery_id bigint,claim_token uuid,apns_token text,environment text,notification_id bigint,kind text,title text,body text,route jsonb,badge integer)
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
begin
 insert into public.notification_deliveries(notification_id,installation_id)
  select n.id,d.installation_id from public.notifications n
  join public.push_devices d on d.owner_id=n.recipient_id
  join auth.sessions s on s.id=d.session_id and s.user_id=d.owner_id
  -- Already seen in the app (or too old to matter): no push for it.
  where n.push_processed_at is null and n.read_at is null and n.created_at>now()-interval '1 day'
 on conflict do nothing;
 update public.notifications set push_processed_at=now() where push_processed_at is null;
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

create or replace function public.finish_push_delivery(p_delivery bigint,p_claim uuid,p_status text,p_http integer,p_reason text)
returns text language plpgsql security definer set search_path='' as $$
declare final text; device uuid;
begin
 if p_status not in ('sent','retry','failed','invalid_token') then raise exception 'Invalid delivery status.'; end if;
 final:=case when p_status='invalid_token' then 'failed'
  when p_status='retry' and (select attempt_count>=5 from public.notification_deliveries where id=p_delivery) then 'failed' else p_status end;
 update public.notification_deliveries set status=final,last_status=p_http,last_reason=left(coalesce(p_reason,'Unknown'),160),
  sent_at=case when final='sent' then now() else sent_at end,
  next_attempt_at=case when final='retry' then now()+interval '30 seconds'*power(2,greatest(0,attempt_count-1)) else next_attempt_at end,
  claim_token=null,lease_expires_at=null
 where id=p_delivery and status='sending' and claim_token=p_claim returning installation_id into device;
 if not found then return null; end if;
 -- Apple says the token is dead: forget the device; it re-registers on next launch.
 if p_status='invalid_token' then delete from public.push_devices where installation_id=device; end if;
 return final;
end $$;
revoke all on function public.finish_push_delivery(bigint,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.finish_push_delivery(bigint,uuid,text,integer,text) to service_role;

commit;
