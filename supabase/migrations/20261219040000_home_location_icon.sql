begin;

alter table public.household_places
 drop constraint household_places_icon_check,
 add constraint household_places_icon_check
 check (icon in ('none','place','home','work','school','shop','sport'));

commit;
