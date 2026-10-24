-- Proposed and locally tested only. Requires explicit remote deployment approval.
begin;
create table public.account_preferences (
 user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
 display_name text not null default '' check(length(display_name)<=100),
 onboarding_step integer not null default 0 check(onboarding_step between 0 and 5),
 onboarding_complete boolean not null default false
);
alter table public.account_preferences enable row level security;
revoke all on public.account_preferences from anon,authenticated;
grant select,insert,update,delete on public.account_preferences to authenticated;
create policy account_preferences_owner on public.account_preferences for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create table public.households (id uuid primary key default gen_random_uuid(),name text not null check(length(name) between 1 and 100),created_at timestamptz not null default now());
create table public.household_memberships (
 user_id uuid primary key references auth.users(id) on delete cascade,household_id uuid not null references public.households(id) on delete cascade,
 role text not null check(role in ('owner','member')),joined_at timestamptz not null default now()
);
create unique index one_household_owner on public.household_memberships(household_id) where role='owner';
create index household_member_lookup on public.household_memberships(household_id,user_id);
create table public.household_invitations (
 token uuid primary key default gen_random_uuid(),household_id uuid not null references public.households(id) on delete cascade,
 created_by uuid references auth.users(id) on delete set null,expires_at timestamptz not null default now()+interval '48 hours',used_at timestamptz
);
alter table public.households enable row level security;
alter table public.household_memberships enable row level security;
alter table public.household_invitations enable row level security;
revoke all on public.households,public.household_memberships,public.household_invitations from anon,authenticated;
-- Only definer RPCs can change membership/invitations; accepting an invite grants no journey access.
create or replace function public.my_household() returns table(id uuid,name text,role text)
language sql stable security definer set search_path='' as $$
 select h.id,h.name,m.role from public.households h join public.household_memberships m on m.household_id=h.id where m.user_id=auth.uid()
$$;
create or replace function public.create_household(p_name text) returns table(id uuid,name text,role text)
language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
 if auth.uid() is null or length(trim(p_name)) not between 1 and 100 then raise exception 'Sign in and enter a valid household name'; end if;
 if exists(select 1 from public.household_memberships where user_id=auth.uid()) then raise exception 'Already a household member'; end if;
 insert into public.households(name) values(trim(p_name)) returning households.id into new_id;
 insert into public.household_memberships(user_id,household_id,role) values(auth.uid(),new_id,'owner');
 return query select * from public.my_household();
end $$;
create or replace function public.invite_to_household() returns uuid
language plpgsql security definer set search_path='' as $$
declare household uuid; code uuid;
begin
 select household_id into household from public.household_memberships where user_id=auth.uid() and role='owner';
 if household is null then raise exception 'Household owner required'; end if;
 if (select count(*) from public.household_invitations where household_id=household and used_at is null and expires_at>now())>=20 then raise exception 'Invitation limit reached'; end if;
 insert into public.household_invitations(household_id,created_by) values(household,auth.uid()) returning token into code;return code;
end $$;
create or replace function public.accept_household_invitation(p_token uuid) returns table(id uuid,name text,role text)
language plpgsql security definer set search_path='' as $$
declare invite public.household_invitations;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select * into invite from public.household_invitations where token=p_token and used_at is null and expires_at>now() for update;
 if not found then raise exception 'Invitation invalid or expired'; end if;
 insert into public.household_memberships(user_id,household_id,role) values(auth.uid(),invite.household_id,'member');
 insert into public.trusted_contacts(owner_id,recipient_id,relation)
 select user_id,auth.uid(),'household' from public.household_memberships where household_id=invite.household_id and user_id<>auth.uid()
 union all select auth.uid(),user_id,'household' from public.household_memberships where household_id=invite.household_id and user_id<>auth.uid()
 on conflict do nothing;
 update public.household_invitations set used_at=now() where token=p_token;
 return query select * from public.my_household();
end $$;
create or replace function public.household_members() returns table(user_id uuid,display_name text,role text)
language sql stable security definer set search_path='' as $$
 select m.user_id,coalesce(nullif(p.display_name,''),nullif(u.raw_user_meta_data->>'display_name',''),u.raw_user_meta_data->'letm3go_onboarding_v1'->>'display_name',u.raw_user_meta_data->>'full_name',''),m.role from public.household_memberships m
 left join public.account_preferences p on p.user_id=m.user_id
 join auth.users u on u.id=m.user_id
 where m.household_id=(select household_id from public.household_memberships where household_memberships.user_id=auth.uid())
