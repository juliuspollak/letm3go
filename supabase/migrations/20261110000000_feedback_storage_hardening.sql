-- Feedback photos: tie every stored object to a real ticket.
--
-- 20261109000000 only checked the first folder of the object key, so a signed-in
-- account could store any number of files under any name in its own folder, with no
-- ticket, and could delete an object whose attachment row still pointed at it. It
-- also let an account pending deletion keep writing.
--
-- Safe to re-run, and safe on a database where 20261109000000 was run by hand.
begin;

create or replace function public.can_write_feedback_object(p_name text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare parts text[]:=string_to_array(p_name,'/');
 uuid_pattern constant text:='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
 if auth.uid() is null or not public.account_is_active() then return false; end if;
 if coalesce(array_length(parts,1),0)<>3 or parts[1]<>auth.uid()::text
  or parts[2] !~ ('^'||uuid_pattern||'$') or parts[3] !~ ('^'||uuid_pattern||'\.jpg$') then return false; end if;
 if not exists(select 1 from public.feedback f where f.id=parts[2]::uuid and f.owner_id=auth.uid() and f.status<>'closed') then return false; end if;
 -- The attachment table caps registered photos at 5. This caps the objects themselves,
 -- so uploads that never register cannot grow without bound. Replacing one is allowed.
 return (select count(*) from storage.objects o
  where o.bucket_id='feedback-attachments' and o.name like parts[1]||'/'||parts[2]||'/%' and o.name<>p_name)<5;
end $$;

-- An object can be removed only while nothing refers to it: a failed registration
-- cleans up after itself, and a registered photo cannot be left pointing at nothing.
create or replace function public.can_delete_feedback_object(p_name text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.account_is_active()
  and split_part(p_name,'/',1)=auth.uid()::text
  and not exists(select 1 from public.feedback_attachments a where a.object_key=p_name)
$$;
revoke all on function public.can_write_feedback_object(text),public.can_delete_feedback_object(text) from public,anon,authenticated;
grant execute on function public.can_write_feedback_object(text),public.can_delete_feedback_object(text) to authenticated;

-- The app never deletes a registered attachment, and a client that did would strand
-- its object. Rows now leave only with their ticket.
drop policy if exists feedback_attachments_owner_delete on public.feedback_attachments;
revoke delete on public.feedback_attachments from authenticated;

do $$
begin
 if exists(select 1 from information_schema.schemata where schema_name='storage') then
  drop policy if exists "feedback attachments owner read" on storage.objects;
  drop policy if exists "feedback attachments owner insert" on storage.objects;
  drop policy if exists "feedback attachments owner update" on storage.objects;
  drop policy if exists "feedback attachments owner delete" on storage.objects;
  create policy "feedback attachments owner read" on storage.objects for select to authenticated
   using(bucket_id='feedback-attachments' and (select public.account_is_active()) and split_part(name,'/',1)=(select auth.uid())::text);
  create policy "feedback attachments owner insert" on storage.objects for insert to authenticated
   with check(bucket_id='feedback-attachments' and public.can_write_feedback_object(name));
  create policy "feedback attachments owner update" on storage.objects for update to authenticated
   using(bucket_id='feedback-attachments' and public.can_write_feedback_object(name))
   with check(bucket_id='feedback-attachments' and public.can_write_feedback_object(name));
  create policy "feedback attachments owner delete" on storage.objects for delete to authenticated
   using(bucket_id='feedback-attachments' and public.can_delete_feedback_object(name));
 end if;
end $$;
commit;
