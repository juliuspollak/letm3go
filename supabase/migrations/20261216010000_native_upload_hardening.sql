-- Hardening of upload_finished_activity (20261216000000) after review.
--
--  * Every route point is validated, not just the first and last, and the whole payload has a size cap, so a credential that leaks
--    cannot store arbitrary junk as someone's route.
--  * A started_at far in the past is refused (the recorder only sends recent activities).
--  * An id that belongs to somebody else, or a tombstone for somebody else's activity, is answered exactly like a refusal, so the
--    function cannot be used to learn whether an id exists. Only the caller's own rows are "already here".
--  * The cap on unreplaced provisional copies counts recent ones only; stale ones can no longer block new uploads for good.
--  * A journey that resumed after the recorder first sent it (a later ended_at) updates its still-provisional copy, then republishes.
--  * Any failure while storing answers false (the recorder retries later) instead of surfacing a database error.
--
-- Safe to re-run. Forward-only: no stored row is rewritten.
begin;

create or replace function public.upload_finished_activity(p_token text,p_payload jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_hash bytea; v_in public.activities; v_points jsonb; v_n integer; v_title text; v_have public.activities; v_duration double precision; v_distance double precision;
begin
 if p_token is null or length(p_token)<>64 or p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>12000000 then return false; end if;
 v_hash:=sha256(convert_to(p_token,'UTF8'));
 -- The same credential the live position and live trail use: a household member who is sharing, or a friend share.
 select l.user_id into v_user from public.household_live_locations l
  where l.publish_token_hash=v_hash and l.publish_token_expires_at>now() and l.enabled
   and exists(select 1 from public.household_memberships m where m.user_id=l.user_id);
 if v_user is null then
  select s.user_id into v_user from public.friend_presence_shares s
   where s.publish_token_hash=v_hash and s.publish_token_expires_at>now() and s.enabled;
 end if;
 if v_user is null then return false; end if;
 perform set_config('request.jwt.claim.sub',v_user::text,true);
 if not public.account_is_active() then return false; end if;
 begin
  v_in:=jsonb_populate_record(null::public.activities,p_payload);
 exception when others then return false;
 end;
 v_points:=p_payload->'route_points';
 if v_in.id is null or v_in.activity is null or v_in.started_at is null or v_in.ended_at is null
  or v_in.recording_mode is null or v_in.recording_mode not in ('manual','automatic')
  or v_in.ended_at<v_in.started_at or v_in.started_at>now()+interval '5 minutes'
  or v_in.ended_at<now()-interval '3 days' or v_in.started_at<now()-interval '10 days'
  or v_points is null or jsonb_typeof(v_points)<>'array' then return false; end if;
 v_n:=jsonb_array_length(v_points);
 if v_n<2 or v_n>50000 then return false; end if;
 -- Every point must be an object with a real position.
 if exists(select 1 from jsonb_array_elements(v_points) p
  where jsonb_typeof(p)<>'object' or jsonb_typeof(p->'latitude')<>'number' or jsonb_typeof(p->'longitude')<>'number'
   or (p->>'latitude')::double precision not between -90 and 90 or (p->>'longitude')::double precision not between -180 and 180) then return false; end if;
 -- An activity its owner made private, or deleted, is never put back.
 if public.activity_ref_is_private(v_user,v_in.id::text) then return false; end if;
 if exists(select 1 from public.activity_tombstones t where t.id=v_in.id and t.owner_id=v_user) then return true; end if;
 if exists(select 1 from public.activity_tombstones t where t.id=v_in.id) then return false; end if;
 v_duration:=least(greatest(coalesce(v_in.duration_seconds,0),0),604800);
 v_distance:=least(greatest(coalesce(v_in.distance_meters,0),0),2000000);
 select * into v_have from public.activities a where a.id=v_in.id for update;
 if found then
  -- Somebody else's id: refused like anything else that is not ours.
  if v_have.owner_id<>v_user then return false; end if;
  -- Already here and the phone has not seen the later end of a resumed journey: nothing to do (a repeat, a lost reply).
  -- Still the phone's provisional copy and the journey has since ended later: bring it up to date.
  if v_have.sync_fingerprint is null and v_have.classification ? 'nativeUpload' and v_in.ended_at>v_have.ended_at+interval '1 second' then
   begin
    update public.activities set ended_at=v_in.ended_at,duration_seconds=v_duration,distance_meters=v_distance,route_points=v_points
     where id=v_have.id and owner_id=v_user;
    perform public.publish_household_history(v_user);
   exception when others then
    raise warning 'upload_finished_activity: update of % failed (%)',v_in.id,sqlerrm;
    return false;
   end;
  end if;
  return true;
 end if;
 -- A phone can leave only so many unreplaced recent provisional copies; the app's backup (or time) clears them.
 if (select count(*) from public.activities a where a.owner_id=v_user and a.sync_fingerprint is null and a.classification ? 'nativeUpload'
  and a.ended_at>now()-interval '7 days')>=200 then return false; end if;
 v_title:=left(coalesce(nullif(btrim(v_in.title),''),v_in.activity),150);
 begin
  insert into public.activities(id,owner_id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,vehicle,route_points,classification,visibility)
   values(v_in.id,v_user,v_title,left(v_in.activity,60),v_in.recording_mode,v_in.started_at,v_in.ended_at,v_duration,v_distance,
    nullif(left(coalesce(v_in.vehicle,''),100),''),v_points,'{"nativeUpload":1}'::jsonb,'private');
 exception when others then
  raise warning 'upload_finished_activity: storing % failed (%)',v_in.id,sqlerrm;
  return false;
 end;
 -- Shared with the household straight away (an owner's private decision, and anything from before sharing began, still win).
 begin
  perform public.publish_household_history(v_user);
 exception when others then
  raise warning 'upload_finished_activity: household publication of % failed (%)',v_in.id,sqlerrm;
 end;
 return true;
end $$;
revoke all on function public.upload_finished_activity(text,jsonb) from public,anon,authenticated;
grant execute on function public.upload_finished_activity(text,jsonb) to anon,authenticated;
notify pgrst, 'reload schema';
commit;
