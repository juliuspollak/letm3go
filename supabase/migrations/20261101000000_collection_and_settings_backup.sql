-- Proposed local-only. Requires approval; never replay earlier scripts.
--
-- Build 45 left two gaps that only appear on a second device:
--   * My Collection lives in preferences.vehicles, which is encrypted per device
--     with a device-only Keychain key. A replacement iPhone therefore starts
--     with an empty Collection and no equipment photos.
--   * Trip equipment referenced Collection item ids that were never backed up,
--     so a restored trip could not resolve its equipment.
--
-- This migration adds an owner-scoped, additive backup for Collection items and
-- for the small set of account settings that used to be device-only. The device
-- stays authoritative: nothing here is read by the app except through an
-- explicit "Restore from cloud" action. Photos stay in private R2; only the
-- deterministic object key and its SHA-256 are stored here, so a database row
-- can never point at another account's object.
begin;

-- 1. The signed-in user's own profile photo. Row-level security already restricts
--    profiles to their owner, so this is private. Household/friend sharing keeps
--    using household_member_avatars and is unaffected.
alter table public.profiles add column if not exists avatar text;
alter table public.profiles drop constraint if exists profiles_avatar_check;
alter table public.profiles add constraint profiles_avatar_check
 check (avatar is null or (char_length(avatar) between 1 and 180000 and avatar ~ '^data:image/(jpeg|png);base64,[A-Za-z0-9+/=]+$'));
-- The table grant is column-scoped, so the new column needs its own write grant.
grant update (avatar) on public.profiles to authenticated;

