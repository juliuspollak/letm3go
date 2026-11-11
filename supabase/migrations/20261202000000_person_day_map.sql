-- Person day map: one person's day of movement for household members and friends.
--
-- Completed activities: nothing new is stored. A day is composed from the
-- redacted snapshots people already share (Home and Work masked, access
-- rechecked on every read by can_view_social_journey), so hiding or unsharing an
-- activity removes its geometry from every viewer in the same transaction.
-- Private audiences additionally get a per-point time `t` (epoch seconds) so the
-- timeline can place the person; public links never do.
--
-- Live activity: one bounded trail per person, written with the same device
-- credentials as live location (household or friend), read only while the viewer
-- may see that person's live location. Friends never see points near Home/Work.
-- The trail is deleted when the activity finishes, is hidden, or sharing stops.
--
-- Household auto-sharing: members' new activities are shared with the household
-- by default, from the moment they joined (or turned it back on). Any manual
-- share/unshare is remembered so auto-sharing never overrides the owner.
--
-- Additive and safe to re-run. Nothing is deleted or rewritten.
begin;

-- ---------------------------------------------------------------- auto-share
create table if not exists public.activity_auto_share (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default true,
 since timestamptz not null default now()
);
alter table public.activity_auto_share enable row level security;
revoke all on public.activity_auto_share from anon,authenticated;
grant all on public.activity_auto_share to service_role;

