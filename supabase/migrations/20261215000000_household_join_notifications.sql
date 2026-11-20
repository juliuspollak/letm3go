begin;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
 'feedback_new','feedback_reply','feedback_status','segment_submitted','poke',
 'segment_completed','segment_pb','segment_record','segment_changed','segment_removed','household_joined'));

create function public.notify_household_member_joined() returns trigger
language plpgsql security definer set search_path='' as $$
declare
 member_name text := coalesce(nullif(public.person_display_name(new.user_id),''),'A new member');
begin
 -- Serialize joins to the same household so a simultaneous join sees earlier committed members.
 perform 1 from public.households where id=new.household_id for no key update;
 -- One inbox entry for each current member other than the person joining.
 -- A newly created household has no other members to notify.
 insert into public.notifications(event_key,recipient_id,actor_id,kind,title,body,route)
 select 'household-join:'||new.household_id||':'||new.user_id||':'||extract(epoch from new.joined_at)::text||':'||m.user_id,
  m.user_id,new.user_id,'household_joined','Your household has a new member',
  left(member_name,100)||' joined your household. Say hello! 👋','{"screen":"household"}'::jsonb
 from public.household_memberships m
 where m.household_id=new.household_id and m.user_id<>new.user_id
 on conflict (event_key) do nothing;
 return null;
end $$;

revoke all on function public.notify_household_member_joined() from public,anon,authenticated;
create trigger notify_household_member_joined after insert on public.household_memberships
for each row execute function public.notify_household_member_joined();

commit;
