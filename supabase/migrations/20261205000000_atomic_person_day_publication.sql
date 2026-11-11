-- Atomic household consent and complete live write ordering. Forward-only;
-- follows PR #54's owner lock migration and preserves the existing geometry stores.
begin;
create or replace function public.append_live_trail(p_token text,p_ref text,p_seq integer,p_points jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_hash bytea; v_old public.live_trails; v_merged jsonb; v_el jsonb; v_had boolean; v_endt float8;
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
 -- Follow the account deletion FK lock order: owner, credential, owner advisory,
 -- then trail. Resolve the token without a lock first, then revalidate it under
 -- its row lock AFTER the owner lock, so disabling cannot pass a stale check.
 perform 1 from auth.users where id=v_user for key share;
 if not found then return false; end if;
 perform 1 from public.household_live_locations l where l.user_id=v_user
  and l.publish_token_hash=v_hash and l.publish_token_expires_at>now() and l.enabled
  and exists(select 1 from public.household_memberships m where m.user_id=l.user_id) for share;
 if not found then
  perform 1 from public.friend_presence_shares f where f.user_id=v_user
   and f.publish_token_hash=v_hash and f.publish_token_expires_at>now() and f.enabled for share;
  if not found then return false; end if;
 end if;
 -- Serialise append, hide and finish for this owner, including when no trail row exists.
 perform pg_catalog.pg_advisory_xact_lock(105942,pg_catalog.hashtext(v_user::text));
 -- p_seq = -2: the owner made this activity private. Recorded for good (it also keeps
 -- the finished activity out of automatic sharing), the trail is cleared, and no later
 -- batch for it is accepted, however late it arrives.
 if p_seq=-2 then
  insert into public.private_activity_refs(owner_id,ref) values(v_user,p_ref) on conflict do nothing;
  update public.live_trails set points='[]'::jsonb,roads='{}'::jsonb,updated_at=now() where owner_id=v_user and upper(activity_ref)=upper(p_ref);
  return true;
 end if;
 -- p_seq = -1: the phone says this activity is over (finished, or momentarily stopped: it
 -- may resume). The trail is cleared now, and the time it ended is remembered (the last few
 -- activities), so a late or retried batch of points from before that moment cannot bring it
 -- back as a ghost, while a resumed activity's newer points are accepted as normal.
 if p_seq is not null and p_seq<0 then
  insert into public.live_trails(owner_id,activity_ref,points,ended_at,updated_at)
   values(v_user,p_ref,'[]'::jsonb,jsonb_build_object(p_ref,extract(epoch from now())),now())
  on conflict(owner_id) do update set
   points=case when public.live_trails.activity_ref=excluded.activity_ref then '[]'::jsonb else public.live_trails.points end,
   ended_at=(select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) from (
     select e.key as k,e.value as v from jsonb_each(public.live_trails.ended_at||jsonb_build_object(p_ref,extract(epoch from now()))) e
     order by (e.value#>>'{}')::float8 desc limit 8) z),
   updated_at=now();
  return true;
 end if;
 if public.activity_ref_is_private(v_user,p_ref) then return false; end if;
 select * into v_old from public.live_trails where owner_id=v_user for update;
 v_had:=found;
 if v_had then
  select (e.value#>>'{}')::float8 into v_endt from jsonb_each(v_old.ended_at) e where upper(e.key)=upper(p_ref);
  if v_endt is not null then
   select coalesce(jsonb_agg(x),'[]'::jsonb) into p_points from jsonb_array_elements(p_points) x where (x->>2)::float8>v_endt;
   if jsonb_array_length(p_points)=0 then return true; end if;   -- all older than the stop: accepted, nothing kept
  end if;
 end if;
 if not v_had or v_old.activity_ref<>p_ref then
  v_merged:='[]'::jsonb;
 else v_merged:=v_old.points; end if;
 select coalesce(jsonb_agg(e.p order by e.t),'[]'::jsonb) into v_merged from (
  select distinct on (t) p,t from (
   select x as p,(x->>2)::float8 as t from jsonb_array_elements(v_merged) x
   union all select x,(x->>2)::float8 from jsonb_array_elements(p_points) x) u
  order by t desc limit 6000) e;
 -- Bounded, not truncated: past 3000 points the OLDER half is thinned (every second
 -- point, keeping both ends of each GPS segment), so a long drive keeps its whole
 -- timeline at lower resolution at the start and full resolution for what is recent.
 v_merged:=public.compact_trail(v_user,v_merged,3000);
 insert into public.live_trails(owner_id,activity_ref,started_at,last_seq,points,updated_at)
 values(v_user,p_ref,now(),coalesce(p_seq,0),v_merged,now())
 on conflict(owner_id) do update set activity_ref=excluded.activity_ref,
  started_at=case when public.live_trails.activity_ref=excluded.activity_ref then public.live_trails.started_at else now() end,
  last_seq=greatest(case when public.live_trails.activity_ref=excluded.activity_ref then public.live_trails.last_seq else 0 end,excluded.last_seq),
  points=excluded.points,roads=case when public.live_trails.activity_ref=excluded.activity_ref then public.live_trails.roads else '{}'::jsonb end,updated_at=now();
 return true;
end $$;

create or replace function public.end_live_trail(p_ref text default null,p_hide boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 perform 1 from auth.users where id=auth.uid() for key share;
 if not found then raise exception 'Account unavailable'; end if;
 -- Prevent an in-flight append from restoring points after a private decision.
 perform pg_catalog.pg_advisory_xact_lock(105942,pg_catalog.hashtext(auth.uid()::text));
 if p_hide and p_ref is not null then
  -- Same effect as the phone's own request (p_seq = -2): private for good, cleared now.
  insert into public.private_activity_refs(owner_id,ref) values(auth.uid(),p_ref) on conflict do nothing;
  update public.live_trails set points='[]'::jsonb,roads='{}'::jsonb,updated_at=now() where owner_id=auth.uid() and upper(activity_ref)=upper(p_ref);
 elsif p_ref is null or exists(select 1 from public.live_trails t where t.owner_id=auth.uid() and t.activity_ref=p_ref) then
  update public.live_trails set points='[]'::jsonb,roads='{}'::jsonb,
   ended_at=case when p_ref is null then ended_at else (select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) from (
     select e.key as k,e.value as v from jsonb_each(ended_at||jsonb_build_object(p_ref,extract(epoch from now()))) e order by (e.value#>>'{}')::float8 desc limit 8) z) end,
   updated_at=now()
   where owner_id=auth.uid() and (p_ref is null or activity_ref=p_ref);
 end if;
end $$;

create or replace function public.keep_activity_private(p_activity uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 perform 1 from auth.users where id=auth.uid() for key share;
 if not found then raise exception 'Account unavailable'; end if;
 -- Use the same per-owner lock as live-trail publishing and hiding.
 perform pg_catalog.pg_advisory_xact_lock(105942,pg_catalog.hashtext(auth.uid()::text));
 -- Any copy already published (for example by automatic sharing a moment earlier) goes
 -- first, which also clears who it was shared with; the decision is recorded after, so
 -- the removal cannot overwrite it.
 -- Serialise with a publication of the same activity (commit_shared_journey locks this row too).
 perform 1 from public.activities a where a.id=p_activity and a.owner_id=auth.uid() for update;
 update public.live_trails set points='[]'::jsonb,roads='{}'::jsonb,updated_at=now() where owner_id=auth.uid() and upper(activity_ref)=upper(p_activity::text);
 delete from public.shared_journeys where activity_id=p_activity and owner_id=auth.uid();
 insert into public.private_activity_refs(owner_id,ref) select a.owner_id,a.id::text from public.activities a where a.id=p_activity and a.owner_id=auth.uid() on conflict do nothing;
 insert into public.activity_share_decisions(activity_id,owner_id,private)
  select a.id,a.owner_id,true from public.activities a where a.id=p_activity and a.owner_id=auth.uid()
 on conflict(activity_id) do update set private=true;
end $$;

create or replace function public.put_my_live_road(p_ref text,p_gap text,p_line text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_ref is null or p_gap is null or length(p_gap) not between 1 and 120
  or not public.valid_polyline(p_line) then return false; end if;
 -- A fresh statement AFTER the row lock observes a hide or Home/Work update
 -- which committed while we waited. Evaluating the mask in a waiting UPDATE
 -- alone could otherwise reuse its old snapshot.
 perform 1 from public.live_trails where owner_id=auth.uid() and activity_ref=p_ref for update;
 if not found or public.activity_ref_is_private(auth.uid(),p_ref) then return false; end if;
 update public.live_trails set roads=roads||jsonb_build_object(p_gap,jsonb_build_object('l',p_line,'c',public.road_clear_of_private_places(auth.uid(),p_line))),updated_at=now()
  where owner_id=auth.uid() and activity_ref=p_ref and not public.activity_ref_is_private(owner_id,p_ref)
   and (roads ? p_gap or (select count(*) from jsonb_object_keys(roads))<40);
 return found;
end $$;
revoke all on function public.put_my_live_road(text,text,text) from public,anon,authenticated;
grant execute on function public.put_my_live_road(text,text,text) to authenticated;

create or replace function public.commit_shared_journey(p_id uuid,p_owner uuid,p_revision integer,p_audience text,p_snapshot jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare trip public.activities; result uuid;
begin
 select * into trip from public.activities where id=p_id and owner_id=p_owner for update;
 if not found or trip.revision<>p_revision then raise exception 'Activity changed or was deleted. Review the preview again.'; end if;
 if p_audience not in ('public','household','friends') then raise exception 'Invalid audience'; end if;
 insert into public.shared_journeys(activity_id,owner_id,audience,snapshot) values(p_id,p_owner,p_audience,p_snapshot)
 on conflict(activity_id) do update set snapshot=excluded.snapshot,audience=excluded.audience returning token into result;
 if p_audience='public' then
  delete from public.social_journey_policies where activity_id=p_id;
  perform public.remember_manual_share(p_owner,p_id);
 end if;
 return result;
end $$;
revoke all on function public.commit_shared_journey(uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.commit_shared_journey(uuid,uuid,integer,text,jsonb) to service_role;

-- The optional flag is supplied only by the trusted journeys backend. Legacy
-- seven-argument calls remain manual publications; no new client privilege.
drop function public.publish_social_journey(uuid,uuid,integer,text,text,uuid[],jsonb);
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
 -- Lock relationship and consent before activity, in that order. A concurrent
 -- leave/disable either commits first and is observed below, or waits until this
 -- authorised publication commits. No advisory lock is needed on this path.
 if p_auto then
  if p_audience<>'household' or p_mode<>'household' or coalesce(cardinality(p_recipients),0)<>0 then raise exception 'Automatic sharing is household only'; end if;
  perform 1 from public.household_memberships where user_id=p_owner for share;
  if not found then raise exception 'Automatic sharing consent unavailable'; end if;
  perform 1 from public.activity_auto_share where user_id=p_owner for share;
  if not found then raise exception 'Automatic sharing consent unavailable'; end if;
 end if;
 select revision into v_current from public.activities
 where id=p_activity and owner_id=auth.uid() for update;
 if not found or v_current<>p_revision then raise exception 'Activity revision changed'; end if;
 if p_auto and not public.auto_share_allowed(p_owner,p_activity) then raise exception 'Activity is not eligible for automatic sharing'; end if;
 -- Revalidation and publication occur under the same row lock.
 -- Keep previous policy inaccessible until the full transaction commits.
 select public.commit_shared_journey(p_activity,auth.uid(),p_revision,p_audience,p_snapshot) into v_token;
 perform public.configure_social_journey(p_activity,p_mode,coalesce(p_recipients,'{}'::uuid[]));
 if not coalesce(p_auto,false) then perform public.remember_manual_share(p_owner,p_activity); end if;
 return v_token;
end $$;

revoke all on function public.publish_social_journey(uuid,uuid,integer,text,text,uuid[],jsonb,boolean) from public,anon,authenticated;
grant execute on function public.publish_social_journey(uuid,uuid,integer,text,text,uuid[],jsonb,boolean) to service_role;
-- A recorded prefix remains available during pauses/offline periods until the
-- recorder ends or hides it. This does not make its old fixes current positions.
create or replace function public.my_live_trail(p_owner uuid,p_after double precision default 0,p_revision text default null)
returns table(activity_ref text,started_at timestamptz,updated_at timestamptz,points jsonb,roads jsonb,point_count integer,newest_t double precision,privacy_revision text)
language plpgsql stable security definer set search_path='' as $$
declare v_household boolean; v_friend boolean; v_self boolean; v_t public.live_trails; v_open boolean; v_revision text;
begin
 if auth.uid() is null or p_owner is null then return; end if;
 v_self:=auth.uid()=p_owner;
 v_household:=exists(select 1 from public.household_memberships me join public.household_memberships o on o.household_id=me.household_id
   where me.user_id=auth.uid() and o.user_id=p_owner and me.user_id<>o.user_id)
  and exists(select 1 from public.household_live_locations l where l.user_id=p_owner and l.enabled);
 v_friend:=exists(select 1 from public.my_friends() f where f.user_id=p_owner)
  and exists(select 1 from public.friend_presence_shares s where s.user_id=p_owner and s.enabled);
 if not (v_self or v_household or v_friend) then return; end if;
 v_open:=v_self or v_household;
 select * into v_t from public.live_trails t where t.owner_id=p_owner;
 if not found then return; end if;
 -- A completed backup is authoritative even if the phone's end packet was
 -- lost during shutdown. Never present that same activity as an unfinished trail.
 if exists(select 1 from public.activities a where a.owner_id=p_owner and a.ended_at is not null
  and a.id=case when v_t.activity_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_t.activity_ref::uuid end) then return; end if;
 -- Include audience scope: leaving a household but staying a friend also changes
 -- which points are authorised, even when Home/Work did not move.
 v_revision:=v_t.privacy_revision::text||case when v_open then ':open' else ':masked' end;
 if p_revision is distinct from v_revision then p_after:=0; end if;
 -- The common poll finds nothing new: answer without evaluating the mask for every point.
 if jsonb_array_length(v_t.points)>0 and coalesce(p_after,0)>=(v_t.points->-1->>2)::float8 then
  return query select v_t.activity_ref,v_t.started_at,v_t.updated_at,'[]'::jsonb,
   coalesce((select jsonb_object_agg(e.k,e.val->>'l') from jsonb_each(v_t.roads) e(k,val) where v_open or coalesce((e.val->>'c')::boolean,false)),'{}'::jsonb),
   jsonb_array_length(v_t.points),case when v_open then (v_t.points->-1->>2)::float8 end,v_revision;
  return;
 end if;
 return query
  with pts as (
   select x,(x->>2)::float8 as t,(x->>3)::numeric as seg,
    (not v_open) and exists(select 1 from public.saved_places sp
     where sp.owner_id=p_owner and sp.kind in ('home','work')
      and sqrt(power(((x->>0)::float8-sp.latitude)*111320,2)+power(((x->>1)::float8-sp.longitude)*111320*cos(radians(sp.latitude)),2))<=sp.radius+300) as hidden
   from jsonb_array_elements(v_t.points) x),
  -- A visible point whose stretch from the previous fix passes the masked distance also
  -- starts a new run, even though no point lies inside it (sparse fixes at speed).
  linked as (select pts.*,lag(x) over (order by t) as px,lag(hidden) over (order by t) as ph from pts),
  marked as (select l.*,(not l.hidden) and l.px is not null and not coalesce(l.ph,false) and (not v_open)
     and public.segment_near_private_place(p_owner,(l.px->>0)::float8,(l.px->>1)::float8,(l.x->>0)::float8,(l.x->>1)::float8) as crossing from linked l),
  counted as (select m.*,count(*) filter (where m.hidden or m.crossing) over (order by m.t rows between unbounded preceding and current row) as hid from marked m)
  select v_t.activity_ref,v_t.started_at,v_t.updated_at,
   coalesce((select jsonb_agg(jsonb_build_array(c.x->0,c.x->1,c.x->2,c.seg*100000+c.hid) order by c.t) from counted c
    where not c.hidden and c.t>coalesce(p_after,0)),'[]'::jsonb),
   coalesce((select jsonb_object_agg(e.k,e.val->>'l') from jsonb_each(v_t.roads) e(k,val)
    where v_open or coalesce((e.val->>'c')::boolean,false)),'{}'::jsonb),
   jsonb_array_length(v_t.points),
   case when v_open then (select max(t) from pts) end,v_revision;
end $$;
revoke all on function public.my_live_trail(uuid,double precision,text) from public,anon,authenticated;
grant execute on function public.my_live_trail(uuid,double precision,text) to authenticated;



-- Authorisation and payload must use one snapshot, including nested access
-- checks inside my_shared_day. A volatile multi-statement read could authorise
-- the old share and then fetch a replacement snapshot for a different audience.
create or replace function public.can_view_social_journey(p_activity uuid)
returns boolean
language plpgsql stable security definer set search_path=''
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

create or replace function public.read_social_journey(p_activity uuid)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare v_snapshot jsonb; v_owner uuid;
begin
 if not public.can_view_social_journey(p_activity) then return null; end if;
 select snapshot,owner_id into v_snapshot,v_owner from public.shared_journeys
 where activity_id=p_activity;
 if v_snapshot is null then return null; end if;
 return jsonb_build_object('activity_id',p_activity,'owner_id',v_owner,'snapshot',v_snapshot);
end $$;


-- A manual revocation is itself the privacy decision. Do not leave a window
-- between deleting an automatic share and the client's subsequent private RPCs.
create or replace function public.revoke_activity_publication(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.activities where id=p_id and owner_id=auth.uid()) then raise exception 'Not authorised'; end if;
 perform public.keep_activity_private(p_id);
end $$;
commit;
