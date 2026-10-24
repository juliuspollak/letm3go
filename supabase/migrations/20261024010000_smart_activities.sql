-- PROPOSED ONLY. Apply remotely only after explicit approval.
begin;
create table public.saved_places (
 id uuid primary key, owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 100), kind text not null check(kind in ('home','work','favourite')),
 latitude double precision not null check(latitude between -90 and 90), longitude double precision not null check(longitude between -180 and 180),
 radius double precision not null check(radius between 50 and 2000), updated_at timestamptz not null default now()
);
create unique index one_sensitive_place_per_owner on public.saved_places(owner_id,kind) where kind in ('home','work');
create index saved_places_owner on public.saved_places(owner_id);
create table public.vehicles (
 id uuid primary key, owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 100), make text not null default '', model text not null default '',
 tesla_vehicle_id text, created_at timestamptz not null default now()
);
create index vehicles_owner on public.vehicles(owner_id);
alter table public.vehicles enable row level security;
revoke all on public.vehicles from anon,authenticated;
grant select,insert,update,delete on public.vehicles to authenticated;
grant all on public.vehicles to service_role;
create policy vehicles_owner on public.vehicles for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
-- Token material must live in an encrypted server store. This table holds references only.
create table public.connected_services (
 owner_id uuid not null references auth.users(id) on delete cascade, provider text not null check(provider='tesla'),
 status text not null default 'disconnected' check(status in ('disconnected','pending','connected','error')),
 vault_reference uuid, expires_at timestamptz, primary key(owner_id,provider)
);
alter table public.connected_services enable row level security;
revoke all on public.connected_services from anon,authenticated;
grant select(provider,status,expires_at) on public.connected_services to authenticated;
grant all on public.connected_services to service_role;
create policy services_owner_read on public.connected_services for select to authenticated using(owner_id=(select auth.uid()));
create table public.activity_tombstones (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade, deleted_at timestamptz not null default now()
);
create table public.activities (
 id uuid primary key, owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 title text not null check(length(title) between 1 and 150), activity text not null,
 recording_mode text not null check(recording_mode in ('manual','automatic','historical','tesla','combined')),
 started_at timestamptz not null, ended_at timestamptz not null check(ended_at >= started_at),
 duration_seconds double precision not null check(duration_seconds between 0 and 604800), distance_meters double precision not null check(distance_meters between 0 and 2000000),
 vehicle text, description text not null default '' check(length(description)<=4000), notes text not null default '' check(length(notes)<=4000),
 tags text[] not null default '{}' check(cardinality(tags)<=20), collection text not null default '',
 classification jsonb not null default '{"predicted":"Unknown","confidence":"low","evidence":[]}', user_corrected boolean not null default false,
 route_points jsonb not null default '[]' check(jsonb_typeof(route_points)='array' and jsonb_array_length(route_points)<=50000),
 visibility text not null default 'private' check(visibility in ('private','household','friends','public')),
 revision integer not null default 1, updated_at timestamptz not null default now()
);
create index activities_owner_timeline on public.activities(owner_id,started_at desc,id);
create table public.media_assets (
 id uuid primary key, owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 activity_id uuid not null references public.activities(id) on delete cascade,
 object_key text not null unique, caption text not null default '' check(length(caption)<=500),
 byte_size integer not null check(byte_size between 1 and 5000000), mime_type text not null check(mime_type='image/jpeg'),
 latitude double precision, longitude double precision, location_source text not null default 'unlocated' check(location_source in ('gps','inferred','unlocated')),
 public_selected boolean not null default false, created_at timestamptz not null default now()
);
create index media_assets_activity on public.media_assets(activity_id);
-- Storage cleanup outbox contains object keys only; no client can read it.
create table public.media_cleanup (object_key text primary key, queued_at timestamptz not null default now());
create table public.trusted_contacts (
 owner_id uuid not null references auth.users(id) on delete cascade, recipient_id uuid not null references auth.users(id) on delete cascade,
 relation text not null check(relation in ('household','friends')), primary key(owner_id,recipient_id,relation)
);
create table public.activity_grants (
 activity_id uuid not null references public.activities(id) on delete cascade,
 recipient_id uuid not null references auth.users(id) on delete cascade,
 relation text not null check(relation in ('household','friends')), primary key(activity_id,recipient_id)
);
-- Only a trusted server can create this detached, sanitised projection.
create table public.shared_journeys (
 token uuid primary key default gen_random_uuid(), activity_id uuid not null unique references public.activities(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade, audience text not null check(audience in ('public','household','friends')),
 snapshot jsonb not null, created_at timestamptz not null default now()
);
create or replace function public.protect_activity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.activity_tombstones where id=new.id) then raise exception 'Activity was deleted'; end if;
 if TG_OP='UPDATE' then
  if new.owner_id<>old.owner_id then raise exception 'Owner is immutable'; end if;
  new.revision:=old.revision+1;
  -- Any edit revokes an old public projection until explicitly published again.
  delete from public.shared_journeys where activity_id=old.id;
 end if;
 new.updated_at:=now(); return new;
end $$;
create trigger protect_activity before insert or update on public.activities for each row execute function public.protect_activity();
create or replace function public.deleted_activity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.activity_tombstones(id,owner_id) values(old.id,old.owner_id) on conflict(id) do nothing;
 return old;
end $$;
create trigger deleted_activity after delete on public.activities for each row execute function public.deleted_activity();
create or replace function public.deleted_media() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.media_cleanup(object_key) values(old.object_key) on conflict do nothing;
 return old;
