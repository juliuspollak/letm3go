-- Feedback & Support: private, owner-scoped tickets with optional screenshot evidence.
-- Review and apply through the normal migration pipeline; this file does not deploy itself.
begin;

create table public.feedback (
 id uuid primary key default gen_random_uuid(),
 -- The client generates this token once per draft so a network retry cannot create a duplicate.
 client_token uuid not null unique,
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 category text not null check(category in ('bug','idea','improvement','other')),
 title text not null default '' check(length(title)<=120),
 description text not null check(length(btrim(description)) between 1 and 4000),
 what_happened text check(what_happened is null or length(what_happened)<=2000),
 expected_behaviour text check(expected_behaviour is null or length(expected_behaviour)<=2000),
 steps_to_reproduce text check(steps_to_reproduce is null or length(steps_to_reproduce)<=2000),
 -- Diagnostics are opt-in and must stay small. The client never sends routes or coordinates.
 diagnostics jsonb check(diagnostics is null or (jsonb_typeof(diagnostics)='object' and pg_column_size(diagnostics)<=20000)),
 app_version text check(app_version is null or length(app_version)<=40),
 build_number text check(build_number is null or length(build_number)<=40),
 platform text check(platform is null or length(platform)<=40),
 status text not null default 'open' check(status in ('open','in_review','resolved','closed')),
 user_seen_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index feedback_owner_timeline on public.feedback(owner_id,created_at desc);
create index feedback_open_queue on public.feedback(status,created_at) where status in ('open','in_review');

create table public.feedback_messages (
 id uuid primary key default gen_random_uuid(),
 feedback_id uuid not null references public.feedback(id) on delete cascade,
 author_id uuid references auth.users(id) on delete set null,
 is_staff boolean not null default false,
 body text not null check(length(btrim(body)) between 1 and 4000),
 created_at timestamptz not null default now(),
 check(is_staff or author_id is not null)
);
create index feedback_messages_timeline on public.feedback_messages(feedback_id,created_at);

create table public.feedback_attachments (
 -- The client chooses the ID so a retried upload writes the same object key.
 id uuid primary key,
 feedback_id uuid not null references public.feedback(id) on delete cascade,
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 object_key text not null unique,
 mime_type text not null default 'image/jpeg' check(mime_type='image/jpeg'),
 byte_size integer not null check(byte_size between 1 and 10000000),
 width integer not null check(width between 1 and 10000),
 height integer not null check(height between 1 and 10000),
 created_at timestamptz not null default now(),
 check(object_key=owner_id::text||'/'||feedback_id::text||'/'||id::text||'.jpg')
);
create index feedback_attachments_ticket on public.feedback_attachments(feedback_id);

-- The client caps this too; the server cap keeps a retry loop from growing a ticket without bound.
create function public.enforce_feedback_attachment_limit() returns trigger
language plpgsql set search_path='' as $$
begin
 if (select count(*) from public.feedback_attachments where feedback_id=new.feedback_id and id<>new.id)>=5 then
  raise exception 'A feedback ticket can have up to 5 photos.' using errcode='22023';
 end if;
 return new;
end $$;
create trigger feedback_attachment_limit before insert or update on public.feedback_attachments
 for each row execute function public.enforce_feedback_attachment_limit();

alter table public.feedback enable row level security;
alter table public.feedback_messages enable row level security;
alter table public.feedback_attachments enable row level security;
-- Tickets and follow-ups are only written through the validated functions below.
revoke all on public.feedback,public.feedback_messages,public.feedback_attachments from public,anon,authenticated;
grant select on public.feedback,public.feedback_messages,public.feedback_attachments to authenticated;
-- Attachments are written directly by the client; the RLS policies below scope every row to its owner.
grant insert,update,delete on public.feedback_attachments to authenticated;
grant all on public.feedback,public.feedback_messages,public.feedback_attachments to service_role;

create policy feedback_owner_read on public.feedback for select to authenticated
 using(owner_id=(select auth.uid()));
create policy feedback_messages_owner_read on public.feedback_messages for select to authenticated
 using(exists(select 1 from public.feedback f where f.id=feedback_id and f.owner_id=(select auth.uid())));
create policy feedback_attachments_owner_read on public.feedback_attachments for select to authenticated
 using(owner_id=(select auth.uid()));
create policy feedback_attachments_owner_insert on public.feedback_attachments for insert to authenticated
 with check(owner_id=(select auth.uid()) and exists(
  select 1 from public.feedback f where f.id=feedback_id and f.owner_id=(select auth.uid())));
-- A retried upload upserts the same row; keep that retry scoped to the owner's own ticket.
create policy feedback_attachments_owner_update on public.feedback_attachments for update to authenticated
 using(owner_id=(select auth.uid()))
 with check(owner_id=(select auth.uid()) and exists(
  select 1 from public.feedback f where f.id=feedback_id and f.owner_id=(select auth.uid())));
create policy feedback_attachments_owner_delete on public.feedback_attachments for delete to authenticated
 using(owner_id=(select auth.uid()));
-- Pending account deletion must deny direct API access as well as function calls.
create policy account_active on public.feedback as restrictive for all to authenticated
 using((select public.account_is_active())) with check((select public.account_is_active()));
create policy account_active on public.feedback_messages as restrictive for all to authenticated
 using((select public.account_is_active())) with check((select public.account_is_active()));
create policy account_active on public.feedback_attachments as restrictive for all to authenticated
 using((select public.account_is_active())) with check((select public.account_is_active()));

create function public.submit_feedback(
 p_client_token uuid,
 p_category text,
 p_title text,
 p_description text,
 p_what_happened text default null,
 p_expected_behaviour text default null,
 p_steps_to_reproduce text default null,
 p_diagnostics jsonb default null,
 p_app_version text default null,
 p_build_number text default null,
 p_platform text default null
) returns public.feedback
language plpgsql security definer set search_path='' as $$
declare ticket public.feedback; existing public.feedback; description text:=btrim(coalesce(p_description,''));
begin
 if auth.uid() is null then raise exception 'Sign in to send feedback.' using errcode='42501'; end if;
 if not public.account_is_active() then raise exception 'This account is unavailable for writes.' using errcode='42501'; end if;
 if p_category is null or p_category not in ('bug','idea','improvement','other') then
  raise exception 'Choose a feedback category.' using errcode='22023';
 end if;
 if description='' or length(description)>4000 then
  raise exception 'Describe your feedback in 4,000 characters or fewer.' using errcode='22023';
 end if;
 if length(coalesce(p_title,''))>120 then raise exception 'Keep the title under 120 characters.' using errcode='22023'; end if;
 if p_diagnostics is not null and (jsonb_typeof(p_diagnostics)<>'object' or pg_column_size(p_diagnostics)>20000) then
  raise exception 'The diagnostic summary is invalid.' using errcode='22023';
 end if;
 -- Idempotency: a retry after a lost response returns the original ticket.
 select * into existing from public.feedback where client_token=p_client_token;
 if found then
  if existing.owner_id<>auth.uid() then raise exception 'This feedback receipt is not available.' using errcode='42501'; end if;
  return existing;
 end if;
 if not public.consume_operation('feedback:'||auth.uid()::text,20) then
  raise exception 'Too many feedback submissions. Please try again in an hour.' using errcode='54000';
 end if;
 insert into public.feedback(client_token,owner_id,category,title,description,what_happened,expected_behaviour,steps_to_reproduce,diagnostics,app_version,build_number,platform)
 values(p_client_token,auth.uid(),p_category,btrim(coalesce(p_title,'')),description,nullif(btrim(p_what_happened),''),nullif(btrim(p_expected_behaviour),''),nullif(btrim(p_steps_to_reproduce),''),p_diagnostics,nullif(btrim(p_app_version),''),nullif(btrim(p_build_number),''),nullif(btrim(p_platform),''))
 on conflict(client_token) do nothing
 returning * into ticket;
 if ticket.id is null then
  -- A concurrent request with the same token won the insert.
  select * into ticket from public.feedback where client_token=p_client_token and owner_id=auth.uid();
  if ticket.id is null then raise exception 'This feedback receipt is not available.' using errcode='42501'; end if;
 end if;
 return ticket;
end $$;

create function public.add_feedback_message(p_feedback_id uuid,p_body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare ticket public.feedback; message_id uuid; body text:=btrim(coalesce(p_body,''));
begin
 if auth.uid() is null then raise exception 'Sign in to reply.' using errcode='42501'; end if;
 if not public.account_is_active() then raise exception 'This account is unavailable for writes.' using errcode='42501'; end if;
 if body='' or length(body)>4000 then raise exception 'Write a reply of 4,000 characters or fewer.' using errcode='22023'; end if;
 select * into ticket from public.feedback where id=p_feedback_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Feedback not found.' using errcode='42501'; end if;
 if ticket.status='closed' then raise exception 'This conversation is closed. Send new feedback instead.' using errcode='22023'; end if;
 insert into public.feedback_messages(feedback_id,author_id,body) values(ticket.id,auth.uid(),body) returning id into message_id;
 update public.feedback set updated_at=now() where id=ticket.id;
 return message_id;
end $$;

create function public.mark_my_feedback_seen() returns integer
language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if auth.uid() is null or not public.account_is_active() then return 0; end if;
 update public.feedback f set user_seen_at=now()
 where f.owner_id=auth.uid() and exists(
  select 1 from public.feedback_messages m
  where m.feedback_id=f.id and m.is_staff and (f.user_seen_at is null or m.created_at>f.user_seen_at));
 get diagnostics changed=row_count;
 return changed;
end $$;

revoke all on function public.submit_feedback(uuid,text,text,text,text,text,text,jsonb,text,text,text) from public,anon,authenticated;
revoke all on function public.add_feedback_message(uuid,text) from public,anon,authenticated;
revoke all on function public.mark_my_feedback_seen() from public,anon,authenticated;
grant execute on function public.submit_feedback(uuid,text,text,text,text,text,text,jsonb,text,text,text) to authenticated;
grant execute on function public.add_feedback_message(uuid,text) to authenticated;
grant execute on function public.mark_my_feedback_seen() to authenticated;

-- Private bucket. Guarded so the same migration also runs in local database tests.
do $$
begin
 if exists(select 1 from information_schema.schemata where schema_name='storage') then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('feedback-attachments','feedback-attachments',false,10485760,array['image/jpeg'])
  on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='feedback attachments owner read') then
   execute 'create policy "feedback attachments owner read" on storage.objects for select to authenticated using(bucket_id=''feedback-attachments'' and (storage.foldername(name))[1]=(select auth.uid())::text)';
  end if;
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='feedback attachments owner insert') then
   execute 'create policy "feedback attachments owner insert" on storage.objects for insert to authenticated with check(bucket_id=''feedback-attachments'' and (storage.foldername(name))[1]=(select auth.uid())::text)';
  end if;
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='feedback attachments owner update') then
   execute 'create policy "feedback attachments owner update" on storage.objects for update to authenticated using(bucket_id=''feedback-attachments'' and (storage.foldername(name))[1]=(select auth.uid())::text)';
  end if;
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='feedback attachments owner delete') then
   execute 'create policy "feedback attachments owner delete" on storage.objects for delete to authenticated using(bucket_id=''feedback-attachments'' and (storage.foldername(name))[1]=(select auth.uid())::text)';
  end if;
 end if;
end $$;

commit;
