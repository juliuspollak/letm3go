-- Minimal identity foundation. No application-domain assumptions or production data.
begin;
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 100),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select, insert, delete on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
create policy "Read own profile" on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "Create own profile" on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);
create policy "Update own profile" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "Delete own profile" on public.profiles for delete to authenticated
  using ((select auth.uid()) = id);
commit;
