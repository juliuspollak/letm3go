begin;

-- Older clients and already-saved locations can retain their wider radiuses.
alter table public.household_places
 drop constraint household_places_radius_check,
 add constraint household_places_radius_check check (radius between 15 and 500);

commit;