-- 2. Attribute shape is validated once, because a CHECK may not contain a
--    subquery. Keys and values use the same limits as the native preference file.
create or replace function public.valid_collection_attributes(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select jsonb_typeof(p_value)='object'
  and (select count(*) from jsonb_object_keys(p_value))<=24
  and not exists(
   select 1 from jsonb_each(p_value) as entry(key,value)
   where entry.key !~ '^[a-z][a-z0-9_]{0,31}$'
    or jsonb_typeof(entry.value)<>'string'
    or length(entry.value #>> '{}')>120
  )
$$;
revoke all on function public.valid_collection_attributes(jsonb) from public,anon;
grant execute on function public.valid_collection_attributes(jsonb) to authenticated,service_role;

-- 3. Collection items. `id` is the stable local UUID, so trip equipment
--    references keep resolving after a rename and after a restore.
create table public.collection_items (
 id uuid primary key,
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 category text not null default 'car' check (category ~ '^[a-z][a-z0-9_-]{0,31}$'),
 name text not null default '' check (char_length(name)<=60),
 make text not null default '' check (char_length(make)<=60),
 model text not null default '' check (char_length(model)<=60),
 attributes jsonb not null default '{}'::jsonb check (public.valid_collection_attributes(attributes)),
 source text not null default 'manual' check (source in ('manual','tesla')),
 tesla_vehicle_id text check (tesla_vehicle_id is null or char_length(tesla_vehicle_id) between 1 and 100),
 archived boolean not null default false,
 -- Deterministic per-item key under the owner's own prefix. Binding it to
 -- owner_id and id means a row can never reference another account's object.
 photo_object_key text,
 photo_sha256 text check (photo_sha256 is null or photo_sha256 ~ '^[a-f0-9]{64}$'),
 sync_fingerprint text check (sync_fingerprint is null or sync_fingerprint ~ '^[a-f0-9]{64}$'),
 revision integer not null default 1,
 deleted_at timestamptz,
 updated_at timestamptz not null default now(),
 constraint collection_items_photo_key_owned check (
  photo_object_key is null or photo_object_key = owner_id::text || '/collection/' || id::text || '.jpg'
 ),
 constraint collection_items_photo_hash_paired check (
  (photo_object_key is null) = (photo_sha256 is null)
 )
);
create index collection_items_owner on public.collection_items(owner_id,updated_at desc);
create index collection_items_owner_live on public.collection_items(owner_id) where deleted_at is null;

-- Revisions are server-owned, so a stale device can never silently overwrite a
-- newer edit (the same contract activities already use).
create or replace function public.protect_collection_item() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.owner_id<>old.owner_id then raise exception 'Owner is immutable'; end if;
 if new.id<>old.id then raise exception 'Collection item identity is immutable'; end if;
 new.revision:=old.revision+1;
 new.updated_at:=now();
 return new;
end $$;
create trigger protect_collection_item before update on public.collection_items
 for each row execute function public.protect_collection_item();

alter table public.collection_items enable row level security;
revoke all on public.collection_items from anon,authenticated;
grant select,insert,update,delete on public.collection_items to authenticated;
grant all on public.collection_items to service_role;
create policy collection_items_owner on public.collection_items for all to authenticated
 using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
-- Restrictive, like every other private table: a deletion-pending account cannot write.
create policy account_active on public.collection_items as restrictive for all to authenticated
 using((select public.account_is_active())) with check((select public.account_is_active()));

-- Conflict-safe, idempotent upsert. A repeated fingerprint is acknowledged
-- without a second revision, so a retry after a lost receipt is free.
create or replace function public.backup_collection_item(p_owner uuid,p_payload jsonb,p_fingerprint text,p_expected_revision integer default null)
returns integer language plpgsql security invoker set search_path='' as $$
declare incoming public.collection_items; current_item public.collection_items; saved_revision integer;
begin
 if p_owner is distinct from auth.uid() or not public.account_is_active() then raise exception 'Authenticated backup owner mismatch'; end if;
 if p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'Invalid backup fingerprint'; end if;
 incoming:=jsonb_populate_record(null::public.collection_items,p_payload);
 if incoming.id is null then raise exception 'Collection item ID required'; end if;
 select * into current_item from public.collection_items where id=incoming.id and owner_id=p_owner for update;
 if found then
  if current_item.deleted_at is not null then raise exception 'Cloud collection item was removed; refusing resurrection'; end if;
  if current_item.sync_fingerprint=p_fingerprint then return current_item.revision; end if;
  if p_expected_revision is null or current_item.revision<>p_expected_revision then raise exception 'Cloud collection item conflict; reload before overwriting'; end if;
  update public.collection_items set category=incoming.category,name=incoming.name,make=incoming.make,model=incoming.model,
   attributes=coalesce(incoming.attributes,'{}'::jsonb),source=incoming.source,tesla_vehicle_id=incoming.tesla_vehicle_id,
   archived=coalesce(incoming.archived,false),photo_object_key=incoming.photo_object_key,photo_sha256=incoming.photo_sha256,
   deleted_at=null,sync_fingerprint=p_fingerprint
   where id=incoming.id and owner_id=p_owner returning revision into saved_revision;
 else
  if p_expected_revision is not null then raise exception 'Cloud collection item was removed; refusing resurrection'; end if;
  insert into public.collection_items(id,owner_id,category,name,make,model,attributes,source,tesla_vehicle_id,archived,photo_object_key,photo_sha256,sync_fingerprint)
   values(incoming.id,p_owner,coalesce(incoming.category,'car'),coalesce(incoming.name,''),coalesce(incoming.make,''),coalesce(incoming.model,''),
    coalesce(incoming.attributes,'{}'::jsonb),coalesce(incoming.source,'manual'),incoming.tesla_vehicle_id,coalesce(incoming.archived,false),
    incoming.photo_object_key,incoming.photo_sha256,p_fingerprint)
   returning revision into saved_revision;
 end if;
 return saved_revision;
end $$;
revoke all on function public.backup_collection_item(uuid,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.backup_collection_item(uuid,jsonb,text,integer) to authenticated;

-- A removal stays a tombstone so a restore on another device cannot resurrect an
-- item the owner deliberately deleted. The row is kept for auditability.
create or replace function public.delete_collection_item(p_owner uuid,p_id uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare saved_revision integer;
begin
 if p_owner is distinct from auth.uid() or not public.account_is_active() then raise exception 'Authenticated backup owner mismatch'; end if;
 update public.collection_items set deleted_at=now(),sync_fingerprint=null
  where id=p_id and owner_id=p_owner returning revision into saved_revision;
 return saved_revision;
end $$;
revoke all on function public.delete_collection_item(uuid,uuid) from public,anon,authenticated;
grant execute on function public.delete_collection_item(uuid,uuid) to authenticated;

-- 4. Small account settings that were device-only (name, photo, units,
--    favourites, archived trips, merged-journey metadata). One row per account;
--    the payload is a whitelisted, size-capped object.
create table public.account_settings (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 payload jsonb not null default '{}'::jsonb,
 revision integer not null default 1,
 sync_fingerprint text check (sync_fingerprint is null or sync_fingerprint ~ '^[a-f0-9]{64}$'),
 updated_at timestamptz not null default now()
);
alter table public.account_settings enable row level security;
revoke all on public.account_settings from anon,authenticated;
grant select,insert,update,delete on public.account_settings to authenticated;
grant all on public.account_settings to service_role;
create policy account_settings_owner on public.account_settings for all to authenticated
 using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy account_active on public.account_settings as restrictive for all to authenticated
 using((select public.account_is_active())) with check((select public.account_is_active()));

create or replace function public.protect_account_settings() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.owner_id<>old.owner_id then raise exception 'Owner is immutable'; end if;
 new.revision:=old.revision+1;
 new.updated_at:=now();
 return new;
end $$;
create trigger protect_account_settings before update on public.account_settings
 for each row execute function public.protect_account_settings();


create or replace function public.backup_account_settings(p_owner uuid,p_payload jsonb,p_fingerprint text,p_expected_revision integer default null)
returns integer language plpgsql security invoker set search_path='' as $$
declare current_settings public.account_settings; saved_revision integer;
begin
 if p_owner is distinct from auth.uid() or not public.account_is_active() then raise exception 'Authenticated backup owner mismatch'; end if;
 if p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'Invalid backup fingerprint'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Settings payload must be an object'; end if;
 if octet_length(p_payload::text)>400000 then raise exception 'Settings payload is too large'; end if;
 if exists(select 1 from jsonb_object_keys(p_payload) as key(name)
   where key.name not in ('displayName','avatar','distanceUnit','notificationsEnabled','bookmarks','archivedTrips','journeyGrouping')) then
  raise exception 'Unsupported settings field';
 end if;
 if p_payload ? 'avatar' and jsonb_typeof(p_payload->'avatar')='string' and p_payload->>'avatar'<>''
  and (char_length(p_payload->>'avatar')>180000 or (p_payload->>'avatar') !~ '^data:image/(jpeg|png);base64,[A-Za-z0-9+/=]+$') then
  raise exception 'Invalid profile image';
 end if;
 if p_payload ? 'bookmarks' and (jsonb_typeof(p_payload->'bookmarks')<>'array' or jsonb_array_length(p_payload->'bookmarks')>1000) then
  raise exception 'Invalid favourite list';
 end if;
 if p_payload ? 'archivedTrips' and (jsonb_typeof(p_payload->'archivedTrips')<>'array' or jsonb_array_length(p_payload->'archivedTrips')>2000) then
  raise exception 'Invalid archived list';
 end if;
 if p_payload ? 'journeyGrouping' and jsonb_typeof(p_payload->'journeyGrouping')='string'
  and char_length(p_payload->>'journeyGrouping')>300000 then raise exception 'Journey metadata is too large'; end if;
 select * into current_settings from public.account_settings where owner_id=p_owner for update;
 if found then
  if current_settings.sync_fingerprint=p_fingerprint then return current_settings.revision; end if;
  if p_expected_revision is null or current_settings.revision<>p_expected_revision then raise exception 'Cloud settings conflict; reload before overwriting'; end if;
  update public.account_settings set payload=p_payload,sync_fingerprint=p_fingerprint where owner_id=p_owner returning revision into saved_revision;
 else
  if p_expected_revision is not null then raise exception 'Cloud settings were removed; refusing resurrection'; end if;
  insert into public.account_settings(owner_id,payload,sync_fingerprint) values(p_owner,p_payload,p_fingerprint) returning revision into saved_revision;
 end if;
 return saved_revision;
end $$;
revoke all on function public.backup_account_settings(uuid,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.backup_account_settings(uuid,jsonb,text,integer) to authenticated;

commit;
