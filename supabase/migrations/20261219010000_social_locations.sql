begin;

alter table public.household_places alter column household_id drop not null;
alter policy household_places_insert on public.household_places
with check (
 owner_id = (select auth.uid())
 and (household_id is null or household_id in (select id from public.my_household()))
);

commit;
