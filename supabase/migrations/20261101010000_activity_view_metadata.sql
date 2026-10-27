-- Proposed local-only. Requires approval; never replay earlier scripts.
--
-- A restored journey kept its GPS points but lost the user's own presentation of
-- them: the trimmed route window, the recognised start/end places, and the cover
-- photo choice. They are small, non-sensitive, and belong with the activity.
begin;
alter table public.activities add column if not exists view_metadata jsonb not null default '{}'::jsonb;

create or replace function public.valid_view_metadata(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select jsonb_typeof(p_value)='object'
  and (select count(*) from jsonb_object_keys(p_value))<=5
  and not exists(
   select 1 from jsonb_each(p_value) as entry(key,value)
   where case
    when entry.key in ('visibleRouteStart','visibleRouteEnd') then jsonb_typeof(entry.value)<>'number'
    when entry.key in ('startPlace','endPlace') then jsonb_typeof(entry.value)<>'string' or length(entry.value #>> '{}')>120
    when entry.key='coverPhotoID' then jsonb_typeof(entry.value)<>'string' or length(entry.value #>> '{}')>100
    else true
   end
  )
$$;
revoke all on function public.valid_view_metadata(jsonb) from public,anon;
grant execute on function public.valid_view_metadata(jsonb) to authenticated,service_role;
alter table public.activities drop constraint if exists activities_view_metadata_shape;
alter table public.activities add constraint activities_view_metadata_shape check(public.valid_view_metadata(view_metadata));

create or replace function public.backup_private_activity(p_owner uuid,p_payload jsonb,p_fingerprint text,p_expected_revision integer default null)
returns integer language plpgsql security invoker set search_path='' as $$
declare incoming public.activities; current_trip public.activities; saved_revision integer;
begin
 if p_owner is distinct from auth.uid() or not public.account_is_active() then raise exception 'Authenticated backup owner mismatch'; end if;
 if p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'Invalid backup fingerprint'; end if;
 incoming:=jsonb_populate_record(null::public.activities,p_payload);
 if incoming.id is null then raise exception 'Activity ID required'; end if;
 select * into current_trip from public.activities where id=incoming.id and owner_id=p_owner for update;
 if found then
  if current_trip.sync_fingerprint=p_fingerprint then return current_trip.revision; end if;
  if p_expected_revision is null or current_trip.revision<>p_expected_revision then raise exception 'Cloud activity conflict; reload before overwriting'; end if;
  update public.activities set title=incoming.title,activity=incoming.activity,recording_mode=incoming.recording_mode,
   started_at=incoming.started_at,ended_at=incoming.ended_at,duration_seconds=incoming.duration_seconds,distance_meters=incoming.distance_meters,
   vehicle=incoming.vehicle,description=coalesce(incoming.description,''),notes=coalesce(incoming.notes,''),tags=coalesce(incoming.tags,'{}'),collection=coalesce(incoming.collection,''),
   equipment=coalesce(incoming.equipment,'[]'::jsonb),view_metadata=coalesce(incoming.view_metadata,'{}'::jsonb),
   classification=coalesce(incoming.classification,'{}'),user_corrected=coalesce(incoming.user_corrected,false),route_points=coalesce(incoming.route_points,'[]'),sync_fingerprint=p_fingerprint
   where id=incoming.id and owner_id=p_owner returning revision into saved_revision;
 else
  if p_expected_revision is not null then raise exception 'Cloud activity was removed; refusing resurrection'; end if;
  insert into public.activities(id,owner_id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,vehicle,description,notes,tags,collection,equipment,view_metadata,classification,user_corrected,route_points,visibility,sync_fingerprint)
   values(incoming.id,p_owner,incoming.title,incoming.activity,incoming.recording_mode,incoming.started_at,incoming.ended_at,incoming.duration_seconds,incoming.distance_meters,incoming.vehicle,coalesce(incoming.description,''),coalesce(incoming.notes,''),coalesce(incoming.tags,'{}'),coalesce(incoming.collection,''),coalesce(incoming.equipment,'[]'::jsonb),coalesce(incoming.view_metadata,'{}'::jsonb),coalesce(incoming.classification,'{}'),coalesce(incoming.user_corrected,false),coalesce(incoming.route_points,'[]'),'private',p_fingerprint)
   returning revision into saved_revision;
 end if;
 return saved_revision;
end $$;
revoke all on function public.backup_private_activity(uuid,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.backup_private_activity(uuid,jsonb,text,integer) to authenticated;
commit;
