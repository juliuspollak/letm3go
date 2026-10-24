-- Local deployment-readiness corrections. Not applied remotely.
begin;
-- Supabase's hosted defaults grant EXECUTE to authenticated independently of PUBLIC.
revoke all on function public.eligible_push_devices(uuid) from public,anon,authenticated;
grant execute on function public.eligible_push_devices(uuid) to service_role;
revoke all on function public.revoke_activity_publication(uuid) from public,anon;
grant execute on function public.revoke_activity_publication(uuid) to authenticated;
revoke insert on public.profiles from authenticated;
grant insert(id,display_name) on public.profiles to authenticated;
grant all on public.profiles,public.account_preferences,public.households,public.household_memberships,public.household_invitations to service_role;

-- Explicit ownership constraints also protect service-role writes from application mistakes.
alter table public.activities add constraint activities_id_owner_unique unique(id,owner_id);
alter table public.saved_places add constraint saved_places_id_owner_unique unique(id,owner_id);
alter table public.media_assets add constraint media_activity_owner_fk foreign key(activity_id,owner_id) references public.activities(id,owner_id) on delete cascade;
alter table public.media_assets add constraint media_owner_key check(object_key=owner_id::text||'/'||activity_id::text||'/'||id::text||'.jpg');
create unique index vehicles_tesla_per_owner on public.vehicles(owner_id,tesla_vehicle_id);

-- Route samples already live in activities.route_points. Stops need separate private records.
create table public.activity_stops (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 activity_id uuid not null,
 saved_place_id uuid,
 label text not null default '' check(length(label)<=100),
 latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180),
 started_at timestamptz not null, ended_at timestamptz not null check(ended_at>=started_at),
 foreign key(activity_id,owner_id) references public.activities(id,owner_id) on delete cascade,
 foreign key(saved_place_id,owner_id) references public.saved_places(id,owner_id) on delete set null(saved_place_id)
);
alter table public.activity_stops enable row level security;
revoke all on public.activity_stops from public,anon,authenticated;
grant select,insert,update,delete on public.activity_stops to authenticated;
grant all on public.activity_stops to service_role;
create policy stops_owner on public.activity_stops for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));

create index stops_activity_timeline on public.activity_stops(activity_id,started_at,id);
create index stops_owner on public.activity_stops(owner_id);
create index stops_saved_place on public.activity_stops(saved_place_id,owner_id);
create index tombstones_owner on public.activity_tombstones(owner_id);
create index media_owner on public.media_assets(owner_id);
create index shared_journeys_owner on public.shared_journeys(owner_id);
create index contacts_recipient on public.trusted_contacts(recipient_id);
create index grants_recipient on public.activity_grants(recipient_id);
create index invitations_household_expiry on public.household_invitations(household_id,expires_at) where used_at is null;
create index invitations_household on public.household_invitations(household_id);
create index invitations_creator on public.household_invitations(created_by);
create index push_owner_session on public.push_devices(owner_id,session_id);
create index oauth_states_owner on public.provider_oauth_states(owner_id);
create index oauth_states_expiry on public.provider_oauth_states(expires_at);
create index budgets_expiry on public.operation_budgets(window_start);

-- Pending deletion must deny direct API access as well as frontend/Edge requests.
create function public.account_is_active() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from auth.users where id=auth.uid())
 and not exists(select 1 from public.account_deletion_requests where owner_id=auth.uid())
$$;
revoke all on function public.account_is_active() from public,anon,authenticated;
grant execute on function public.account_is_active() to authenticated,service_role;
do $$ declare table_name text; begin
 foreach table_name in array array['profiles','account_preferences','saved_places','vehicles','activities','activity_stops','media_assets','activity_tombstones','trusted_contacts','activity_grants','connected_services'] loop
  execute format('create policy account_active on public.%I as restrictive for all to authenticated using ((select public.account_is_active())) with check ((select public.account_is_active()))',table_name);
 end loop;
end $$;

-- Serialize metadata writes with the deletion freeze. After freeze, even service writes
-- must fail closed. R2 requests remain external: failed metadata inserts must remove uploads.
create function public.guard_owner_write() returns trigger language plpgsql security definer set search_path='' as $$
declare owner uuid;
begin
 owner:=(to_jsonb(new)->>TG_ARGV[0])::uuid;
 perform 1 from auth.users where id=owner for key share;
 if not found or exists(select 1 from public.account_deletion_requests where owner_id=owner) then raise exception 'Account unavailable for writes'; end if;
 return new;
end $$;
create function public.lock_deleting_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from auth.users where id=new.owner_id for update;
 if not found then raise exception 'Account unavailable'; end if;
 delete from public.shared_journeys where owner_id=new.owner_id;
 update public.household_invitations set expires_at=least(expires_at,now()) where created_by=new.owner_id and used_at is null;
 return new;
end $$;
create trigger lock_deleting_owner before insert or update on public.account_deletion_requests for each row execute function public.lock_deleting_owner();
do $$ declare table_name text; begin
 foreach table_name in array array['saved_places','vehicles','activities','activity_stops','media_assets','shared_journeys','provider_credentials','provider_oauth_states','connected_services','push_devices'] loop
  execute format('create trigger guard_owner_write before insert or update on public.%I for each row execute function public.guard_owner_write(''owner_id'')',table_name);
 end loop;
end $$;
create trigger guard_owner_write before insert or update on public.account_preferences for each row execute function public.guard_owner_write('user_id');
create trigger guard_owner_write before insert or update on public.profiles for each row execute function public.guard_owner_write('id');
revoke all on function public.guard_owner_write(),public.lock_deleting_owner() from public,anon,authenticated;
-- Avoid updating activities in the middle of an Auth-user cascade.
create or replace function public.places_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from auth.users where id=coalesce(new.owner_id,old.owner_id)) then
  update public.activities set updated_at=now() where owner_id=coalesce(new.owner_id,old.owner_id);
 end if;
 return coalesce(new,old);
end $$;
revoke all on function public.places_changed() from public,anon,authenticated;
-- Definer household RPCs must enforce the same pending-deletion boundary.
create or replace function public.my_household() returns table(id uuid,name text,role text)
language sql stable security definer set search_path='' as $$
 select h.id,h.name,m.role from public.households h join public.household_memberships m on m.household_id=h.id where m.user_id=auth.uid() and public.account_is_active()
$$;
create or replace function public.create_household(p_name text) returns table(id uuid,name text,role text)
language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
 if not public.account_is_active() then raise exception 'Account unavailable'; end if;
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
 if not public.account_is_active() then raise exception 'Account unavailable'; end if;
 select household_id into household from public.household_memberships where user_id=auth.uid() and role='owner';
 if household is null then raise exception 'Household owner required'; end if;
 if (select count(*) from public.household_invitations where household_id=household and used_at is null and expires_at>now())>=20 then raise exception 'Invitation limit reached'; end if;
 insert into public.household_invitations(household_id,created_by) values(household,auth.uid()) returning token into code;return code;
end $$;
create or replace function public.accept_household_invitation(p_token uuid) returns table(id uuid,name text,role text)
language plpgsql security definer set search_path='' as $$
declare invite public.household_invitations;
begin
 if not public.account_is_active() then raise exception 'Account unavailable'; end if;
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
 where public.account_is_active() and m.household_id=(select household_id from public.household_memberships where household_memberships.user_id=auth.uid())
$$;
commit;
