-- Post-merge review: consent must still be valid when an auto-publication finishes.
-- Live GPS append, finish and privacy changes must not race (including before a
-- live_trails row exists). Uses one transaction-scoped advisory lock per owner.
-- Apply AFTER 20261203000000_person_day_privacy_revision.sql.
begin;

create or replace function public.auto_share_allowed(p_owner uuid,p_activity uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.activities a
  join public.activity_auto_share s on s.user_id=a.owner_id and s.enabled
  where a.id=p_activity and a.owner_id=p_owner
   and a.ended_at is not null and a.started_at>=s.since
   and exists(select 1 from public.household_memberships m where m.user_id=p_owner)
   and not exists(select 1 from public.activity_share_decisions d where d.activity_id=a.id)
   and not public.activity_ref_is_private(p_owner,p_activity::text)
 )
$$;

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
 -- Use the same per-owner lock as live-trail publishing and hiding.
 perform pg_catalog.pg_advisory_xact_lock(105942,pg_catalog.hashtext(auth.uid()::text));
 -- Any copy already published (for example by automatic sharing a moment earlier) goes
 -- first, which also clears who it was shared with; the decision is recorded after, so
 -- the removal cannot overwrite it.
 -- Serialise with a publication of the same activity (commit_shared_journey locks this row too).
 perform 1 from public.activities a where a.id=p_activity and a.owner_id=auth.uid() for update;
 delete from public.shared_journeys where activity_id=p_activity and owner_id=auth.uid();
 insert into public.private_activity_refs(owner_id,ref) select a.owner_id,a.id::text from public.activities a where a.id=p_activity and a.owner_id=auth.uid() on conflict do nothing;
 insert into public.activity_share_decisions(activity_id,owner_id,private)
  select a.id,a.owner_id,true from public.activities a where a.id=p_activity and a.owner_id=auth.uid()
 on conflict(activity_id) do update set private=true;
end $$;

-- CREATE OR REPLACE preserves the current function execute ACLs. Restate them
-- so a future permissions change cannot expose the security-definer RPCs.
revoke all on function public.auto_share_allowed(uuid,uuid) from public,anon,authenticated;
grant execute on function public.auto_share_allowed(uuid,uuid) to service_role;
revoke all on function public.append_live_trail(text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.append_live_trail(text,text,integer,jsonb) to anon,authenticated;
revoke all on function public.end_live_trail(text,boolean),public.keep_activity_private(uuid) from public,anon,authenticated;
grant execute on function public.end_live_trail(text,boolean),public.keep_activity_private(uuid) to authenticated;
commit;
