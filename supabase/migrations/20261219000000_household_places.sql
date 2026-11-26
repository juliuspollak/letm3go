begin;

create table public.household_places (
 id uuid primary key,
 household_id uuid not null references public.households(id) on delete cascade,
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 name text not null check (length(btrim(name)) between 1 and 100),
 icon text not null check (icon in ('none','place','work','school','shop','sport')),
 latitude double precision not null check (latitude between -90 and 90),
 longitude double precision not null check (longitude between -180 and 180),
 radius integer not null check (radius between 50 and 500),
 share_with_friends boolean not null default false
);

create index household_places_household on public.household_places(household_id);
create index household_places_owner on public.household_places(owner_id);
alter table public.household_places enable row level security;
revoke all on public.household_places from public, anon, authenticated;
grant select, delete on public.household_places to authenticated;
grant insert (id, household_id, name, icon, latitude, longitude, radius, share_with_friends),
 update (name, icon, latitude, longitude, radius, share_with_friends)
 on public.household_places to authenticated;

create policy household_places_read on public.household_places for select to authenticated
using (
 owner_id = (select auth.uid())
 or household_id in (select id from public.my_household())
 or (share_with_friends and owner_id in (select user_id from public.my_friends()))
);
create policy household_places_insert on public.household_places for insert to authenticated
with check (owner_id = (select auth.uid()) and household_id in (select id from public.my_household()));
create policy household_places_update on public.household_places for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));
create policy household_places_delete on public.household_places for delete to authenticated
using (owner_id = (select auth.uid()));

commit;
