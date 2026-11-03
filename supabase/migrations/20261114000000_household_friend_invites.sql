-- A household is a group of friends. The organiser invites a friend by name, and the
-- friend decides: joining shares location with the household, so nobody is ever added
-- without accepting. Friendship and household membership stay separate permissions,
-- and nothing here changes what either one exposes.
begin;
create table public.household_friend_invites(
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 invited_by uuid not null references auth.users(id) on delete cascade,
 friend_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 unique(household_id,friend_id)
);
create index household_friend_invites_friend on public.household_friend_invites(friend_id);
alter table public.household_friend_invites enable row level security;
revoke all on public.household_friend_invites from public,anon,authenticated;

create or replace function public.invite_friend_to_household(p_friend uuid)
returns void language plpgsql security definer set search_path='' as $$
declare household uuid;
begin
 if not public.account_is_active() then raise exception 'Account unavailable'; end if;
 select household_id into household from public.household_memberships where user_id=auth.uid() and role='owner';
 if household is null then raise exception 'Household owner required'; end if;
 if not exists(select 1 from public.friend_connections where user_low=least(auth.uid(),p_friend) and user_high=greatest(auth.uid(),p_friend)) then raise exception 'Friends only'; end if;
 if exists(select 1 from public.household_memberships where user_id=p_friend) then raise exception 'Already in a household'; end if;
 if (select count(*) from public.household_friend_invites where household_id=household)>=20 then raise exception 'Invitation limit reached'; end if;
 insert into public.household_friend_invites(household_id,invited_by,friend_id) values(household,auth.uid(),p_friend) on conflict do nothing;
end $$;

-- Who the organiser is waiting on.
create or replace function public.my_household_friend_invites()
returns table(friend_id uuid) language sql stable security definer set search_path='' as $$
 select i.friend_id from public.household_friend_invites i
 where public.account_is_active() and i.household_id=(select household_id from public.household_memberships where user_id=auth.uid() and role='owner')
$$;

-- What is waiting for this person to answer.
create or replace function public.my_household_requests()
returns table(id uuid,household_name text,invited_by_name text)
language sql stable security definer set search_path='' as $$
 select i.id,h.name,public.person_display_name(i.invited_by)
 from public.household_friend_invites i join public.households h on h.id=i.household_id
 where public.account_is_active() and i.friend_id=auth.uid()
 order by i.created_at
$$;

create or replace function public.respond_household_request(p_id uuid,p_accept boolean)
returns void language plpgsql security definer set search_path='' as $$
declare invite public.household_friend_invites;
begin
 if not public.account_is_active() then raise exception 'Account unavailable'; end if;
 select * into invite from public.household_friend_invites where id=p_id and friend_id=auth.uid() for update;
 if not found then raise exception 'Invitation invalid or expired'; end if;
 if p_accept then
  if exists(select 1 from public.household_memberships where user_id=auth.uid()) then raise exception 'Already in a household'; end if;
  insert into public.household_memberships(user_id,household_id,role) values(auth.uid(),invite.household_id,'member');
  insert into public.trusted_contacts(owner_id,recipient_id,relation)
  select user_id,auth.uid(),'household' from public.household_memberships where household_id=invite.household_id and user_id<>auth.uid()
  union all select auth.uid(),user_id,'household' from public.household_memberships where household_id=invite.household_id and user_id<>auth.uid()
  on conflict do nothing;
  delete from public.household_friend_invites where friend_id=auth.uid();
 else
  delete from public.household_friend_invites where id=p_id;
 end if;
end $$;

revoke all on function public.invite_friend_to_household(uuid),public.my_household_friend_invites(),public.my_household_requests(),public.respond_household_request(uuid,boolean) from public,anon;
grant execute on function public.invite_friend_to_household(uuid),public.my_household_friend_invites(),public.my_household_requests(),public.respond_household_request(uuid,boolean) to authenticated;
commit;
