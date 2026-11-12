-- Household history publication: a failure to publish an activity is recorded, not dropped.
--
-- publish_household_history (20261208000000) skips an activity it cannot publish so one bad recording does not hold up the
-- rest, but it reported the reason only as a NOTICE. A migration prints nothing of that, so a run could finish "successfully"
-- with activities missing and nobody the wiser. Now every failure is kept (activity, owner, SQLSTATE, a short reason: never
-- a coordinate), shown as a WARNING, counted in household_history_status(), and cleared when the activity later publishes.
-- Which activities remain waiting is also visible there. Forward only; safe to run again.
begin;

create table if not exists public.household_history_failures(
 activity_id uuid primary key references public.activities(id) on delete cascade,
 owner_id uuid not null,
 sqlstate text not null,
 reason text not null,
 attempts integer not null default 1,
 failed_at timestamptz not null default now());
alter table public.household_history_failures enable row level security;
revoke all on public.household_history_failures from public,anon,authenticated;

create or replace function public.publish_household_history(p_owner uuid default null) returns integer
language plpgsql security definer set search_path='' as $$
declare r record; n integer:=0; f integer:=0;
begin
 for r in
  select a.id,a.owner_id,a.revision from public.activities a
  where a.owner_id in (select m.user_id from public.household_memberships m where p_owner is null or m.user_id=p_owner)
   and a.id in (select public.auto_share_candidates(a.owner_id))
  order by a.owner_id,a.started_at
 loop
  begin
   perform public.publish_social_journey(r.owner_id,r.id,r.revision,'household','household','{}'::uuid[],public.household_snapshot(r.id),true);
   n:=n+1;
   delete from public.household_history_failures where activity_id=r.id;
  exception when others then
   f:=f+1;
   insert into public.household_history_failures(activity_id,owner_id,sqlstate,reason)
    values(r.id,r.owner_id,sqlstate,left(sqlerrm,300))
   on conflict(activity_id) do update set sqlstate=excluded.sqlstate,reason=excluded.reason,
    attempts=public.household_history_failures.attempts+1,failed_at=now();
   raise warning 'Household history: activity % was not published (%: %)',r.id,sqlstate,left(sqlerrm,300);
  end;
 end loop;
 -- A record only means something while the activity is still waiting: one made private since, or whose owner left, is no failure.
 delete from public.household_history_failures x
  where (p_owner is null or x.owner_id=p_owner) and not (x.activity_id in (select public.auto_share_candidates(x.owner_id)));
 if f>0 then raise warning 'Household history: % published, % NOT published (see household_history_failures)',n,f; end if;
 return n;
end $$;
revoke all on function public.publish_household_history(uuid) from public,anon,authenticated;
grant execute on function public.publish_household_history(uuid) to service_role;

-- Per household member: how much of their history is in the database, shared with the household (by any means), still waiting and failing. Counts only,
-- so it can be read and pasted anywhere. Waiting = eligible for sharing and not yet published (a recording that exists
-- only on a phone is not counted: the database cannot publish what it has not received).
create or replace function public.household_history_status()
returns table(owner_id uuid,sharing_on boolean,since timestamptz,activities integer,with_route integer,shared_with_household integer,waiting integer,failing integer,newest_activity timestamptz)
language sql stable security definer set search_path='' as $$
 select m.user_id,coalesce(s.enabled,false),s.since,
  (select count(*)::integer from public.activities a where a.owner_id=m.user_id),
  (select count(*)::integer from public.activities a where a.owner_id=m.user_id and jsonb_typeof(a.route_points)='array' and jsonb_array_length(a.route_points)>=2),
  (select count(*)::integer from public.shared_journeys j where j.owner_id=m.user_id and j.audience='household'),
  (select count(*)::integer from public.auto_share_candidates(m.user_id)),
  (select count(*)::integer from public.household_history_failures x where x.owner_id=m.user_id),
  (select max(a.started_at) from public.activities a where a.owner_id=m.user_id)
 from (select distinct user_id from public.household_memberships) m
 left join public.activity_auto_share s on s.user_id=m.user_id
 order by m.user_id
$$;
revoke all on function public.household_history_status() from public,anon,authenticated;
grant execute on function public.household_history_status() to service_role;

-- Anything that failed before this migration existed is tried again now, and recorded if it still fails.
select public.publish_household_history();
commit;
