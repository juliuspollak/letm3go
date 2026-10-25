-- Optional household presence. No raw coordinates are stored or exposed.
begin;
create table public.household_presence (
 user_id uuid primary key references auth.users(id) on delete cascade,
 sharing_enabled boolean not null default false,
 place_label text,
 activity_label text,
 updated_at timestamptz not null default now(),
 expires_at timestamptz,
 constraint presence_place check (place_label is null or (length(place_label) between 1 and 60)),
 constraint presence_activity check (activity_label is null or activity_label in ('At home','At work','Shopping','At the beach','Outdoors','On the move','Other'))
);
alter table public.household_presence enable row level security;
revoke all on public.household_presence from public,anon,authenticated;
grant all on public.household_presence to service_role;
create or replace function public.set_household_presence(p_enabled boolean,p_activity text default null,p_place text default null)
returns void language plpgsql security definer set search_path='' as $$
declare hid uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select household_id into hid from public.household_memberships where user_id=auth.uid();
 if p_enabled and hid is null then raise exception 'Join a household before sharing presence'; end if;
 if p_enabled and (p_activity is not null and p_activity not in ('At home','At work','Shopping','At the beach','Outdoors','On the move','Other')) then raise exception 'Invalid status'; end if;
 if p_enabled and p_place is not null and (length(trim(p_place)) < 1 or length(p_place)>60) then raise exception 'Invalid place'; end if;
 insert into public.household_presence(user_id,sharing_enabled,activity_label,place_label,expires_at,updated_at)
 values(auth.uid(),p_enabled,case when p_enabled then p_activity end,case when p_enabled then trim(p_place) end,
 case when p_enabled and p_activity is not null then now()+interval '30 minutes' end,now())
 on conflict(user_id) do update set sharing_enabled=excluded.sharing_enabled,activity_label=excluded.activity_label,
 place_label=excluded.place_label,expires_at=excluded.expires_at,updated_at=now();
end $$;
create or replace function public.my_household_presence()
returns table(user_id uuid,display_name text,activity_label text,place_label text,updated_at timestamptz)
language sql stable security definer set search_path='' as $$
 select p.user_id,
 coalesce(nullif(pref.display_name,''),nullif(u.raw_user_meta_data->>'display_name',''),'Family member'),
 p.activity_label,p.place_label,p.updated_at
 from public.household_memberships me
 join public.household_memberships member on member.household_id=me.household_id
 join public.household_presence p on p.user_id=member.user_id
 join auth.users u on u.id=p.user_id
 left join public.account_preferences pref on pref.user_id=p.user_id
 where me.user_id=auth.uid() and p.user_id<>auth.uid() and p.sharing_enabled
 and p.activity_label is not null and p.expires_at>now()
 order by p.updated_at desc limit 30
$$;
create or replace function public.my_presence_settings()
returns table(sharing_enabled boolean,activity_label text,place_label text,expires_at timestamptz)
language sql stable security definer set search_path='' as $$
 select p.sharing_enabled,p.activity_label,p.place_label,p.expires_at from public.household_presence p where p.user_id=auth.uid()
$$;
revoke all on function public.set_household_presence(boolean,text,text),public.my_household_presence(),public.my_presence_settings() from public,anon;
grant execute on function public.set_household_presence(boolean,text,text),public.my_household_presence(),public.my_presence_settings() to authenticated;
commit;
