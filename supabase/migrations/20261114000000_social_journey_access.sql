-- Social journey access v1. Apply ONLY after validating the live schema and
-- testing with independent JWTs. Never expose private snapshots via anon SELECT.
-- Existing friend/household RPCs remain the source of current relationship truth.
begin;

create table if not exists public.social_journey_policies (
 activity_id uuid primary key,
 owner_id uuid not null references auth.users(id) on delete cascade,
 mode text not null check(mode in ('friends','household','selected')),
 created_at timestamptz not null default now()
);
create table if not exists public.social_journey_recipients (
 activity_id uuid not null references public.social_journey_policies(activity_id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(activity_id,user_id)
);
create index if not exists social_journey_policies_owner_idx on public.social_journey_policies(owner_id);
alter table public.social_journey_policies enable row level security;
alter table public.social_journey_recipients enable row level security;
revoke all on public.social_journey_policies, public.social_journey_recipients from anon, authenticated;

-- This function is used by all private snapshot and photo reads. It deliberately
-- checks current membership, not the membership held when the trip was published.
create or replace function public.can_view_social_journey(p_activity uuid)
returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_owner uuid; v_audience text; v_mode text;
begin
 if auth.uid() is null then return false; end if;
 select j.owner_id, j.audience, p.mode
 into v_owner, v_audience, v_mode
 from public.shared_journeys j
 join public.social_journey_policies p on p.activity_id=j.activity_id and p.owner_id=j.owner_id
 where j.activity_id=p_activity;
 if not found then return false; end if;
 if auth.uid()=v_owner then return true; end if;
 if v_mode='household' and v_audience='household' then
  return exists (
   select 1 from public.household_members() as m
   where (to_jsonb(m)->>'user_id')=v_owner::text
  );
 end if;
 if v_audience<>'friends' then return false; end if;
 if not exists (
  select 1 from public.my_friends() as f
  where (to_jsonb(f)->>'user_id')=v_owner::text
 ) then return false; end if;
 if v_mode='friends' then return true; end if;
 if v_mode='selected' then
  return exists (
   select 1 from public.social_journey_recipients r
   where r.activity_id=p_activity and r.user_id=auth.uid()
  );
 end if;
 return false;
end $$;

create or replace function public.configure_social_journey(
 p_activity uuid, p_mode text, p_recipients uuid[] default '{}'::uuid[])
returns void
language plpgsql security definer set search_path=''
as $$
declare v_audience text; v_id uuid;
begin
 if auth.uid() is null or p_mode not in ('friends','household','selected') then
  raise exception 'Invalid social audience';
 end if;
 if coalesce(array_length(p_recipients,1),0)>100 then raise exception 'Too many recipients'; end if;
 select audience into v_audience from public.shared_journeys
  where activity_id=p_activity and owner_id=auth.uid() for update;
 if not found or v_audience<>(case when p_mode='household' then 'household' else 'friends' end) then
  raise exception 'Journey publication does not match this audience';
 end if;
 if p_mode='household' and not exists(select 1 from public.household_members() as m
  where (to_jsonb(m)->>'user_id')=auth.uid()::text) then
  raise exception 'Household membership required';
 end if;
 if p_mode='selected' then
  if coalesce(array_length(p_recipients,1),0)=0 then raise exception 'Select a friend'; end if;
  foreach v_id in array p_recipients loop
   if v_id=auth.uid() or not exists(
    select 1 from public.my_friends() as f where (to_jsonb(f)->>'user_id')=v_id::text
   ) then raise exception 'Recipient must be a current friend'; end if;
  end loop;
 end if;
 insert into public.social_journey_policies(activity_id,owner_id,mode)
 values(p_activity,auth.uid(),p_mode)
 on conflict(activity_id) do update set owner_id=excluded.owner_id,mode=excluded.mode;
 delete from public.social_journey_recipients where activity_id=p_activity;
 if p_mode='selected' then
  insert into public.social_journey_recipients(activity_id,user_id)
   select p_activity, unnest(p_recipients) on conflict do nothing;
 end if;
end $$;

create or replace function public.read_social_journey(p_activity uuid)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_snapshot jsonb; v_owner uuid;
begin
 if not public.can_view_social_journey(p_activity) then return null; end if;
 select snapshot,owner_id into v_snapshot,v_owner from public.shared_journeys
 where activity_id=p_activity;
 if v_snapshot is null then return null; end if;
 return jsonb_build_object('activity_id',p_activity,'owner_id',v_owner,'snapshot',v_snapshot);
end $$;

-- Never return the raw owner activities table to a viewer.
create or replace function public.my_social_journey_feed()
returns table(activity_id uuid,owner_id uuid,title text,activity text,started_at timestamptz,distance_km numeric)
language sql security definer set search_path=''
as $$
 select j.activity_id,j.owner_id,j.snapshot->>'title',j.snapshot->>'activity',
  a.started_at,(a.distance_meters/1000.0)::numeric
 from public.shared_journeys j
 join public.social_journey_policies p on p.activity_id=j.activity_id and p.owner_id=j.owner_id
 join public.activities a on a.id=j.activity_id and a.owner_id=j.owner_id
 where auth.uid() is not null and j.owner_id<>auth.uid()
   and public.can_view_social_journey(j.activity_id)
 order by a.started_at desc limit 100
$$;

revoke all on function public.can_view_social_journey(uuid) from public,anon,authenticated;
revoke all on function public.configure_social_journey(uuid,text,uuid[]) from public,anon,authenticated;
revoke all on function public.read_social_journey(uuid) from public,anon,authenticated;
revoke all on function public.my_social_journey_feed() from public,anon,authenticated;
grant execute on function public.configure_social_journey(uuid,text,uuid[]) to authenticated;
grant execute on function public.read_social_journey(uuid) to authenticated;
grant execute on function public.my_social_journey_feed() to authenticated;
-- can_view is invoked inside a SECURITY DEFINER function; callers cannot use it directly.
commit;
