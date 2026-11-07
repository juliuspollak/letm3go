-- Activity sharing from the activity's own Share sheet.
--
-- * Each recipient now records why it has access: through the owner's
--   household, as a chosen friend, or both. Access is re-checked on every read
--   against that reason only, so someone who leaves the household loses a
--   household share even if they are also a friend who was not chosen.
-- * my_activity_sharing(activity) returns the current recipients so the sheet
--   opens with the existing selection; my_social_publications also returns
--   them for the Activities list indicators.
-- * Publishing a public link clears private recipients in the same transaction.
--
-- Safe to re-run. Forward-only: 20261118000000 is not edited.
begin;

alter table public.social_journey_recipients add column if not exists via_household boolean not null default false;
alter table public.social_journey_recipients add column if not exists via_friend boolean not null default false;
-- Rows written before this migration carry no reason; derive it from the mode.
-- A mixed or all share cannot say which recipients came from where, so they
-- keep both reasons (the previous behaviour) until the owner saves again.
update public.social_journey_recipients r set
 via_household = p.mode in ('household','mixed','all'),
 via_friend = p.mode in ('friends','selected','mixed','all')
from public.social_journey_policies p
where p.activity_id=r.activity_id and not r.via_household and not r.via_friend;

create or replace function public.can_view_social_journey(p_activity uuid)
returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_owner uuid; v_audience text; v_mode text; v_household boolean; v_friend boolean;
begin
 if auth.uid() is null then return false; end if;
 select j.owner_id, j.audience, p.mode into v_owner, v_audience, v_mode
 from public.shared_journeys j
 join public.social_journey_policies p on p.activity_id=j.activity_id and p.owner_id=j.owner_id
 where j.activity_id=p_activity;
 if not found then return false; end if;
 if auth.uid()=v_owner then return true; end if;
 -- Only someone included when the owner last saved, for the reason recorded.
 select r.via_household, r.via_friend into v_household, v_friend
 from public.social_journey_recipients r where r.activity_id=p_activity and r.user_id=auth.uid();
 if not found then return false; end if;
 if v_household and v_mode in ('household','mixed','all') and exists(
   select 1 from public.household_members() as m where (to_jsonb(m)->>'user_id')=v_owner::text) then return true; end if;
 if v_friend and v_audience='friends' and v_mode in ('friends','selected','mixed','all') and exists(
   select 1 from public.my_friends() as f where (to_jsonb(f)->>'user_id')=v_owner::text) then return true; end if;
 return false;
end $$;

create or replace function public.configure_social_journey(
 p_activity uuid, p_mode text, p_recipients uuid[] default '{}'::uuid[])
returns void
language plpgsql security definer set search_path=''
as $$
declare v_audience text; v_id uuid;
begin
 if auth.uid() is null or p_mode not in ('friends','household','selected','mixed','all') then
  raise exception 'Invalid social audience';
 end if;
 if coalesce(array_length(p_recipients,1),0)>100 then raise exception 'Too many recipients'; end if;
 select audience into v_audience from public.shared_journeys
  where activity_id=p_activity and owner_id=auth.uid() for update;
 if not found or v_audience<>(case when p_mode='household' then 'household' else 'friends' end) then
  raise exception 'Journey publication does not match this audience';
 end if;
 if p_mode in ('household','mixed','all') and not exists(select 1 from public.household_members() as m
  where (to_jsonb(m)->>'user_id')=auth.uid()::text) then
  raise exception 'Household membership required';
 end if;
 if p_mode in ('selected','mixed') then
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
 -- The new selection replaces the old one entirely, in this transaction.
 delete from public.social_journey_recipients where activity_id=p_activity;
 -- Explicitly snapshot current recipients. Future friends and new household
 -- members must not inherit the owner's historical shares automatically.
 if p_mode in ('friends','all') then
  insert into public.social_journey_recipients(activity_id,user_id,via_friend)
   select p_activity,(to_jsonb(f)->>'user_id')::uuid,true from public.my_friends() as f
   where (to_jsonb(f)->>'user_id') is not null and (to_jsonb(f)->>'user_id')<>auth.uid()::text
   on conflict(activity_id,user_id) do update set via_friend=true;
 end if;
 if p_mode in ('household','mixed','all') then
  insert into public.social_journey_recipients(activity_id,user_id,via_household)
   select p_activity,(to_jsonb(m)->>'user_id')::uuid,true from public.household_members() as m
   where (to_jsonb(m)->>'user_id') is not null and (to_jsonb(m)->>'user_id')<>auth.uid()::text
   on conflict(activity_id,user_id) do update set via_household=true;
 end if;
 if p_mode in ('selected','mixed') then
  insert into public.social_journey_recipients(activity_id,user_id,via_friend)
   select p_activity,unnest(p_recipients),true
   on conflict(activity_id,user_id) do update set via_friend=true;
 end if;
