-- Keep the native route and its household projection consistent in one transaction.
begin;

-- Both backup RPC signatures reach this trigger. The check runs against the
-- actual locked row, including a native insert/update that just committed.
create or replace function public.guard_provisional_activity_route() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.sync_fingerprint is not null or not (old.classification ? 'nativeUpload') then return new; end if;
 if (new.ended_at,new.route_points) is distinct from (old.ended_at,old.route_points) then
  if new.ended_at is null or new.ended_at < old.ended_at - interval '1 millisecond'
   or jsonb_array_length(new.route_points)<jsonb_array_length(old.route_points)
   or exists(select 1 from jsonb_array_elements(old.route_points) with ordinality p(point,position)
    where p.point is distinct from new.route_points->((p.position-1)::integer)) then
   raise exception 'Cloud activity conflict; the recorder has a newer or different route';
  end if;
 end if;
 -- An edit to a provisional activity supersedes its automatic promotion.
 -- The recorder itself only updates the four route fields below.
 if new.sync_fingerprint is null
  and (to_jsonb(new)-array['updated_at','revision','visibility','sync_fingerprint','ended_at','duration_seconds','distance_meters','route_points'])
    is distinct from
      (to_jsonb(old)-array['updated_at','revision','visibility','sync_fingerprint','ended_at','duration_seconds','distance_meters','route_points']) then
  new.classification:=new.classification-'nativeUpload';
 end if;
 return new;
end $$;
revoke all on function public.guard_provisional_activity_route() from public,anon,authenticated;
drop trigger if exists guard_provisional_activity_route on public.activities;
create trigger guard_provisional_activity_route before update on public.activities
 for each row execute function public.guard_provisional_activity_route();

-- A hide may wait behind an in-flight upload. Remove its automatic
-- projection in that same privacy transaction, including device-only hides.
create or replace function public.revoke_auto_projection_for_private_ref() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if new.ref !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then return new; end if;
 v_id:=new.ref::uuid;
 perform 1 from public.activities where id=v_id and owner_id=new.owner_id for update;
 delete from public.shared_journeys j where j.activity_id=v_id and j.owner_id=new.owner_id and j.audience='household'
  and not exists(select 1 from public.activity_share_decisions d where d.activity_id=v_id);
 return new;
end $$;
revoke all on function public.revoke_auto_projection_for_private_ref() from public,anon,authenticated;
drop trigger if exists revoke_auto_projection_for_private_ref on public.private_activity_refs;
create trigger revoke_auto_projection_for_private_ref after insert on public.private_activity_refs
 for each row execute function public.revoke_auto_projection_for_private_ref();

