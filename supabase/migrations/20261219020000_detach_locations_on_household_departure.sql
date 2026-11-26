begin;

alter table public.household_places
 drop constraint household_places_household_id_fkey,
 add constraint household_places_household_id_fkey
  foreign key (household_id) references public.households(id) on delete set null;

alter table public.household_memberships
 add constraint household_memberships_user_household_key unique (user_id, household_id);

-- Preserve the location and its friend audience when the creator leaves.
update public.household_places place
set household_id = null
where place.household_id is not null
 and not exists (
  select 1 from public.household_memberships member
  where member.user_id = place.owner_id and member.household_id = place.household_id
 );

alter table public.household_places
 add constraint household_places_owner_membership_fkey
 foreign key (owner_id, household_id)
 references public.household_memberships(user_id, household_id)
 on delete set null (household_id);

commit;
