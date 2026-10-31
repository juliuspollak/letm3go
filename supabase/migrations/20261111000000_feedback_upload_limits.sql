-- Feedback photos: one size limit, and a five-photo limit that holds under concurrency.
--
-- The app and the bucket allowed 10 MiB while the attachment row stopped at 10,000,000
-- bytes, so a photo between the two uploaded and then failed to register.
--
-- Both photo counts read the rows committed so far, so uploads running side by side
-- each counted fewer than five and all passed. Each count now waits its turn on a lock
-- held to the end of the transaction, and is volatile so that it reads what the
-- previous holder committed: a stable function keeps the snapshot from before the wait.
--
-- Safe to re-run. Forward-only: nothing already applied is edited.
begin;

alter table public.feedback_attachments drop constraint if exists feedback_attachments_byte_size_check;
alter table public.feedback_attachments add constraint feedback_attachments_byte_size_check check(byte_size between 1 and 10485760);

create or replace function public.enforce_feedback_attachment_limit() returns trigger
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('feedback-photos:'||new.feedback_id::text,0));
 if (select count(*) from public.feedback_attachments where feedback_id=new.feedback_id and id<>new.id)>=5 then
  raise exception 'A feedback ticket can have up to 5 photos.' using errcode='22023';
 end if;
 return new;
end $$;

create or replace function public.can_write_feedback_object(p_name text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare parts text[]:=string_to_array(p_name,'/');
 uuid_pattern constant text:='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
 if auth.uid() is null or not public.account_is_active() then return false; end if;
 if coalesce(array_length(parts,1),0)<>3 or parts[1]<>auth.uid()::text
  or parts[2] !~ ('^'||uuid_pattern||'$') or parts[3] !~ ('^'||uuid_pattern||'\.jpg$') then return false; end if;
 if not exists(select 1 from public.feedback f where f.id=parts[2]::uuid and f.owner_id=auth.uid() and f.status<>'closed') then return false; end if;
 -- Taken only for the caller's own open ticket, so nobody can wait on another's lock.
 perform pg_advisory_xact_lock(hashtextextended('feedback-photos:'||parts[2],0));
 return (select count(*) from storage.objects o
  where o.bucket_id='feedback-attachments' and o.name like parts[1]||'/'||parts[2]||'/%' and o.name<>p_name)<5;
end $$;

do $$
begin
 if exists(select 1 from information_schema.schemata where schema_name='storage') then
  update storage.buckets set public=false,file_size_limit=10485760,allowed_mime_types=array['image/jpeg'] where id='feedback-attachments';
 end if;
end $$;
commit;
