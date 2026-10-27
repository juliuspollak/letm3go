-- One avatar lookup for the whole app: the signed-in user plus their household
-- members and accepted friends, always keyed by the stable auth user id.
--
-- Two problems are fixed here. The household-only helper never returned the
-- signed-in user for a client that skipped the separate upload call, so the
-- organiser's bubble fell back to an initial while the header (local preferences)
-- showed the photo. It also allowed only JPEG, so a PNG chosen on an older build
-- could never be published to the people who should see it.
begin;

alter table public.household_member_avatars
 drop constraint if exists household_member_avatars_avatar_data_check;
alter table public.household_member_avatars
 add constraint household_member_avatars_avatar_data_check
 check (length(avatar_data)<=180000 and avatar_data ~ '^data:image/(jpeg|png);base64,[A-Za-z0-9+/=]+$');

create or replace function public.save_my_household_avatar(p_avatar text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.household_memberships where user_id=auth.uid()) then
    raise exception 'Household membership required';
  end if;
  if p_avatar is null or p_avatar='' then
    delete from public.household_member_avatars where user_id=auth.uid();
  else
    if length(p_avatar)>180000 or p_avatar !~ '^data:image/(jpeg|png);base64,[A-Za-z0-9+/=]+$' then
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
  where auth.uid() is not null
  and a.user_id in (
    select other.user_id
    from public.household_memberships mine
    join public.household_memberships other on other.household_id=mine.household_id
    where mine.user_id=auth.uid()
  )
$$;

create or replace function public.my_people_avatars()
returns table(user_id uuid, avatar_data text)
language sql stable security definer set search_path = '' as $$
  select a.user_id,a.avatar_data
  from public.household_member_avatars a
  where auth.uid() is not null
  and (
    a.user_id=auth.uid()
    or a.user_id in (
      select other.user_id
      from public.household_memberships mine
      join public.household_memberships other on other.household_id=mine.household_id
      where mine.user_id=auth.uid()
    )
    or exists (
      select 1 from public.friend_connections c
      where c.user_low=least(auth.uid(),a.user_id) and c.user_high=greatest(auth.uid(),a.user_id)
    )
  )
$$;

revoke all on function public.my_people_avatars() from public,anon;
grant execute on function public.my_people_avatars() to authenticated;
commit;
