-- A finished activity reaches the cloud without the app being open.
--
-- Until now an activity was backed up only by the app's own JavaScript, which runs while letm3go is on screen. A drive that finished
-- while the app was closed (the normal case for automatic recording) waited, on one phone, a median of two hours, so everyone else
-- saw the live trail vanish and nothing take its place.
--
-- The native recorder now sends each finished activity itself, with the same device credential it already publishes the live
-- position and live trail with. upload_finished_activity stores it as a PROVISIONAL copy (id, times, distance and route; marked in
-- classification.nativeUpload with no sync fingerprint) and shares it with the household at once. The app's later full backup of the
-- same id replaces the provisional copy (backup_private_activity treats it as the phone's own first copy, never a conflict), so
-- nothing is duplicated and the owner's edits and metadata still arrive the normal way.
--
-- Safe to re-run. Forward-only: no stored row is rewritten.
begin;

create or replace function public.upload_finished_activity(p_token text,p_payload jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_hash bytea; v_in public.activities; v_points jsonb; v_n integer; v_title text;
begin
 if p_token is null or length(p_token)<>64 or p_payload is null or jsonb_typeof(p_payload)<>'object' then return false; end if;
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
  or v_in.ended_at<v_in.started_at or v_in.started_at>now()+interval '5 minutes' or v_in.ended_at<now()-interval '3 days'
  or v_points is null or jsonb_typeof(v_points)<>'array' then return false; end if;
 v_n:=jsonb_array_length(v_points);
 if v_n<2 or v_n>50000
  or jsonb_typeof(v_points->0)<>'object' or jsonb_typeof(v_points->(v_n-1))<>'object'
  or jsonb_typeof(v_points->0->'latitude')<>'number' or jsonb_typeof(v_points->0->'longitude')<>'number'
  or jsonb_typeof(v_points->(v_n-1)->'latitude')<>'number' or jsonb_typeof(v_points->(v_n-1)->'longitude')<>'number' then return false; end if;
 -- An activity its owner made private, or deleted, is never put back. One that is already here (provisional or fully backed up) is
 -- never overwritten: this is the phone's first word on it, nothing more.
 if public.activity_ref_is_private(v_user,v_in.id::text) then return false; end if;
 if exists(select 1 from public.activity_tombstones t where t.id=v_in.id) then return true; end if;
 if exists(select 1 from public.activities a where a.id=v_in.id) then return true; end if;
 -- A phone can leave only so many unreplaced provisional copies; the app's backup (or time) clears them.
 if (select count(*) from public.activities a where a.owner_id=v_user and a.sync_fingerprint is null and a.classification ? 'nativeUpload')>=200 then return false; end if;
 v_title:=left(coalesce(nullif(btrim(v_in.title),''),v_in.activity),150);
 insert into public.activities(id,owner_id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,vehicle,route_points,classification,visibility)
  values(v_in.id,v_user,v_title,left(v_in.activity,60),v_in.recording_mode,v_in.started_at,v_in.ended_at,
   least(greatest(coalesce(v_in.duration_seconds,0),0),604800),least(greatest(coalesce(v_in.distance_meters,0),0),2000000),
   nullif(left(coalesce(v_in.vehicle,''),100),''),v_points,'{"nativeUpload":1}'::jsonb,'private');
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

-- The app's full backup of an activity the recorder already sent: the phone's own first copy, replaced rather than refused.
create or replace function public.backup_private_activity(
 p_owner uuid,p_payload jsonb,p_fingerprint text,p_expected_revision integer,p_base_fingerprint text
) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare current_trip public.activities; incoming public.activities; expected integer:=p_expected_revision; saved integer; current_content jsonb; incoming_content jsonb; current_base text; incoming_base text;
begin
 if p_owner is distinct from auth.uid() or not public.account_is_active() then
  raise exception 'Authenticated backup owner mismatch';
 end if;
 if p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
  or (p_base_fingerprint is not null and p_base_fingerprint !~ '^[a-f0-9]{64}$') then
  raise exception 'Invalid backup fingerprint';
 end if;
 incoming:=jsonb_populate_record(null::public.activities,p_payload);
 select * into current_trip from public.activities
 where id=(p_payload->>'id')::uuid and owner_id=p_owner for update;
 if found then
  -- A lost acknowledgement or repeated request needs no content write.
  -- JSONB/typed comparison ignores object key ordering and UUID spelling.
  -- An identical cloud copy needs acknowledgement only: no revision bump,
  -- projection deletion or fresh publication, even if the old receipt was lost.
  current_content:=jsonb_build_array(current_trip.id,current_trip.owner_id,current_trip.title,current_trip.activity,current_trip.recording_mode,extract(epoch from current_trip.started_at),extract(epoch from current_trip.ended_at),
   current_trip.duration_seconds,current_trip.distance_meters,current_trip.vehicle,current_trip.description,current_trip.notes,
   current_trip.tags,current_trip.collection,current_trip.equipment,current_trip.view_metadata,current_trip.classification,current_trip.user_corrected,current_trip.route_points);
  incoming_content:=jsonb_build_array(incoming.id,p_owner,incoming.title,incoming.activity,incoming.recording_mode,extract(epoch from incoming.started_at),extract(epoch from incoming.ended_at),
   incoming.duration_seconds,incoming.distance_meters,incoming.vehicle,coalesce(incoming.description,''),coalesce(incoming.notes,''),
   coalesce(incoming.tags,'{}'),coalesce(incoming.collection,''),coalesce(incoming.equipment,'[]'::jsonb),coalesce(incoming.view_metadata,'{}'::jsonb),
   coalesce(incoming.classification,'{}'),coalesce(incoming.user_corrected,false),coalesce(incoming.route_points,'[]'));
  current_base:=encode(sha256(convert_to(current_content::text,'UTF8')),'hex');
  if current_trip.sync_fingerprint=p_fingerprint or current_content=incoming_content then
   return jsonb_build_object('revision',current_trip.revision,'base_fingerprint',current_base);
  end if;
  -- Older builds did not save these versioned private annotations. A lost
  -- receipt must not strand their additive upgrade. Every other typed field,
  -- including the entire route and visible metadata, must match exactly.
  -- Existing envelopes must be preserved byte-for-byte as JSONB; never merge
  -- over a newer annotation or accept changed classification/user content.
  if current_trip.sync_fingerprint is null and current_trip.classification ? 'nativeUpload' then
   -- The phone's own first copy, sent by the recorder while the app was closed (upload_finished_activity). The full backup is the
   -- same activity with its complete record, so it replaces the provisional copy instead of conflicting with it.
   expected:=current_trip.revision;
  elsif p_base_fingerprint is not null and p_expected_revision between 1 and current_trip.revision
   and jsonb_typeof(incoming_content->16)='object'
   and jsonb_typeof(current_trip.classification)='object'
   and jsonb_set(incoming_content,'{16}',current_trip.classification)=current_content
   and ((incoming_content->16)-array['privateActivity','journeyStops'])
     =(current_trip.classification-array['privateActivity','journeyStops'])
   and (not (current_trip.classification ? 'privateActivity')
     or current_trip.classification->'privateActivity' = incoming_content->16->'privateActivity')
   and (not (current_trip.classification ? 'journeyStops')
     or current_trip.classification->'journeyStops' = incoming_content->16->'journeyStops')
   and (not ((incoming_content->16) ? 'privateActivity')
     or (jsonb_typeof(incoming_content->16->'privateActivity')='object' and incoming_content->16->'privateActivity'->'version'='1'::jsonb))
   and (not ((incoming_content->16) ? 'journeyStops')
     or (jsonb_typeof(incoming_content->16->'journeyStops')='object' and incoming_content->16->'journeyStops'->'version'='1'::jsonb)) then
   expected:=current_trip.revision;
  elsif p_base_fingerprint is not null then
   -- Never read the latest revision and blindly retry. Another device's backup
   -- or a direct content edit changes/invalidates this baseline and is refused.
   if current_trip.sync_fingerprint is distinct from p_base_fingerprint and current_base<>p_base_fingerprint then
    raise exception 'Cloud activity conflict; the backed-up content changed';
   end if;
   expected:=current_trip.revision;
  end if;
 end if;
 -- Reuse the existing validation, deletion protection and write path under the
 -- same row lock. It still refuses resurrection and missing/unknown baselines.
 saved:=public.backup_private_activity(p_owner,p_payload,p_fingerprint,expected);
 -- Hash the actual stored backup fields, excluding privacy/display revisions.
 select jsonb_build_array(t.id,t.owner_id,t.title,t.activity,t.recording_mode,extract(epoch from t.started_at),extract(epoch from t.ended_at),
  t.duration_seconds,t.distance_meters,t.vehicle,t.description,t.notes,t.tags,t.collection,t.equipment,t.view_metadata,t.classification,t.user_corrected,t.route_points)
 into incoming_content from public.activities t where t.id=(p_payload->>'id')::uuid and t.owner_id=p_owner;
 incoming_base:=encode(sha256(convert_to(incoming_content::text,'UTF8')),'hex');
 return jsonb_build_object('revision',saved,'base_fingerprint',incoming_base);
end $$;
revoke all on function public.backup_private_activity(uuid,jsonb,text,integer,text) from public,anon,authenticated;
grant execute on function public.backup_private_activity(uuid,jsonb,text,integer,text) to authenticated;
notify pgrst, 'reload schema';
commit;
