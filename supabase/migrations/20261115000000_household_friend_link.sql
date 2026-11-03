-- One invitation for new people. Sent from Friends it makes a friend. Sent from a
-- household it makes a friend who also joins that household. The invitee is told which
-- before accepting, because joining a household shares location with it.
begin;
alter table public.friend_invites add column household_id uuid references public.households(id) on delete cascade;

create or replace function public.create_household_friend_invite()
returns uuid language plpgsql security definer set search_path='' as $$
declare household uuid; code uuid;
begin
 if not public.account_is_active() then raise exception 'Account unavailable'; end if;
 select household_id into household from public.household_memberships where user_id=auth.uid() and role='owner';
 if household is null then raise exception 'Household owner required'; end if;
 if (select count(*) from public.friend_invites where owner_id=auth.uid() and used_at is null and expires_at>now())>=10 then raise exception 'Too many open invitations'; end if;
 insert into public.friend_invites(owner_id,household_id) values(auth.uid(),household) returning token into code;
 return code;
end $$;

-- What accepting this invitation would do, for the person about to accept it.
create or replace function public.friend_invite_preview(p_token uuid)
returns table(invited_by_name text,household_name text,can_join boolean)
language sql stable security definer set search_path='' as $$
 select public.person_display_name(i.owner_id),h.name,
  not exists(select 1 from public.household_memberships where user_id=auth.uid())
 from public.friend_invites i left join public.households h on h.id=i.household_id
 where public.account_is_active() and i.token=p_token and i.used_at is null and i.expires_at>now() and i.owner_id<>auth.uid()
$$;

create or replace function public.accept_friend_invite(p_token uuid)
returns void language plpgsql security definer set search_path='' as $$
declare invitation public.friend_invites;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select * into invitation from public.friend_invites where token=p_token and used_at is null and expires_at>now() for update;
 if not found or invitation.owner_id=auth.uid() then raise exception 'Invalid invitation'; end if;
 insert into public.friend_connections(user_low,user_high)
 values(least(auth.uid(),invitation.owner_id),greatest(auth.uid(),invitation.owner_id))
 on conflict do nothing;
 -- Someone already in a household stays there and is simply a friend, as the preview said.
 if invitation.household_id is not null and not exists(select 1 from public.household_memberships where user_id=auth.uid()) then
  insert into public.household_memberships(user_id,household_id,role) values(auth.uid(),invitation.household_id,'member');
  insert into public.trusted_contacts(owner_id,recipient_id,relation)
  select user_id,auth.uid(),'household' from public.household_memberships where household_id=invitation.household_id and user_id<>auth.uid()
  union all select auth.uid(),user_id,'household' from public.household_memberships where household_id=invitation.household_id and user_id<>auth.uid()
  on conflict do nothing;
  delete from public.household_friend_invites where friend_id=auth.uid();
 end if;
 update public.friend_invites set used_at=now(),accepted_by=auth.uid() where token=p_token;
end $$;

revoke all on function public.create_household_friend_invite(),public.friend_invite_preview(uuid) from public,anon;
grant execute on function public.create_household_friend_invite(),public.friend_invite_preview(uuid) to authenticated;
commit;
