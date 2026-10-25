-- Friendships are mutual and do not grant household membership or access to the garage.
begin;
create table public.friend_invites(
 token uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 expires_at timestamptz not null default now()+interval '48 hours',
 accepted_by uuid references auth.users(id) on delete set null,
 used_at timestamptz
);
create table public.friend_connections(
 user_low uuid not null references auth.users(id) on delete cascade,
 user_high uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(user_low,user_high),
 check(user_low<user_high)
);
alter table public.friend_invites enable row level security;
alter table public.friend_connections enable row level security;
revoke all on public.friend_invites,public.friend_connections from public,anon,authenticated;
create or replace function public.create_friend_invite()
returns uuid language plpgsql security definer set search_path='' as $$
declare code uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if (select count(*) from public.friend_invites where owner_id=auth.uid() and used_at is null and expires_at>now())>=10 then raise exception 'Too many open invitations'; end if;
 insert into public.friend_invites(owner_id) values(auth.uid()) returning token into code;
 return code;
end $$;
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
 update public.friend_invites set used_at=now(),accepted_by=auth.uid() where token=p_token;
end $$;
create or replace function public.my_friends()
returns table(user_id uuid,display_name text)
language sql stable security definer set search_path='' as $$
 select u.id,coalesce(nullif(p.display_name,''),nullif(u.raw_user_meta_data->>'display_name',''),'Friend')
 from public.friend_connections c
 join auth.users u on u.id=case when c.user_low=auth.uid() then c.user_high else c.user_low end
 left join public.account_preferences p on p.user_id=u.id
 where c.user_low=auth.uid() or c.user_high=auth.uid()
 order by 2,u.id
$$;
create or replace function public.remove_friend(p_friend uuid)
returns void language sql security definer set search_path='' as $$
 delete from public.friend_connections where
 user_low=least(auth.uid(),p_friend) and user_high=greatest(auth.uid(),p_friend)
 and auth.uid() is not null and p_friend<>auth.uid()
$$;
-- Presence is visible only while actively shared and fresh, to mutually accepted
-- friends OR current household members. Nothing confers activity or vehicle access.
create or replace function public.my_household_presence()
returns table(user_id uuid,display_name text,activity_label text,place_label text,updated_at timestamptz)
language sql stable security definer set search_path='' as $$
 select p.user_id,coalesce(nullif(pref.display_name,''),nullif(u.raw_user_meta_data->>'display_name',''),'Friend'),
 p.activity_label,p.place_label,p.updated_at
 from public.household_presence p
 join auth.users u on u.id=p.user_id
 left join public.account_preferences pref on pref.user_id=p.user_id
 where auth.uid() is not null and p.user_id<>auth.uid() and p.sharing_enabled
 and p.activity_label is not null and p.expires_at>now()
 and (
   exists(select 1 from public.household_memberships me join public.household_memberships other on other.household_id=me.household_id where me.user_id=auth.uid() and other.user_id=p.user_id)
   or exists(select 1 from public.friend_connections c where c.user_low=least(auth.uid(),p.user_id) and c.user_high=greatest(auth.uid(),p.user_id))
 )
 order by p.updated_at desc limit 50
$$;
revoke all on function public.create_friend_invite(),public.accept_friend_invite(uuid),public.my_friends(),public.remove_friend(uuid) from public,anon;
grant execute on function public.create_friend_invite(),public.accept_friend_invite(uuid),public.my_friends(),public.remove_friend(uuid) to authenticated;
commit;