end $$;
create trigger deleted_media after delete on public.media_assets for each row execute function public.deleted_media();
-- Changing a sensitive-place definition invalidates prior masking and in-flight previews.
create or replace function public.places_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.activities set updated_at=now() where owner_id=coalesce(new.owner_id,old.owner_id);
 return coalesce(new,old);
end $$;
create trigger places_changed after insert or update or delete on public.saved_places for each row execute function public.places_changed();
create table public.operation_budgets (key text primary key, window_start timestamptz not null default now(), used integer not null default 0);
alter table public.operation_budgets enable row level security;
revoke all on public.operation_budgets from public,anon,authenticated;
create or replace function public.consume_operation(p_key text,p_max integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare count_now integer;
begin
 delete from public.operation_budgets where window_start < now()-interval '2 days';
 insert into public.operation_budgets(key,used) values(p_key,1)
 on conflict(key) do update set used=case when public.operation_budgets.window_start<now()-interval '1 hour' then 1 else public.operation_budgets.used+1 end,
 window_start=case when public.operation_budgets.window_start<now()-interval '1 hour' then now() else public.operation_budgets.window_start end returning used into count_now;
 return count_now<=p_max;
end $$;
revoke all on function public.consume_operation(text,integer) from public,anon,authenticated;
grant execute on function public.consume_operation(text,integer) to service_role;
-- Commit must compare a locked current revision, preventing edit/delete versus publish races.
create or replace function public.commit_shared_journey(p_id uuid,p_owner uuid,p_revision integer,p_audience text,p_snapshot jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare trip public.activities; result uuid;
begin
 select * into trip from public.activities where id=p_id and owner_id=p_owner for update;
 if not found or trip.revision<>p_revision then raise exception 'Activity changed or was deleted. Review the preview again.'; end if;
 if p_audience not in ('public','household','friends') then raise exception 'Invalid audience'; end if;
 insert into public.shared_journeys(activity_id,owner_id,audience,snapshot) values(p_id,p_owner,p_audience,p_snapshot)
 on conflict(activity_id) do update set snapshot=excluded.snapshot,audience=excluded.audience returning token into result;
 return result;
end $$;
revoke all on function public.commit_shared_journey(uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.commit_shared_journey(uuid,uuid,integer,text,jsonb) to service_role;
create or replace function public.revoke_activity_publication(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.activities where id=p_id and owner_id=auth.uid()) then raise exception 'Not authorised'; end if;
 delete from public.shared_journeys where activity_id=p_id;
end $$;
revoke all on function public.revoke_activity_publication(uuid) from public;
grant execute on function public.revoke_activity_publication(uuid) to authenticated;

alter table public.saved_places enable row level security;
alter table public.activities enable row level security;
alter table public.activity_tombstones enable row level security;
alter table public.media_assets enable row level security;
alter table public.media_cleanup enable row level security;
alter table public.trusted_contacts enable row level security;
alter table public.activity_grants enable row level security;
alter table public.shared_journeys enable row level security;
revoke all on public.saved_places,public.activities,public.activity_tombstones,public.media_assets,public.media_cleanup,public.trusted_contacts,public.activity_grants,public.shared_journeys from anon,authenticated;
grant select,insert,update,delete on public.saved_places,public.activities to authenticated;
grant select on public.activity_tombstones,public.media_assets,public.trusted_contacts to authenticated;
grant delete on public.media_assets to authenticated;
grant select,insert,delete on public.activity_grants to authenticated;
grant select(token,snapshot,created_at) on public.shared_journeys to anon,authenticated;
grant all on public.saved_places,public.activities,public.activity_tombstones,public.media_assets,public.media_cleanup,public.trusted_contacts,public.activity_grants,public.shared_journeys to service_role;
create policy places_owner on public.saved_places for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy activities_owner on public.activities for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy tombstones_owner_read on public.activity_tombstones for select to authenticated using(owner_id=(select auth.uid()));
create policy media_owner on public.media_assets for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy contacts_owner_read on public.trusted_contacts for select to authenticated using(owner_id=(select auth.uid()));
create policy grants_owner on public.activity_grants for all to authenticated
 using(exists(select 1 from public.activities where id=activity_id and owner_id=(select auth.uid())))
 with check(exists(select 1 from public.activities where id=activity_id and owner_id=(select auth.uid())) and exists(select 1 from public.trusted_contacts where owner_id=(select auth.uid()) and recipient_id=activity_grants.recipient_id and relation=activity_grants.relation));
create policy grants_recipient_read on public.activity_grants for select to authenticated using(recipient_id=(select auth.uid()));
create or replace function public.shared_journey_visible(p_owner uuid,p_activity uuid,p_audience text) returns boolean
language sql stable security definer set search_path='' as $$
 select p_audience='public' or p_owner=auth.uid() or exists(
  select 1 from public.activity_grants g join public.trusted_contacts c
   on c.owner_id=p_owner and c.recipient_id=g.recipient_id and c.relation=g.relation
  where g.activity_id=p_activity and g.recipient_id=auth.uid() and g.relation=p_audience
 )
$$;
revoke all on function public.shared_journey_visible(uuid,uuid,text) from public;
grant execute on function public.shared_journey_visible(uuid,uuid,text) to anon,authenticated;
create policy shared_projection_read on public.shared_journeys for select to anon,authenticated
 using(public.shared_journey_visible(owner_id,activity_id,audience));
commit;