create or replace function public.upload_finished_activity_v2(p_token text,p_payload jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_hash bytea; v_in public.activities; v_points jsonb; v_n integer; v_title text; v_have public.activities; v_duration double precision; v_distance double precision; v_household boolean;
begin
 if p_token is null or length(p_token)<>64 or p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>12000000 then return 'rejected'; end if;
 v_hash:=sha256(convert_to(p_token,'UTF8'));
 -- The same credential the live position and live trail use: a household member who is sharing, or a friend share.
 select l.user_id into v_user from public.household_live_locations l
  where l.publish_token_hash=v_hash and l.publish_token_expires_at>now() and l.enabled
   and exists(select 1 from public.household_memberships m where m.user_id=l.user_id);
 if v_user is null then
  select s.user_id into v_user from public.friend_presence_shares s
   where s.publish_token_hash=v_hash and s.publish_token_expires_at>now() and s.enabled;
 end if;
 if v_user is null then return 'credential_required'; end if;
 -- Match live-trail lock order, and recheck credentials after any concurrent revoke.
 perform 1 from auth.users where id=v_user for key share;
 if not found then return 'credential_required'; end if;
 perform 1 from public.household_live_locations l where l.user_id=v_user
  and l.publish_token_hash=v_hash and l.publish_token_expires_at>now() and l.enabled for share;
 v_household:=found;
 if not found then
  perform 1 from public.friend_presence_shares s where s.user_id=v_user
   and s.publish_token_hash=v_hash and s.publish_token_expires_at>now() and s.enabled for share;
  if not found then return 'credential_required'; end if;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(105942,pg_catalog.hashtext(v_user::text));
 -- Publication also locks membership and consent before locking the activity.
 perform 1 from public.household_memberships where user_id=v_user for share;
 if v_household and not found then return 'credential_required'; end if;
 perform 1 from public.activity_auto_share where user_id=v_user for share;
 perform set_config('request.jwt.claim.sub',v_user::text,true);
 if not public.account_is_active() then return 'credential_required'; end if;
 begin
  v_in:=jsonb_populate_record(null::public.activities,p_payload);
 exception when others then return 'rejected';
 end;
 v_points:=p_payload->'route_points';
 if v_in.id is null or v_in.activity is null or v_in.started_at is null or v_in.ended_at is null
  or v_in.recording_mode is null or v_in.recording_mode not in ('manual','automatic')
  or v_in.ended_at<v_in.started_at or v_in.started_at>now()+interval '5 minutes'
  or v_in.ended_at<now()-interval '3 days' or v_in.started_at<now()-interval '10 days'
  or v_points is null or jsonb_typeof(v_points)<>'array' then return 'rejected'; end if;
 v_n:=jsonb_array_length(v_points);
 if v_n<2 or v_n>50000 then return 'rejected'; end if;
 -- Every point must be an object with a real position.
 if exists(select 1 from jsonb_array_elements(v_points) p
  where case when jsonb_typeof(p->'latitude')='number' and jsonb_typeof(p->'longitude')='number'
   then (p->>'latitude')::numeric not between -90 and 90 or (p->>'longitude')::numeric not between -180 and 180
   else true end) then return 'rejected'; end if;
 if public.activity_ref_is_private(v_user,v_in.id::text) then return 'rejected'; end if;
 select * into v_have from public.activities a where a.id=v_in.id and a.owner_id=v_user for update;
 if exists(select 1 from public.activity_tombstones t where t.id=v_in.id and t.owner_id=v_user) then return 'deleted'; end if;
 if v_have.id is null then
  if exists(select 1 from public.activity_tombstones t where t.id=v_in.id)
   or exists(select 1 from public.activities a where a.id=v_in.id) then return 'rejected'; end if;
 end if;
 v_duration:=least(greatest(coalesce(v_in.duration_seconds,0),0),604800);
 v_distance:=least(greatest(coalesce(v_in.distance_meters,0),0),2000000);
 begin
  if v_have.id is null then
   if (select count(*) from public.activities a where a.owner_id=v_user and a.sync_fingerprint is null
    and a.classification ? 'nativeUpload' and a.ended_at>now()-interval '7 days')>=200 then return 'retry'; end if;
   v_title:=left(coalesce(nullif(btrim(v_in.title),''),v_in.activity),150);
   insert into public.activities(id,owner_id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,vehicle,route_points,classification,visibility)
    values(v_in.id,v_user,v_title,left(v_in.activity,60),v_in.recording_mode,v_in.started_at,v_in.ended_at,v_duration,v_distance,
     nullif(left(coalesce(v_in.vehicle,''),100),''),v_points,'{"nativeUpload":1}'::jsonb,'private')
    returning * into v_have;
  elsif v_in.ended_at>v_have.ended_at or (v_in.ended_at=v_have.ended_at and v_n>jsonb_array_length(v_have.route_points)) then
   if v_have.sync_fingerprint is not null or not (v_have.classification ? 'nativeUpload')
    or abs(extract(epoch from (v_in.started_at-v_have.started_at)))>0.001
    or v_in.recording_mode<>v_have.recording_mode
    or exists(select 1 from jsonb_array_elements(v_have.route_points) with ordinality p(point,position)
     where p.point is distinct from v_points->((p.position-1)::integer)) then return 'backup_required'; end if;
   update public.activities set ended_at=v_in.ended_at,duration_seconds=v_duration,distance_meters=v_distance,route_points=v_points
    where id=v_have.id and owner_id=v_user returning * into v_have;
  end if;

  -- Publish just this row. A publication error rolls back the insert/update
  -- and any projection side effects, so retrying the same snapshot is safe.
  -- Also repairs an unpublished row left by a previous server version.
  if v_have.id in (select public.auto_share_candidates(v_user)) then
   perform public.publish_social_journey(v_user,v_have.id,v_have.revision,'household','household','{}'::uuid[],
    public.household_snapshot(v_have.id),true);
  end if;
  delete from public.household_history_failures where activity_id=v_have.id;
 exception when others then
  raise warning 'upload_finished_activity: activity % failed (SQLSTATE %)',v_in.id,sqlstate;
  return 'retry';
 end;
 return 'accepted';
end $$;
revoke all on function public.upload_finished_activity_v2(text,jsonb) from public,anon,authenticated;
grant execute on function public.upload_finished_activity_v2(text,jsonb) to anon,authenticated;

-- Keep the Boolean contract for installed clients.
create or replace function public.upload_finished_activity(p_token text,p_payload jsonb) returns boolean
language sql security invoker set search_path='' as $$
 select public.upload_finished_activity_v2(p_token,p_payload) in ('accepted','deleted')
$$;
notify pgrst, 'reload schema';
commit;
