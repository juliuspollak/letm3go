-- Extend opted-in, expiring household presence with activity classifications.
-- No raw coordinates, speeds, headings, or routes are shared.
begin;
alter table public.household_presence drop constraint if exists presence_activity;
alter table public.household_presence add constraint presence_activity
check (activity_label is null or activity_label in
 ('At home','At work','Shopping','At the beach','Outdoors','On the move','Other','Driving','Walking','Running','Cycling'));
create or replace function public.set_household_presence(p_enabled boolean,p_activity text default null,p_place text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if p_enabled and p_activity is not null
    and p_activity not in ('At home','At work','Shopping','At the beach','Outdoors','On the move','Other','Driving','Walking','Running','Cycling')
 then raise exception 'Invalid status'; end if;
 if p_enabled and p_place is not null and (length(trim(p_place))<1 or length(p_place)>60)
 then raise exception 'Invalid place'; end if;
 insert into public.household_presence(user_id,sharing_enabled,activity_label,place_label,expires_at,updated_at)
 values(auth.uid(),p_enabled,case when p_enabled then p_activity end,
        case when p_enabled then trim(p_place) end,
        case when p_enabled and p_activity is not null then now()+interval '30 minutes' end,now())
 on conflict(user_id) do update set sharing_enabled=excluded.sharing_enabled,
 activity_label=excluded.activity_label,place_label=excluded.place_label,
 expires_at=excluded.expires_at,updated_at=now();
end $$;
revoke all on function public.set_household_presence(boolean,text,text) from public,anon;
grant execute on function public.set_household_presence(boolean,text,text) to authenticated;
commit;