create table if not exists public.activity_share_decisions (
 activity_id uuid primary key references public.activities(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 decided_at timestamptz not null default now()
);
alter table public.activity_share_decisions enable row level security;
revoke all on public.activity_share_decisions from anon,authenticated;
grant all on public.activity_share_decisions to service_role;

-- Joining a household switches automatic sharing on from now; earlier activities
-- are never swept in.
create or replace function public.start_auto_share_on_join() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.activity_auto_share(user_id,enabled,since) values(new.user_id,true,now())
 on conflict(user_id) do update set enabled=true,since=now();
 return new;
end $$;
drop trigger if exists start_auto_share_on_join on public.household_memberships;
create trigger start_auto_share_on_join after insert on public.household_memberships
for each row execute function public.start_auto_share_on_join();

-- A manual share or unshare is the owner's decision for that activity.
create or replace function public.remember_share_decision() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_activity uuid:=coalesce(new.activity_id,old.activity_id); v_owner uuid:=coalesce(new.owner_id,old.owner_id);
begin
 insert into public.activity_share_decisions(activity_id,owner_id)
  select v_activity,v_owner where exists(select 1 from public.activities a where a.id=v_activity)
 on conflict(activity_id) do nothing;
 return null;
end $$;
drop trigger if exists remember_share_decision on public.shared_journeys;
create trigger remember_share_decision after insert or delete on public.shared_journeys
for each row execute function public.remember_share_decision();

create or replace function public.my_auto_share() returns jsonb
language sql stable security definer set search_path='' as $$
 select case when auth.uid() is null then null else jsonb_build_object(
  'enabled',coalesce((select a.enabled from public.activity_auto_share a where a.user_id=auth.uid()),false)
   and exists(select 1 from public.household_memberships m where m.user_id=auth.uid()),
  'since',(select a.since from public.activity_auto_share a where a.user_id=auth.uid())) end
$$;
create or replace function public.set_auto_share(p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 -- Turning it back on starts from now: what was recorded while it was off stays private.
 insert into public.activity_auto_share(user_id,enabled,since) values(auth.uid(),p_enabled,now())
 on conflict(user_id) do update set enabled=excluded.enabled,
  since=case when excluded.enabled and not public.activity_auto_share.enabled then now() else public.activity_auto_share.since end;
end $$;
-- Finished activities waiting to be shared with the household: recorded since
-- sharing began, never decided by the owner, not yet shared.
create or replace function public.my_auto_share_pending(p_limit integer default 10)
returns table(activity_id uuid,revision integer)
language sql stable security definer set search_path='' as $$
 select a.id,a.revision from public.activities a
 join public.activity_auto_share s on s.user_id=a.owner_id and s.enabled
 where auth.uid() is not null and a.owner_id=auth.uid()
  and exists(select 1 from public.household_memberships m where m.user_id=a.owner_id)
  and a.ended_at is not null and a.started_at>=s.since
  and not exists(select 1 from public.activity_share_decisions d where d.activity_id=a.id)
  and not exists(select 1 from public.shared_journeys j where j.activity_id=a.id)
 order by a.started_at limit least(greatest(coalesce(p_limit,10),1),25)
$$;
revoke all on function public.my_auto_share(),public.set_auto_share(boolean),public.my_auto_share_pending(integer) from public,anon,authenticated;
grant execute on function public.my_auto_share(),public.set_auto_share(boolean),public.my_auto_share_pending(integer) to authenticated;

-- ------------------------------------------------------------- completed day
-- Who may open this person's map: themselves, a household member, or a friend.
-- Access to each activity is still decided by can_view_social_journey.
create or replace function public.my_shared_day(p_owner uuid,p_from timestamptz,p_to timestamptz,p_known text[] default '{}')
returns table(activity_id uuid,started_at timestamptz,ended_at timestamptz,activity text,title text,etag text,points jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or p_owner is null or p_from is null or p_to is null or p_to<=p_from
  or p_to-p_from>interval '3 days' then return; end if;
 return query
  with visible as (
   select j.activity_id,a.started_at,a.ended_at,j.snapshot,md5(j.snapshot::text) as tag
   from public.shared_journeys j join public.activities a on a.id=j.activity_id
   where j.owner_id=p_owner and a.started_at<p_to and coalesce(a.ended_at,a.started_at)>p_from
    and public.can_view_social_journey(j.activity_id)
   order by a.started_at limit 100)
  select v.activity_id,v.started_at,v.ended_at,v.snapshot->>'activity',v.snapshot->>'title',v.tag,
   case when v.tag=any(coalesce(p_known,'{}')) then null else coalesce(v.snapshot->'points','[]'::jsonb) end
  from visible v order by v.started_at;
end $$;
revoke all on function public.my_shared_day(uuid,timestamptz,timestamptz,text[]) from public,anon,authenticated;
grant execute on function public.my_shared_day(uuid,timestamptz,timestamptz,text[]) to authenticated;

-- ---------------------------------------------------------------- live trail
create table if not exists public.live_trails (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 activity_ref text not null check(length(activity_ref) between 1 and 64),
 started_at timestamptz not null default now(),
 last_seq integer not null default 0,
 points jsonb not null default '[]'::jsonb,
 hidden_ref text,
 updated_at timestamptz not null default now()
);
alter table public.live_trails enable row level security;
revoke all on public.live_trails from anon,authenticated;
grant all on public.live_trails to service_role;

-- Appends [lat, lon, t, segment] points. Idempotent and order-free: a repeated or
-- late batch merges by time `t`, and only the newest 3000 points are kept.
create or replace function public.append_live_trail(p_token text,p_ref text,p_seq integer,p_points jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_hash bytea; v_old public.live_trails; v_merged jsonb; v_el jsonb; v_had boolean;
begin
 if p_token is null or length(p_token)<>64 or p_ref is null or length(p_ref) not between 1 and 64 then return false; end if;
 if p_points is null or jsonb_typeof(p_points)<>'array' or jsonb_array_length(p_points)>200 then raise exception 'Invalid trail'; end if;
 for v_el in select * from jsonb_array_elements(p_points) loop
  if jsonb_typeof(v_el)<>'array' or jsonb_array_length(v_el)<>4
   or jsonb_typeof(v_el->0)<>'number' or jsonb_typeof(v_el->1)<>'number' or jsonb_typeof(v_el->2)<>'number' or jsonb_typeof(v_el->3)<>'number'
   or (v_el->>0)::float8 not between -90 and 90 or (v_el->>1)::float8 not between -180 and 180
   or (v_el->>2)::float8 not between 946684800 and extract(epoch from now()+interval '5 minutes')
  then raise exception 'Invalid trail'; end if;
 end loop;
 v_hash:=sha256(convert_to(p_token,'UTF8'));
 select l.user_id into v_user from public.household_live_locations l
  where l.publish_token_hash=v_hash and l.publish_token_expires_at>now() and l.enabled
   and exists(select 1 from public.household_memberships m where m.user_id=l.user_id);
 if v_user is null then
  select s.user_id into v_user from public.friend_presence_shares s
   where s.publish_token_hash=v_hash and s.publish_token_expires_at>now() and s.enabled;
 end if;
 if v_user is null then return false; end if;
 select * into v_old from public.live_trails where owner_id=v_user for update;
 v_had:=found;
 if v_had and v_old.hidden_ref=p_ref then return false; end if;
 if not v_had or v_old.activity_ref<>p_ref then
  v_merged:='[]'::jsonb;
 else v_merged:=v_old.points; end if;
 select coalesce(jsonb_agg(e.p order by e.t),'[]'::jsonb) into v_merged from (
  select distinct on (t) p,t from (
   select x as p,(x->>2)::float8 as t from jsonb_array_elements(v_merged) x
   union all select x,(x->>2)::float8 from jsonb_array_elements(p_points) x) u
  order by t desc limit 3000) e;
 insert into public.live_trails(owner_id,activity_ref,started_at,last_seq,points,hidden_ref,updated_at)
 values(v_user,p_ref,now(),coalesce(p_seq,0),v_merged,case when v_had then v_old.hidden_ref end,now())
 on conflict(owner_id) do update set activity_ref=excluded.activity_ref,
  started_at=case when public.live_trails.activity_ref=excluded.activity_ref then public.live_trails.started_at else now() end,
  last_seq=greatest(case when public.live_trails.activity_ref=excluded.activity_ref then public.live_trails.last_seq else 0 end,excluded.last_seq),
  points=excluded.points,updated_at=now();
 return true;
end $$;
revoke all on function public.append_live_trail(text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.append_live_trail(text,text,integer,jsonb) to anon,authenticated;

-- The owner finished, discarded or hid the activity: its live trail is gone.
create or replace function public.end_live_trail(p_ref text default null,p_hide boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if p_hide and p_ref is not null then
  insert into public.live_trails(owner_id,activity_ref,points,hidden_ref) values(auth.uid(),p_ref,'[]'::jsonb,p_ref)
  on conflict(owner_id) do update set hidden_ref=p_ref,
   points=case when public.live_trails.activity_ref=p_ref then '[]'::jsonb else public.live_trails.points end;
 elsif p_ref is null or exists(select 1 from public.live_trails t where t.owner_id=auth.uid() and t.activity_ref=p_ref) then
  update public.live_trails set points='[]'::jsonb,updated_at=now() where owner_id=auth.uid() and (p_ref is null or activity_ref=p_ref);
 end if;
end $$;
revoke all on function public.end_live_trail(text,boolean) from public,anon,authenticated;
grant execute on function public.end_live_trail(text,boolean) to authenticated;

-- Turning live sharing off, or leaving the household, clears the trail.
create or replace function public.clear_live_trail_on_stop() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not new.enabled then
  update public.live_trails set points='[]'::jsonb,updated_at=now() where owner_id=new.user_id;
 end if;
 return new;
end $$;
drop trigger if exists clear_live_trail_on_stop on public.household_live_locations;
create trigger clear_live_trail_on_stop after update of enabled on public.household_live_locations
for each row execute function public.clear_live_trail_on_stop();
drop trigger if exists clear_live_trail_on_stop on public.friend_presence_shares;
create trigger clear_live_trail_on_stop after update of enabled on public.friend_presence_shares
for each row execute function public.clear_live_trail_on_stop();

-- What a viewer may see of someone's live trail. p_after returns only newer points.
create or replace function public.my_live_trail(p_owner uuid,p_after double precision default 0)
returns table(activity_ref text,started_at timestamptz,updated_at timestamptz,points jsonb)
language plpgsql stable security definer set search_path='' as $$
declare v_household boolean; v_friend boolean; v_self boolean; v_t public.live_trails;
begin
 if auth.uid() is null or p_owner is null then return; end if;
 v_self:=auth.uid()=p_owner;
 v_household:=exists(select 1 from public.household_memberships me join public.household_memberships o on o.household_id=me.household_id
   where me.user_id=auth.uid() and o.user_id=p_owner and me.user_id<>o.user_id)
  and exists(select 1 from public.household_live_locations l where l.user_id=p_owner and l.enabled);
 v_friend:=exists(select 1 from public.my_friends() f where f.user_id=p_owner)
  and exists(select 1 from public.friend_presence_shares s where s.user_id=p_owner and s.enabled);
 if not (v_self or v_household or v_friend) then return; end if;
 select * into v_t from public.live_trails t where t.owner_id=p_owner and t.updated_at>now()-interval '12 hours';
 if not found then return; end if;
 return query select v_t.activity_ref,v_t.started_at,v_t.updated_at,
  coalesce((select jsonb_agg(x order by (x->>2)::float8) from jsonb_array_elements(v_t.points) x
   where (x->>2)::float8>coalesce(p_after,0)
    and (v_self or v_household or not exists(select 1 from public.saved_places sp
     where sp.owner_id=p_owner and sp.kind in ('home','work')
      and sqrt(power(((x->>0)::float8-sp.latitude)*111320,2)+power(((x->>1)::float8-sp.longitude)*111320*cos(radians(sp.latitude)),2))<=sp.radius+300))),'[]'::jsonb);
end $$;
revoke all on function public.my_live_trail(uuid,double precision) from public,anon,authenticated;
grant execute on function public.my_live_trail(uuid,double precision) to authenticated;

commit;
