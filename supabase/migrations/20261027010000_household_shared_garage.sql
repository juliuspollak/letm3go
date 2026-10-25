-- Shared household garage uses one canonical vehicle per household, with explicit local linking.
-- No account's existing vehicles are imported, merged, or deleted when joining.
begin;
create table public.household_vehicles(
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 display_name text not null check(length(trim(display_name)) between 1 and 100),
 make text not null default '', model text not null default '',
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(household_id,id)
);
create index household_vehicles_scope on public.household_vehicles(household_id);
create table public.household_vehicle_links(
 household_vehicle_id uuid not null references public.household_vehicles(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 local_vehicle_id uuid not null,
 primary key(user_id,local_vehicle_id),
 unique(household_vehicle_id,user_id,local_vehicle_id)
);
alter table public.household_vehicles enable row level security;
alter table public.household_vehicle_links enable row level security;
revoke all on public.household_vehicles,public.household_vehicle_links from public,anon,authenticated;
create or replace function public.my_household_vehicles()
returns table(id uuid,display_name text,make text,model text,local_vehicle_id uuid)
language sql stable security definer set search_path='' as $$
 select v.id,v.display_name,v.make,v.model,l.local_vehicle_id
 from public.household_memberships m
 join public.household_vehicles v on v.household_id=m.household_id
 left join public.household_vehicle_links l on l.household_vehicle_id=v.id and l.user_id=auth.uid()
 where m.user_id=auth.uid()
 order by v.created_at,v.id
$$;
create or replace function public.add_household_vehicle(p_name text,p_make text default '',p_model text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare hid uuid; vid uuid;
begin
 select household_id into hid from public.household_memberships where user_id=auth.uid();
 if hid is null then raise exception 'Household required'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 100 or length(coalesce(p_make,''))>100 or length(coalesce(p_model,''))>100 then raise exception 'Invalid vehicle details'; end if;
 insert into public.household_vehicles(household_id,display_name,make,model,created_by)
 values(hid,trim(p_name),coalesce(p_make,''),coalesce(p_model,''),auth.uid()) returning id into vid;
 return vid;
end $$;
create or replace function public.link_household_vehicle(p_household_vehicle uuid,p_local_vehicle uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_household_vehicle is null or p_local_vehicle is null then raise exception 'Select a vehicle'; end if;
 if not exists(select 1 from public.household_vehicles v join public.household_memberships m on m.household_id=v.household_id where v.id=p_household_vehicle and m.user_id=auth.uid()) then raise exception 'Household vehicle unavailable'; end if;
 insert into public.household_vehicle_links(household_vehicle_id,user_id,local_vehicle_id)
 values(p_household_vehicle,auth.uid(),p_local_vehicle)
 on conflict(user_id,local_vehicle_id) do update set household_vehicle_id=excluded.household_vehicle_id;
end $$;
revoke all on function public.my_household_vehicles(),public.add_household_vehicle(text,text,text),public.link_household_vehicle(uuid,uuid) from public,anon;
grant execute on function public.my_household_vehicles(),public.add_household_vehicle(text,text,text),public.link_household_vehicle(uuid,uuid) to authenticated;
commit;
