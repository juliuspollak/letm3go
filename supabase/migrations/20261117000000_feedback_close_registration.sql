-- A Storage upload can finish before closure and register its row afterward.
-- Protect both photo and report registration with the ticket's row lock. FOR
-- SHARE conflicts with the status UPDATE in admin_set_feedback_status: either
-- registration commits first and closure deletes it, or closure wins and this
-- guard sees the closed status and rejects registration.
begin;

create or replace function public.require_open_feedback_ticket() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- This definer needs row-lock privileges, but must not let an untrusted caller
 -- acquire locks on another account's ticket before RLS checks the new row.
 if current_setting('role',true) in ('authenticated','anon') and
  (auth.uid() is distinct from new.owner_id or not public.account_is_active()) then
  raise exception 'Only the ticket owner may register feedback files.' using errcode='42501';
 end if;
 perform 1 from public.feedback f
  where f.id=new.feedback_id and f.owner_id=new.owner_id and f.status<>'closed'
   and f.deleted_at is null
  for share;
 if not found then
  raise exception 'Files can only be attached to an open feedback ticket.' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.require_open_feedback_ticket() from public,anon,authenticated;

drop trigger if exists feedback_attachment_open_ticket on public.feedback_attachments;
create trigger feedback_attachment_open_ticket before insert or update on public.feedback_attachments
 for each row execute function public.require_open_feedback_ticket();
drop trigger if exists feedback_report_open_ticket on public.feedback_reports;
create trigger feedback_report_open_ticket before insert or update on public.feedback_reports
 for each row execute function public.require_open_feedback_ticket();

-- Keep photo authorization consistent with reports. The trigger above supplies
-- the transactional lock; an EXISTS policy alone does not serialize with close.
drop policy if exists feedback_attachments_owner_insert on public.feedback_attachments;
create policy feedback_attachments_owner_insert on public.feedback_attachments for insert to authenticated
 with check(owner_id=(select auth.uid()) and exists(
  select 1 from public.feedback f where f.id=feedback_id and f.owner_id=(select auth.uid()) and f.status<>'closed'));
drop policy if exists feedback_attachments_owner_update on public.feedback_attachments;
create policy feedback_attachments_owner_update on public.feedback_attachments for update to authenticated
 using(owner_id=(select auth.uid()))
 with check(owner_id=(select auth.uid()) and exists(
  select 1 from public.feedback f where f.id=feedback_id and f.owner_id=(select auth.uid()) and f.status<>'closed'));
commit;
