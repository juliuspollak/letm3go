-- Consent is account-scoped, never per-device. Disabling revokes published summaries.
begin;
create table public.household_trip_sharing_settings(
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false
);
alter table public.household_trip_sharing_settings enable row level security;
revoke all on public.household_trip_sharing_settings from public,anon,authenticated;
create or replace function public.my_household_trip_sharing_setting()
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select enabled from public.household_trip_sharing_settings where user_id=auth.uid()),false)
$$;
create or replace function public.set_household_trip_sharing(p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_enabled is null then raise exception 'Sign in required'; end if;
 if p_enabled and not exists(
   select 1 from public.household_vehicle_links l
   join public.household_vehicles v on v.id=l.household_vehicle_id
   join public.household_memberships m on m.household_id=v.household_id
   where l.user_id=auth.uid() and m.user_id=auth.uid()
 ) then raise exception 'Link a household vehicle before sharing'; end if;
 insert into public.household_trip_sharing_settings(user_id,enabled)
 values(auth.uid(),p_enabled)
 on conflict(user_id) do update set enabled=excluded.enabled;
 if not p_enabled then delete from public.household_vehicle_trips where owner_id=auth.uid(); end if;
end $$;
create or replace function public.enforce_household_trip_sharing()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.household_trip_sharing_settings
               where user_id=new.owner_id and enabled=true) then
   raise exception 'Household trip sharing is disabled';
 end if;
 return new;
end $$;
create trigger require_household_trip_consent before insert or update on public.household_vehicle_trips
for each row execute function public.enforce_household_trip_sharing();
revoke all on function public.my_household_trip_sharing_setting(),public.set_household_trip_sharing(boolean) from public,anon;
grant execute on function public.my_household_trip_sharing_setting(),public.set_household_trip_sharing(boolean) to authenticated;
commit;