end $$;
revoke all on function public.configure_social_journey(uuid,text,uuid[]) from public,anon,authenticated;

-- A public link has no private recipients: switching to one clears them in the
-- same transaction as the new snapshot.
create or replace function public.commit_shared_journey(p_id uuid,p_owner uuid,p_revision integer,p_audience text,p_snapshot jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare trip public.activities; result uuid;
begin
 select * into trip from public.activities where id=p_id and owner_id=p_owner for update;
 if not found or trip.revision<>p_revision then raise exception 'Activity changed or was deleted. Review the preview again.'; end if;
 if p_audience not in ('public','household','friends') then raise exception 'Invalid audience'; end if;
 insert into public.shared_journeys(activity_id,owner_id,audience,snapshot) values(p_id,p_owner,p_audience,p_snapshot)
 on conflict(activity_id) do update set snapshot=excluded.snapshot,audience=excluded.audience returning token into result;
 if p_audience='public' then delete from public.social_journey_policies where activity_id=p_id; end if;
 return result;
end $$;
revoke all on function public.commit_shared_journey(uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.commit_shared_journey(uuid,uuid,integer,text,jsonb) to service_role;

-- The owner's current sharing for one activity: what the Share sheet opens with.
create or replace function public.my_activity_sharing(p_activity uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when auth.uid() is null then null else coalesce((
  select jsonb_build_object(
   'audience', j.audience,
   'household', coalesce(p.mode in ('household','mixed','all'), false),
   'friends', coalesce((select jsonb_agg(r.user_id order by r.user_id) from public.social_journey_recipients r
     where r.activity_id=j.activity_id and r.via_friend), '[]'::jsonb))
  from public.shared_journeys j
  left join public.social_journey_policies p on p.activity_id=j.activity_id and p.owner_id=j.owner_id
  where j.activity_id=p_activity and j.owner_id=auth.uid()),
  jsonb_build_object('audience','private','household',false,'friends','[]'::jsonb)) end
$$;
revoke all on function public.my_activity_sharing(uuid) from public,anon,authenticated;
grant execute on function public.my_activity_sharing(uuid) to authenticated;

-- The owner's shared activities with who can see them, for the Activities list.
drop function if exists public.my_social_publications();
create function public.my_social_publications()
returns table(activity_id uuid,title text,audience text,mode text,token text,household boolean,friend_ids uuid[])
language sql stable security definer set search_path=''
as $$
 select j.activity_id,j.snapshot->>'title',j.audience::text,p.mode,j.token::text,
  coalesce(p.mode in ('household','mixed','all'),false),
  coalesce((select array_agg(r.user_id order by r.user_id) from public.social_journey_recipients r
   where r.activity_id=j.activity_id and r.via_friend),'{}'::uuid[])
 from public.shared_journeys j
 left join public.social_journey_policies p on p.activity_id=j.activity_id and p.owner_id=j.owner_id
 where auth.uid() is not null and j.owner_id=auth.uid()
   and j.audience in ('public','friends','household')
 order by j.created_at desc limit 500
$$;
revoke all on function public.my_social_publications() from public,anon,authenticated;
grant execute on function public.my_social_publications() to authenticated;

commit;
