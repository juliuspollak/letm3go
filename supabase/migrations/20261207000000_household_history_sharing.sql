-- Sharing earlier (completed) activities with the household, only for owners who say so.
--
-- 20261202000000 shares an owner's NEW activities with the household (activity_auto_share.since is where
-- "new" begins). That meaning is unchanged. This adds a second, explicit, per-owner consent: "also share
-- my earlier completed activities". Membership alone never implies it. With it, the SAME rules decide
-- what is eligible (finished, not decided private, not already shared, owner is a household member and
-- has household sharing on), minus only the start-date limit. The publications themselves are made by the
-- existing publish path (Home/Work masking, snapshot, recipients), driven from the activities already
-- stored in Supabase by the journeys function's `backfillHistory` action; nothing is copied raw here.
begin;

create table if not exists public.household_history_consent (
 user_id uuid primary key references auth.users(id) on delete cascade,
 consented_at timestamptz not null default now()
);
-- Which publications rely on that consent (an activity that began before sharing began), so that
-- withdrawing the consent can withdraw exactly those, atomically with the publication.
create table if not exists public.household_history_published (
 activity_id uuid primary key references public.activities(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 published_at timestamptz not null default now()
);
create index if not exists household_history_published_owner_idx on public.household_history_published(owner_id);
alter table public.household_history_consent enable row level security;
alter table public.household_history_published enable row level security;
revoke all on public.household_history_consent,public.household_history_published from anon,authenticated;
grant all on public.household_history_consent,public.household_history_published to service_role;

-- The one eligibility rule for automatic publication (new activities, and earlier ones for an owner
-- who consented). Same as before plus the history clause.
create or replace function public.auto_share_allowed(p_owner uuid,p_activity uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.activities a
  join public.activity_auto_share s on s.user_id=a.owner_id and s.enabled
  where a.id=p_activity and a.owner_id=p_owner
   and a.ended_at is not null
   and (a.started_at>=s.since or exists(select 1 from public.household_history_consent h where h.user_id=a.owner_id))
   and exists(select 1 from public.household_memberships m where m.user_id=p_owner)
   and not exists(select 1 from public.activity_share_decisions d where d.activity_id=a.id)
   and not public.activity_ref_is_private(p_owner,p_activity::text)
 )
$$;

-- The activities automatic sharing would publish for one owner now: finished, with a route to show, not decided
-- private, not already shared, owner a household member with household sharing on, and either recorded since
-- sharing began or (owner agreed) earlier. One definition, used by the list the app works from and by the count it shows.
create or replace function public.auto_share_candidates(p_owner uuid) returns setof uuid
language sql stable security definer set search_path='' as $$
 select a.id from public.activities a
 join public.activity_auto_share s on s.user_id=a.owner_id and s.enabled
 where a.owner_id=p_owner
  and exists(select 1 from public.household_memberships m where m.user_id=a.owner_id)
  and a.ended_at is not null and jsonb_typeof(a.route_points)='array' and jsonb_array_length(a.route_points)>=2
  and (a.started_at>=s.since or exists(select 1 from public.household_history_consent h where h.user_id=a.owner_id))
  and not public.activity_ref_is_private(a.owner_id,a.id::text)
  and not exists(select 1 from public.activity_share_decisions d where d.activity_id=a.id)
  and not exists(select 1 from public.shared_journeys j where j.activity_id=a.id)
$$;
revoke all on function public.auto_share_candidates(uuid) from public,anon,authenticated;

create or replace function public.my_auto_share_pending(p_limit integer default 10,p_exclude uuid[] default '{}')
returns table(activity_id uuid,revision integer)
language sql stable security definer set search_path='' as $$
 select a.id,a.revision from public.activities a
 where auth.uid() is not null and a.owner_id=auth.uid()
  and a.id in (select public.auto_share_candidates(auth.uid()))
  and not (a.id=any(coalesce(p_exclude,'{}')))
 order by a.started_at desc limit least(greatest(coalesce(p_limit,10),1),25)
$$;
revoke all on function public.my_auto_share_pending(integer,uuid[]) from public,anon,authenticated;
grant execute on function public.my_auto_share_pending(integer,uuid[]) to authenticated;

-- The same publication as before, plus: it holds the history consent row (so withdrawing it waits for an
-- in-flight publication or is seen by it) and records a publication that relied on it, in the same transaction.
create or replace function public.publish_social_journey(
 p_owner uuid,p_activity uuid,p_revision integer,p_audience text,p_mode text,
 p_recipients uuid[],p_snapshot jsonb,p_auto boolean default false)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare v_token uuid; v_current integer;
begin
 if p_owner is null then raise exception 'Sign in required'; end if;
 perform set_config('request.jwt.claim.sub',p_owner::text,true);
 if auth.uid() is distinct from p_owner then raise exception 'Sign in required'; end if;
 if p_audience not in ('friends','household') or p_mode is null then raise exception 'Invalid social audience'; end if;
 if p_auto then
  if p_audience<>'household' or p_mode<>'household' or coalesce(cardinality(p_recipients),0)<>0 then raise exception 'Automatic sharing is household only'; end if;
  perform 1 from public.household_memberships where user_id=p_owner for share;
  if not found then raise exception 'Automatic sharing consent unavailable'; end if;
  perform 1 from public.activity_auto_share where user_id=p_owner for share;
  if not found then raise exception 'Automatic sharing consent unavailable'; end if;
  perform 1 from public.household_history_consent where user_id=p_owner for share;
 end if;
 select revision into v_current from public.activities
 where id=p_activity and owner_id=auth.uid() for update;
 if not found or v_current<>p_revision then raise exception 'Activity revision changed'; end if;
 if p_auto and not public.auto_share_allowed(p_owner,p_activity) then raise exception 'Activity is not eligible for automatic sharing'; end if;
 select public.commit_shared_journey(p_activity,auth.uid(),p_revision,p_audience,p_snapshot) into v_token;
 perform public.configure_social_journey(p_activity,p_mode,coalesce(p_recipients,'{}'::uuid[]));
 if p_auto and exists(select 1 from public.activities a join public.activity_auto_share s on s.user_id=a.owner_id where a.id=p_activity and a.started_at<s.since) then
  insert into public.household_history_published(activity_id,owner_id) values(p_activity,p_owner) on conflict(activity_id) do nothing;
 end if;
 if not coalesce(p_auto,false) then perform public.remember_manual_share(p_owner,p_activity); end if;
 return v_token;
end $$;
revoke all on function public.publish_social_journey(uuid,uuid,integer,text,text,uuid[],jsonb,boolean) from public,anon,authenticated;
grant execute on function public.publish_social_journey(uuid,uuid,integer,text,text,uuid[],jsonb,boolean) to service_role;

-- A deliberate (manual) share is the owner's own decision, not something the history consent made: it is no longer
-- tracked as relying on that consent, so withdrawing the consent leaves it alone.
create or replace function public.remember_manual_share(p_owner uuid,p_activity uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 insert into public.activity_share_decisions(activity_id,owner_id)
  select a.id,a.owner_id from public.activities a where a.id=p_activity and a.owner_id=p_owner
 on conflict(activity_id) do nothing;
 delete from public.household_history_published where activity_id=p_activity and owner_id=p_owner;
end $$;
revoke all on function public.remember_manual_share(uuid,uuid) from public,anon,authenticated;
grant execute on function public.remember_manual_share(uuid,uuid) to service_role;

-- What the owner sees and can change. `waiting`: earlier completed activities with a route that would be
-- shared now; `needsHome`: no saved Home place yet, so a route cannot be masked and nothing is published.
create or replace function public.my_history_sharing() returns jsonb
language sql stable security definer set search_path='' as $$
 select case when auth.uid() is null then null else jsonb_build_object(
  'enabled',exists(select 1 from public.household_history_consent h where h.user_id=auth.uid())
   and exists(select 1 from public.household_memberships m where m.user_id=auth.uid()),
  'consentedAt',(select h.consented_at from public.household_history_consent h where h.user_id=auth.uid()),
  'published',(select count(*) from public.household_history_published p where p.owner_id=auth.uid()),
  'waiting',(select count(*) from public.auto_share_candidates(auth.uid())),
  'needsHome',not exists(select 1 from public.saved_places p where p.owner_id=auth.uid() and p.kind='home')) end
$$;

create or replace function public.set_history_sharing(p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if p_enabled then
  perform 1 from public.household_memberships where user_id=auth.uid();
  if not found then raise exception 'Join a household first'; end if;
  insert into public.household_history_consent(user_id) values(auth.uid()) on conflict(user_id) do nothing;
 else
  -- Withdrawing: no new earlier publications, and the ones made on this consent are removed (no private
  -- decision is recorded, so they can be shared again if the owner opts in again).
  delete from public.household_history_consent where user_id=auth.uid();
  delete from public.shared_journeys j where j.owner_id=auth.uid()
   and j.activity_id in (select p.activity_id from public.household_history_published p where p.owner_id=auth.uid());
  delete from public.household_history_published where owner_id=auth.uid();
 end if;
end $$;
revoke all on function public.my_history_sharing(),public.set_history_sharing(boolean) from public,anon,authenticated;
grant execute on function public.my_history_sharing(),public.set_history_sharing(boolean) to authenticated;
commit;