$$;
create or replace function public.repair_household() returns trigger language plpgsql security definer set search_path='' as $$
declare successor uuid;
begin
 delete from public.trusted_contacts where relation='household' and (
  (owner_id=old.user_id and recipient_id in(select user_id from public.household_memberships where household_id=old.household_id)) or
  (recipient_id=old.user_id and owner_id in(select user_id from public.household_memberships where household_id=old.household_id))
 );
 if not exists(select 1 from public.household_memberships where household_id=old.household_id) then delete from public.households where id=old.household_id;
 elsif old.role='owner' then
  select user_id into successor from public.household_memberships where household_id=old.household_id order by joined_at,user_id limit 1;
  update public.household_memberships set role='owner' where user_id=successor;
 end if;return old;
end $$;
create trigger repair_household after delete on public.household_memberships for each row execute function public.repair_household();
create or replace function public.leave_household() returns void language plpgsql security definer set search_path='' as $$
begin delete from public.household_memberships where user_id=auth.uid(); end $$;
revoke all on function public.my_household(),public.create_household(text),public.invite_to_household(),public.accept_household_invitation(uuid),public.household_members(),public.leave_household() from public,anon;
grant execute on function public.my_household(),public.create_household(text),public.invite_to_household(),public.accept_household_invitation(uuid),public.household_members(),public.leave_household() to authenticated;

create table public.push_devices (
 installation_id uuid primary key,owner_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null,apns_token text not null check(length(apns_token) between 32 and 256),
 environment text not null check(environment in ('sandbox','production')),updated_at timestamptz not null default now()
);
alter table public.push_devices enable row level security;
revoke all on public.push_devices from anon,authenticated;
grant all on public.push_devices to service_role;
create or replace function public.register_push_device(p_installation uuid,p_token text,p_environment text,p_owner uuid) returns void
language plpgsql security definer set search_path='' as $$
declare session uuid;
begin
 session:=(auth.jwt()->>'session_id')::uuid;
 if auth.uid() is null or auth.uid()<>p_owner or not exists(select 1 from auth.sessions where id=session and user_id=auth.uid()) then raise exception 'A current authenticated session is required'; end if;
 insert into public.push_devices(installation_id,owner_id,session_id,apns_token,environment) values(p_installation,auth.uid(),session,p_token,p_environment)
 on conflict(installation_id) do update set owner_id=excluded.owner_id,session_id=excluded.session_id,apns_token=excluded.apns_token,environment=excluded.environment,updated_at=now()
 where push_devices.owner_id=auth.uid() or push_devices.apns_token=p_token;
 if not found then raise exception 'Installation ownership could not be verified'; end if;
end $$;
create or replace function public.unregister_push_device(p_installation uuid,p_owner uuid) returns void
language sql security definer set search_path='' as $$ delete from public.push_devices where installation_id=p_installation and owner_id=auth.uid() and owner_id=p_owner $$;
create or replace function public.eligible_push_devices(p_owner uuid) returns setof public.push_devices
language sql stable security definer set search_path='' as $$
 select d.* from public.push_devices d join auth.sessions s on s.id=d.session_id and s.user_id=d.owner_id where d.owner_id=p_owner
$$;
revoke all on function public.register_push_device(uuid,text,text,uuid),public.unregister_push_device(uuid,uuid),public.eligible_push_devices(uuid) from public,anon;
-- Hosted defaults grant authenticated separately; this lookup is service-only.
revoke all on function public.eligible_push_devices(uuid) from authenticated;
grant execute on function public.register_push_device(uuid,text,text,uuid),public.unregister_push_device(uuid,uuid) to authenticated;
grant execute on function public.eligible_push_devices(uuid) to service_role;

create table public.account_deletion_requests (
 owner_id uuid primary key references auth.users(id) on delete cascade,requested_at timestamptz not null default now()
);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon,authenticated;
grant all on public.account_deletion_requests to service_role;
create table public.provider_oauth_states (
 state_hash text primary key,owner_id uuid not null references auth.users(id) on delete cascade,
 expires_at timestamptz not null default now()+interval '10 minutes'
);
alter table public.provider_oauth_states enable row level security;
revoke all on public.provider_oauth_states from anon,authenticated;
grant all on public.provider_oauth_states to service_role;
create table public.provider_credentials (
 owner_id uuid not null references auth.users(id) on delete cascade,provider text not null check(provider in ('apple','tesla')),
 ciphertext text not null,updated_at timestamptz not null default now(),primary key(owner_id,provider)
);
alter table public.provider_credentials enable row level security;
revoke all on public.provider_credentials from anon,authenticated;
grant all on public.provider_credentials to service_role;
-- An Auth-user cascade must not attempt to recreate tombstones for a deleted owner.
create or replace function public.deleted_activity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from auth.users where id=old.owner_id) then
  insert into public.activity_tombstones(id,owner_id) values(old.id,old.owner_id) on conflict(id) do nothing;
 end if;return old;
end $$;
revoke all on function public.protect_activity(),public.deleted_activity(),public.deleted_media(),public.places_changed(),public.repair_household() from public,anon,authenticated;
commit;
