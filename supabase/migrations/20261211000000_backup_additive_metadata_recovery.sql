-- Generated with the CLI; ordered after the existing future-dated chain.
-- Safe additive recovery for older acknowledgements; no stored rows are rewritten.
begin;

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
  if p_base_fingerprint is not null and p_expected_revision between 1 and current_trip.revision
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
