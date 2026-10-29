-- One display name for a person everywhere in the household.
--
-- The app saves a person's name to public.profiles.display_name (onboarding and
-- Account settings) and to their auth metadata (letm3go_onboarding_v1.display_name
-- at onboarding, full_name at sign-up). my_household_location_status() read only
-- account_preferences.display_name and the top-level metadata display_name, which
-- the app never writes, so a member with a real name reached the map as the
-- placeholder "Family member" and was drawn with the initial "F".
--
-- This adds one name resolver and uses it for the Household member list and the
-- family map, so both always show the same name. When no name exists an empty
-- string is returned and the app draws a neutral silhouette instead of a
-- made-up initial. Additive and replay-safe: no table, row or grant changes.
begin;

create or replace function public.person_display_name(p_user uuid)
returns text language sql stable security invoker set search_path='' as $$
 select coalesce(
  (select nullif(btrim(p.display_name),'') from public.profiles p where p.id=p_user),
  (select nullif(btrim(a.display_name),'') from public.account_preferences a where a.user_id=p_user),
  (select coalesce(
    nullif(btrim(u.raw_user_meta_data->>'display_name'),''),
    nullif(btrim(u.raw_user_meta_data->'letm3go_onboarding_v1'->>'display_name'),''),
    nullif(btrim(u.raw_user_meta_data->>'full_name'),''),
    nullif(btrim(u.raw_user_meta_data->>'name'),''))
   from auth.users u where u.id=p_user),
  '')
$$;
-- Internal: only the security-definer functions below call it, and they already
-- restrict which people the caller may see.
revoke all on function public.person_display_name(uuid) from public,anon,authenticated;

create or replace function public.household_members() returns table(user_id uuid,display_name text,role text)
language sql stable security definer set search_path='' as $$
 select m.user_id,public.person_display_name(m.user_id),m.role from public.household_memberships m
 where public.account_is_active() and m.household_id=(select household_id from public.household_memberships where household_memberships.user_id=auth.uid())
$$;

create or replace function public.my_household_location_status()
returns table(user_id uuid,display_name text,sharing_enabled boolean,
 latitude double precision,longitude double precision,accuracy_m double precision,
 speed_kmh double precision,location_at timestamptz,server_now timestamptz)
language sql stable security definer set search_path='' as $$
 select member.user_id,
  public.person_display_name(member.user_id),
  coalesce(l.enabled,false),
  case when v.visible then l.latitude end,
  case when v.visible then l.longitude end,
  case when v.visible then l.accuracy_m end,
  case when v.visible then l.speed_kmh end,
  case when coalesce(l.enabled,false) and l.location_at>=greatest(me.joined_at,member.joined_at) then l.location_at end,
  now()
 from public.household_memberships me
 join public.household_memberships member on member.household_id=me.household_id and member.user_id<>me.user_id
 left join public.household_live_locations l on l.user_id=member.user_id
 cross join lateral (select coalesce(l.enabled,false) and l.latitude is not null and l.longitude is not null
  and l.location_at>now()-interval '24 hours'
  and l.location_at>=greatest(me.joined_at,member.joined_at) as visible) v
 where me.user_id=auth.uid()
 order by 2
$$;

commit;
