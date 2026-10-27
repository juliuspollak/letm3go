-- Profile pictures are visible ONLY to active members of the same household.
-- Use compressed 256px profile images already chosen by each account; never expose photo libraries.
create table if not exists public.household_member_avatars (
  user_id uuid primary key references auth.users(id) on delete cascade,
  avatar_data text not null check (length(avatar_data) <= 180000 and avatar_data ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'),
  updated_at timestamptz not null default now()
);
alter table public.household_member_avatars enable row level security;
revoke all on public.household_member_avatars from public, anon, authenticated;

create or replace function public.save_my_household_avatar(p_avatar text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.household_memberships where user_id=auth.uid()) then
    raise exception 'Household membership required';
  end if;
  if p_avatar is null or p_avatar='' then
    delete from public.household_member_avatars where user_id=auth.uid();
  else
    if length(p_avatar)>180000 or p_avatar !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' then
      raise exception 'Invalid or oversized avatar image';
    end if;
    insert into public.household_member_avatars(user_id,avatar_data,updated_at)
    values(auth.uid(),p_avatar,now())
    on conflict(user_id) do update set avatar_data=excluded.avatar_data,updated_at=now();
  end if;
end $$;

create or replace function public.my_household_member_avatars()
returns table(user_id uuid, avatar_data text)
language sql stable security definer set search_path = '' as $$
  select a.user_id,a.avatar_data
  from public.household_member_avatars a
  join public.household_memberships m on m.user_id=a.user_id
  where m.household_id=(
    select mine.household_id from public.household_memberships mine
    where mine.user_id=auth.uid()
  )
$$;
revoke all on function public.save_my_household_avatar(text) from public,anon;
revoke all on function public.my_household_member_avatars() from public,anon;
grant execute on function public.save_my_household_avatar(text) to authenticated;
grant execute on function public.my_household_member_avatars() to authenticated;
