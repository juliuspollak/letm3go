import {sliceActivityRoute} from './mtbSegment.js';
import {backupClassification} from './stopBackup.js';
import {resolvePhoto} from './privateMedia.js';
import {wakePush} from './pushWake.js';
// Owner-private permanent activity backup. Local originals stay durable until
// confirmation. Requires the existing named-segment/Watch schema migration;
// community MTB publication is a separate, moderated selected-geometry proposal.
export const PRIVATE_BACKUP_VERSION=2;
export const NAMED_SEGMENT_BACKUP=true;
// Ownership-confirmed Watch recordings retain their provenance on replacement.
export const WATCH_MODE_BACKUP=true;
export const BACKED_UP_SOURCES=['device','watch'];
export function cloudRecordingMode(trip){
 if(trip.source==='watch')return WATCH_MODE_BACKUP?'watch':'manual';
 return trip.recordingMode||'manual';
}
// References into route_points only: the geometry copy is left out because the
// route itself is backed up alongside.
export function backupSegments(segments){
 return (Array.isArray(segments)?segments:[]).slice(0,20)
  .filter(s=>typeof s?.id==='string'&&s.id.length===36&&typeof s.name==='string'&&s.name.trim()&&Number.isInteger(s.startIndex)&&Number.isInteger(s.endIndex)&&s.startIndex<s.endIndex)
  .map(s=>({id:s.id,name:s.name.slice(0,80),startIndex:s.startIndex,endIndex:s.endIndex,startTimestamp:s.startTimestamp,endTimestamp:s.endTimestamp,distanceMeters:s.distanceMeters,durationSeconds:s.durationSeconds,gapSeconds:s.gapSeconds||0,pointCount:s.pointCount,colorIndex:s.colorIndex||0,visibility:'private',createdAt:s.createdAt,updatedAt:s.updatedAt}));
}
function viewMetadata(details){
 const out={};
 for(const key of ['visibleRouteStart','visibleRouteEnd'])if(Number.isInteger(details?.[key]))out[key]=details[key];
 for(const key of ['startPlace','endPlace'])if(typeof details?.[key]==='string'&&details[key])out[key]=details[key].slice(0,120);
 if(typeof details?.coverPhotoID==='string'&&details.coverPhotoID)out.coverPhotoID=details.coverPhotoID.slice(0,100);
 const segments=backupSegments(details?.namedSegments);
 if(NAMED_SEGMENT_BACKUP&&segments.length)out.namedSegments=segments;
 return out;
}
export async function syncPrivateActivities(client,state,receipts={}, {checkpoint=async()=>{},cryptoImpl=crypto,maxActivities=Infinity}={}){
 const {data,error}=await client.auth.getUser();if(error||!data.user)throw new Error('Sign in before backing up.');
 const owner=data.user.id;
 if(state.ownerID?.toLowerCase()!==owner.toLowerCase())throw new Error('Backup account does not match the native recordings.');
 if(!cryptoImpl.subtle)throw new Error('Secure backup hashing is unavailable on this device.');
 const hash=async value=>Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
 const updated={...receipts};let uploaded=0,deleted=0,processed=0,pending=false;
 const acknowledge=async()=>checkpoint({...updated});
 for(const id of state.deletedIDs||[]){
  const receipt=updated[id];if(receipt&&receipt.owner!==owner)throw new Error('Backup receipts belong to another account.');
  // A deletion the cloud already confirmed is not sent again on every backup.
  if(receipt?.deleted)continue;
  const {error}=await client.from('activities').delete().eq('id',id).eq('owner_id',owner);if(error)throw new Error('Cloud deletion could not be confirmed. Retry backup when connected.');
  updated[id]={...receipt,owner,deleted:true};deleted++;await acknowledge();
 }
 // Sensitive places precede routes; owner_id is explicit to reject a mid-request
 // account switch even if the SDK has already switched its Authorization header.
 // Never infer cloud deletions from a missing local place on a new device.
 for(const place of state.places||[]){
  const key=`place:${place.id}`,row={id:place.id,owner_id:owner,name:place.name,kind:place.kind,latitude:place.latitude,longitude:place.longitude,radius:place.radius};
  const fingerprint=await hash(row),receipt=updated[key];
  if(receipt&&receipt.owner!==owner)throw new Error('Place backup belongs to another account.');
  if(receipt?.fingerprint===fingerprint)continue;
  const {error}=await client.from('saved_places').upsert(row);if(error)throw new Error('Private places could not be backed up.');updated[key]={owner,fingerprint};await acknowledge();
 }
 const tombstones=new Set((state.deletedIDs||[]).map(id=>id.toLowerCase()));
 // A stopped journey is published locally before it is complete. It is backed up
 // only once finalised, so the cloud never receives a row that is still growing
 // and no duplicate revision is required to correct it.
 const finished=trip=>BACKED_UP_SOURCES.includes(trip.source)&&trip.details?.provisional!==true&&Number.isFinite(trip.endedAt)&&!tombstones.has(trip.id.toLowerCase());
 for(const trip of state.trips){
  if(!finished(trip))continue;
  const previous=updated[trip.id];if(previous&&previous.owner!==owner)throw new Error('Activity backup belongs to another account.');
  // Unchanged since its last backup: not serialised or hashed again.
  if(previous&&!previous.deleted&&previous.backupVersion===PRIVATE_BACKUP_VERSION&&Number.isFinite(trip.updatedAt)&&previous.updatedAt===trip.updatedAt)continue;
  if(processed>=maxActivities){pending=true;break;}processed++;
  const details=trip.details||{};
  const row={id:trip.id,title:trip.title,activity:trip.activity,recording_mode:cloudRecordingMode(trip),started_at:new Date(trip.startedAt*1000).toISOString(),ended_at:new Date(trip.endedAt*1000).toISOString(),duration_seconds:trip.durationSeconds,distance_meters:trip.distanceMeters,vehicle:trip.vehicle||null,description:details.description||'',notes:details.notes||'',tags:details.tags||[],collection:details.collection||'',equipment:(trip.equipment||[]).map(ref=>({id:String(ref.id).slice(0,100),name:String(ref.name||'').slice(0,100)})),view_metadata:viewMetadata(details),classification:backupClassification({...details,sourceUpdatedAt:trip.updatedAt},trip.startedAt,trip.endedAt),user_corrected:!!details.userCorrected,route_points:trip.points};
  const fingerprint=await hash(row);
  // Already backed up by an earlier build: remember updatedAt so it is not hashed again.
  if(previous?.fingerprint===fingerprint&&!previous.deleted){if(Number.isFinite(trip.updatedAt)){updated[trip.id]={...previous,backupVersion:PRIVATE_BACKUP_VERSION,updatedAt:trip.updatedAt};}continue;}
  const {data:revision,error}=await client.rpc('backup_private_activity',{p_owner:owner,p_payload:row,p_fingerprint:fingerprint,p_expected_revision:previous?.revision??null});
  if(error||!Number.isInteger(revision))throw new Error('Private backup needs the approved backend RPC, or this activity changed in the cloud. Your local data is preserved.');
  updated[trip.id]={owner,fingerprint,revision,backupVersion:PRIVATE_BACKUP_VERSION,...(Number.isFinite(trip.updatedAt)?{updatedAt:trip.updatedAt}:{})};uploaded++;await acknowledge();
 }
 // Public MTB definitions are proposals in the existing moderation system.
 // Native section IDs are durable idempotency keys; retrying cannot duplicate one.
 for(const trip of state.trips||[]){
  if(!finished(trip)||trip.activity!=='MTB'||updated[trip.id]?.backupVersion!==PRIVATE_BACKUP_VERSION)continue;
  for(const segment of trip.details?.namedSegments||[]){
   const key=`mtb-segment:${segment.id}`;
   if(updated[key]?.owner===owner&&updated[key]?.uploaded)continue;
   const selection=sliceActivityRoute(trip.points,segment.startIndex,segment.endIndex);
   if(!selection)throw new Error('MTB segment geometry could not be saved. The original recording is preserved.');
   const {data,error}=await client.rpc('create_mtb_segment',{p_client_id:segment.id,p_name:segment.name,p_geometry:selection.geometry.map(([lat,lon])=>[lat,lon]),p_distance_meters:selection.distanceMeters,p_direction:'both',p_access:'unknown'});
   if(error||data!==segment.id)throw new Error('MTB segment submission was not confirmed. It remains on this device for retry.');
   updated[key]={owner,uploaded:true};await acknowledge();
   // Moderators are told a new segment is waiting for review.
   void wakePush(client);
  }
 }
 let photosUploaded=0;
 for(const trip of state.trips||[]){
  if(!finished(trip))continue;
  for(const photo of trip.details?.photos||[]){
   const photoID=photo.id;
   if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(photoID||''))continue;
   const receiptKey=`photo:${trip.id}:${photoID}`;
   if(updated[receiptKey]?.owner===owner&&updated[receiptKey]?.uploaded===true)continue;
   if(!client.functions?.invoke)throw new Error('Private photo upload service is unavailable. Photos remain safely on this iPhone.');
   const privateURI=`private-photo:${owner}/${trip.id}/${photoID}`;
   const url=await resolvePhoto(privateURI);
   if(!url?.startsWith('data:image/jpeg;base64,'))throw new Error('Private image cannot be read for cloud sync. Local original is preserved.');
   const base64=url.slice('data:image/jpeg;base64,'.length);
   if(base64.length>6_700_000)throw new Error('Compressed photo exceeds the safe upload limit.');
   const {data:result,error:failure}=await client.functions.invoke('journeys',{body:{action:'upload',id:trip.id,mediaID:photoID,base64,caption:photo.caption||'',latitude:photo.latitude,longitude:photo.longitude,locationSource:photo.locationSource}});
   if(failure||!result||result.id?.toLowerCase()!==photoID.toLowerCase()){
    let stage=result?.stage||'unknown';
    let reason=result?.error||'Upload was not acknowledged';
    if(failure?.context?.json)try{const response=await failure.context.json();stage=response?.stage||stage;reason=response?.error||reason;}catch{/* Supabase transport error has no JSON body. */}
    const status=failure?.context?.status;
    throw new Error(`Cloud photo upload failed (${stage}${status?`, HTTP ${status}`:''}): ${reason}. Local photo is preserved.`);
   }
   updated[receiptKey]={owner,uploaded:true};photosUploaded++;await acknowledge();
  }
 }
 return {receipts:updated,uploaded,photosUploaded,deleted,pending,lastSync:new Date().toISOString()};
}
