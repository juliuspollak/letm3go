import {SEGMENT_PUBLICATION_VERSION,segmentFingerprint,segmentReceipt} from './segmentSyncState.js';
import {sliceActivityRoute} from './mtbSegment.js';
import {backupClassification} from './stopBackup.js';
import {resolvePhoto} from './privateMedia.js';
import {isCommunitySegmentActivity} from './namedSegments.js';
import {activityCode} from './activityNames.js';
import {SEGMENT_MATCHER_VERSION,matchEfforts,publicSegmentDefinition} from './segmentMatcher.js';
// Owner-private permanent activity backup. Local originals stay durable until
// confirmation. Requires the existing named-segment/Watch schema migration;
// community MTB publication is a separate, moderated selected-geometry proposal.
export const PRIVATE_BACKUP_VERSION=2;
export const NAMED_SEGMENT_BACKUP=true;
// Ownership-confirmed Watch recordings retain their provenance on replacement.
export const WATCH_MODE_BACKUP=true;
export const BACKED_UP_SOURCES=['device','watch'];
// At most this many rides are matched against community segments per sync, newest
// first, so a first sync after installing never stalls on the whole history.
export const EFFORT_TRIPS_PER_SYNC=5;
// Matching older rides against segments published later: at most this many
// ride-against-segment matches per sync, reading the catalogue in pages of this size.
export const BACKFILL_MATCHES_PER_SYNC=20;
export const BACKFILL_PAGE=50;
// Having reached the end of the catalogue, it is not asked again for this long.
export const CATALOGUE_RECHECK_MS=10*60*1000;
// Why the server refused a segment, in words the Segments view can show.
export function segmentRefusal(message=''){
 if(/another creator/i.test(message))return 'This segment ID belongs to someone else.';
 if(/GPS gap/i.test(message))return 'The section crosses a GPS gap. Choose a section without one.';
 if(/too short/i.test(message))return 'The section is shorter than 50 m.';
 if(/too long/i.test(message))return 'The section is longer than 100 km.';
 if(/too few points/i.test(message))return 'The section has too few GPS points.';
 return 'The server could not publish this section.';
}
function routeArea(points){
 let minLat=90,maxLat=-90,minLon=180,maxLon=-180;
 for(const p of points){if(!Number.isFinite(p?.latitude)||!Number.isFinite(p?.longitude))continue;minLat=Math.min(minLat,p.latitude);maxLat=Math.max(maxLat,p.latitude);minLon=Math.min(minLon,p.longitude);maxLon=Math.max(maxLon,p.longitude);}
 if(minLat>maxLat)return null;
 const r=v=>Math.round(v*1e4)/1e4;
 return {minLat:r(minLat-0.001),maxLat:r(maxLat+0.001),minLon:r(minLon-0.001),maxLon:r(maxLon+0.001)};
}
// The small grid cells (about 11 km) the ride actually passes through, each a
// separate request with room for 200 segments. Asking per cell along the route,
// not for its whole bounding box, keeps the segments it crossed from being pushed
// out by longer ones elsewhere in a dense area.
export function routeTiles(points,size=0.1){
 const cells=new Map(),pad=0.002;
 for(const p of points){
  if(!Number.isFinite(p?.latitude)||!Number.isFinite(p?.longitude))continue;
  const lat=Math.floor(p.latitude/size),lon=Math.floor(p.longitude/size);
  cells.set(`${lat}:${lon}`,{minLat:lat*size-pad,maxLat:(lat+1)*size+pad,minLon:lon*size-pad,maxLon:(lon+1)*size+pad});
 }
 return [...cells.values()];
}
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
// A stopped journey is published locally before it is complete. It is backed up
// (and matched) only once finalised, so the cloud never receives a row that is
// still growing and no duplicate revision is required to correct it.
export function finishedTrip(state){
 const tombstones=new Set((state.deletedIDs||[]).map(id=>id.toLowerCase()));
 return trip=>BACKED_UP_SOURCES.includes(trip.source)&&trip.details?.provisional!==true&&Number.isFinite(trip.endedAt)&&!tombstones.has(trip.id.toLowerCase());
}
const hashWith=cryptoImpl=>async value=>Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
// Segment efforts on their own: run by syncPrivateActivities after a backup, and
// by AutoCloudSync now and then even when nothing local changed, so rides already
// recorded meet segments other people published since.
export async function syncSegmentEfforts(client,state,updated,{owner,hash=hashWith(crypto),acknowledge=async()=>{},finished=finishedTrip(state),republish=new Set()}){
 let pending=false,failure=null;
 // Efforts. Only the segment, time taken and start time are sent, under a one-way
 // hashed key, so the server learns nothing about the activity itself, and only
 // if the person takes part (Account & settings → Segment efforts; anonymous by
 // default). Two bounded passes:
 //  1. each finished ride is matched once (again when it changes, the matcher
 //     improves or one of its own segments was just published) against the public
 //     segments around it;
 //  2. segments published or changed later are matched against rides already done
 //     (whose area overlaps), from a durable cursor over the public catalogue.
 const eligible=trip=>finished(trip)&&isCommunitySegmentActivity(trip.activity)&&Array.isArray(trip.points)&&trip.points.length>=5;
 // Nothing to match without a ride that can have efforts: no request is made.
 let takingPart=false;
 if((state.trips||[]).some(eligible)){
  const {data:participation,error:participationError}=await client.from('notification_settings').select('segment_participation').eq('user_id',owner).maybeSingle();
  takingPart=!participationError&&participation?.segment_participation!=='off';
  if(participationError)failure=failure||new Error('Segment effort settings could not be read. Efforts will be recorded on the next sync.');
 }
 const keptPoints=trip=>{
  // Only the part of the recording the person kept: a trimmed-off drive home
  // never becomes an effort, let alone a record.
  const start=trip.visibleRouteStart??trip.details?.visibleRouteStart??0,end=trip.visibleRouteEnd??trip.details?.visibleRouteEnd??trip.points.length-1;
  return trip.points.slice(Math.max(0,start),end+1);
 };
 const recordEfforts=async(trip,points,rows)=>{
  for(const row of rows){
   const definition=publicSegmentDefinition({...row,status:'approved',visibility:'public'});
   if(!definition)continue;
   for(const effort of matchEfforts(definition,{...trip,points}).efforts){
    // The route version is part of the key: a pass re-matched after the route
    // changed is a new effort on the new board, not the old one again.
    const clientKey=(await hash([owner,trip.id,row.id,row.version??1,effort.startTimestamp])).slice(0,40);
    const {error:failed}=await client.rpc('record_segment_effort',{p_client_key:clientKey,p_segment_id:row.id,p_elapsed_seconds:effort.elapsedSeconds,
     p_started_at:new Date(effort.startTimestamp*1000).toISOString(),p_matcher_version:SEGMENT_MATCHER_VERSION});
    // An implausible time, a segment deleted meanwhile or participation switched
    // off is skipped; anything else leaves the work to the next sync.
    if(failed&&!/Invalid effort|Segment unavailable|Segment efforts are off/i.test(failed.message||''))throw failed;
   }
  }
 };
 let effortsChecked=0;
 for(const trip of takingPart?[...(state.trips||[])].sort((a,b)=>b.startedAt-a.startedAt):[]){
  if(!eligible(trip))continue;
  const key=`segment-efforts:${trip.id}`,fingerprint=`${SEGMENT_MATCHER_VERSION}|${trip.updatedAt??''}`;
  if(updated[key]?.owner===owner&&updated[key].fingerprint===fingerprint&&!republish.has(trip.id))continue;
  // More rides are waiting: the next pass continues instead of treating this as done.
  if(effortsChecked>=EFFORT_TRIPS_PER_SYNC){pending=true;break;}
  effortsChecked++;
  try{
   const points=keptPoints(trip),segments=new Map();
   // The cells the ride passes through, each with room for 200 segments.
   for(const area of routeTiles(points)){
    const {data,error}=await client.rpc('segments_for_map',{p_min_lat:area.minLat,p_max_lat:area.maxLat,p_min_lon:area.minLon,p_max_lon:area.maxLon,p_limit:200});
    if(error)throw error;
    for(const row of Array.isArray(data)?data:[])segments.set(row.id,row);
   }
   await recordEfforts(trip,points,segments.values());
   // The ride's area is kept so a later segment can be checked against it cheaply.
   updated[key]={owner,fingerprint,area:routeArea(points)};await acknowledge();
  }catch{failure=failure||new Error('Segment efforts were not all recorded. They will retry on the next sync.');}
 }
 if(takingPart){
  try{if(await catchUpOlderRides())pending=true;}
  catch{failure=failure||new Error('Older rides were not all matched to new segments. They will continue on the next sync.');}
 }
 // Pass 2. The cursor and queue live in the receipts, so a sync cut short resumes
 // exactly where it stopped; at most BACKFILL_MATCHES_PER_SYNC ride matches run per
 // sync. Rides not matched yet are left to pass 1, which sees the whole catalogue.
 async function catchUpOlderRides(){
  const key='segment-catalogue',saved=updated[key]?.owner===owner?updated[key]:null;
  let cursor={owner,since:saved?.since??null,after:saved?.after??null,checkedAt:saved?.checkedAt??0,queue:(saved?.queue||[]).map(item=>({...item,trips:[...item.trips]}))};
  // Caught up a moment ago and nothing queued: no request at all.
  if(!cursor.queue.length&&Date.now()-cursor.checkedAt<CATALOGUE_RECHECK_MS)return false;
  const save=async()=>{updated[key]={...cursor,queue:cursor.queue.map(item=>({...item,trips:[...item.trips]}))};await acknowledge();};
  const trips=new Map((state.trips||[]).filter(eligible).map(trip=>[trip.id,trip]));
  const areaOf=trip=>{
   const receipt=updated[`segment-efforts:${trip.id}`];
   if(receipt?.owner!==owner)return null;
   if(!receipt.area)updated[`segment-efforts:${trip.id}`]={...receipt,area:routeArea(keptPoints(trip))};
   return updated[`segment-efforts:${trip.id}`].area;
  };
  let budget=BACKFILL_MATCHES_PER_SYNC,more=true;
  while(budget>0){
   if(!cursor.queue.length){
    if(!more)break;
    const {data,error}=await client.rpc('segment_catalogue_since',{p_since:cursor.since,p_after:cursor.after,p_limit:BACKFILL_PAGE});
    if(error)throw error;
    const rows=Array.isArray(data)?data:[];
    more=rows.length===BACKFILL_PAGE;
    if(!more)cursor={...cursor,checkedAt:Date.now()};
    if(!rows.length){await save();break;}
    for(const row of rows){
     const overlapping=[...trips.values()].filter(trip=>{const a=areaOf(trip);return a&&a.minLat<=row.max_lat&&a.maxLat>=row.min_lat&&a.minLon<=row.max_lon&&a.maxLon>=row.min_lon;}).map(trip=>trip.id);
     if(overlapping.length)cursor.queue.push({id:row.id,version:row.version,trips:overlapping});
    }
    cursor={...cursor,since:rows.at(-1).changed_at,after:rows.at(-1).id};
    await save();continue;
   }
   const item=cursor.queue[0];
   const {data:segment,error}=await client.rpc('segment_detail',{p_id:item.id});
   if(error)throw error;
   // Deleted, gone or changed again since (a later catalogue page brings it back).
   if(!segment||segment.deleted||segment.version!==item.version||!Array.isArray(segment.geometry)){cursor.queue.shift();await save();continue;}
   while(item.trips.length&&budget>0){
    const trip=trips.get(item.trips[0]);
    if(trip)await recordEfforts(trip,keptPoints(trip),[{id:segment.id,name:segment.name,version:segment.version,geometry:segment.geometry}]);
    item.trips.shift();budget--;
   }
   if(!item.trips.length)cursor.queue.shift();
   await save();
  }
  return cursor.queue.length>0||more&&budget===0;
 }
 return {pending,failure};
}

export const SEGMENTS_PER_PASS=10;
const sameOwner=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const segmentKey=id=>`mtb-segment:${id.toLowerCase()}`;
// One publication mechanism for startup recovery, native saves and explicit
// backup. Only selected geometry is sent; private routes/photos are independent.
export async function syncPublicSegments(client,state,receipts={}, {owner,checkpoint=async()=>{},maxSegments=SEGMENTS_PER_PASS,now=Date.now}={}){
 const updated={...receipts},republish=new Set();let failure=null,published=0;
 const limit=Number.isFinite(maxSegments)?Math.min(SEGMENTS_PER_PASS,Math.max(1,Math.floor(maxSegments))):SEGMENTS_PER_PASS;
 if(!sameOwner(state.ownerID,owner))throw new Error('Segment account does not match the native recordings.');
 const candidates=[],seen=new Set(),finished=finishedTrip(state);
 for(const trip of state.trips||[]){
  if(!finished(trip)||!isCommunitySegmentActivity(trip.activity))continue;
  for(const segment of trip.details?.namedSegments||[]){
   if(typeof segment?.id!=='string'||seen.has(segment.id.toLowerCase()))continue;
   seen.add(segment.id.toLowerCase());
   const receipt=segmentReceipt(updated,segment.id),fingerprint=segmentFingerprint(segment);
   if(sameOwner(receipt?.owner,owner)&&receipt.publicationVersion===SEGMENT_PUBLICATION_VERSION&&receipt.fingerprint===fingerprint&&!receipt.failed)continue;
   candidates.push({trip,segment,receipt:sameOwner(receipt?.owner,owner)?receipt:null,fingerprint});
  }
 }
 if(!candidates.length)return {receipts:updated,republish,published,pending:false,failure:null};
 let token,data,authError;
 try{
  const session=client.auth.getSession?await client.auth.getSession():null;
  token=session?.data?.session?.access_token;
  if(client.auth.getSession&&(!token||session?.error))throw new Error('Session verification unavailable');
  const result=await client.auth.getUser(token);data=result.data;authError=result.error;
 }catch(error){authError=error;}
 if(authError||!data?.user){
  for(const {segment,receipt,fingerprint} of candidates.slice(0,limit))updated[segmentKey(segment.id)]={owner,fingerprint,publicationVersion:SEGMENT_PUBLICATION_VERSION,publicationAt:now(),
   ...(receipt?.sent?{sent:receipt.sent}:{}),failed:'Sign-in verification is temporarily unavailable.',errorCode:'AUTH_UNAVAILABLE',attempts:(receipt?.attempts||0)+1,firstFailureAt:receipt?.firstFailureAt||now()};
  await checkpoint({...updated});
  return {receipts:updated,republish,published,pending:false,failure:new Error('Sign-in verification is temporarily unavailable.')};
 }
 if(!sameOwner(data.user.id,owner))throw new Error('Sign in to publish your segments.');
 // A failing section cannot starve later entries. Attempts are durable, so each
 // bounded pass resumes with sections not attempted yet, then the oldest retry.
 candidates.sort((a,b)=>(a.receipt?.publicationAt||0)-(b.receipt?.publicationAt||0));
 const request=builder=>token?builder.setHeader('Authorization',`Bearer ${token}`):builder;
 const read=async id=>{
  const {data,error}=await request(client.from('mtb_segments').select('id,creator_id,name,status,visibility,access,deleted_at,version').eq('id',id).maybeSingle());
  if(error)throw error;
  return data;
 };
 for(const {trip,segment,receipt,fingerprint} of candidates.slice(0,limit)){
  const id=segment.id.toLowerCase(),key=segmentKey(id),sent=receipt?.sent;
  const base={owner,fingerprint,publicationVersion:SEGMENT_PUBLICATION_VERSION,publicationAt:now(),...(sent?{sent}:{})};
  try{
   const existing=await read(id);
   const blocked=existing&&(!sameOwner(existing.creator_id,owner)||existing.deleted_at||['hidden','rejected','retired','changes_requested'].includes(existing.status)||['restricted','closed_temporary','closed_permanent','sensitive'].includes(existing.access));
   if(blocked){updated[key]={...base,blocked:true,serverStatus:existing.status,...(!sameOwner(existing.creator_id,owner)?{reason:'This section belongs to another account. Contact support to review it.',ownershipMismatch:true}:{})};await checkpoint({...updated});continue;}
   const selection=sliceActivityRoute(trip.points,segment.startIndex,segment.endIndex);
   if(!selection){updated[key]={...base,skipped:'geometry',reason:'Open the original activity and choose a section with at least five GPS points.'};await checkpoint({...updated});continue;}
   // A receipt without a baseline (including old builds) must never overwrite
   // an admin correction. New inserts ignore these edit flags on the server.
   const {data,error}=await request(client.rpc('publish_segment',{p_client_id:id,p_name:segment.name,p_geometry:selection.geometry.map(([lat,lon])=>[lat,lon]),
    p_activity:existing?null:activityCode(trip.activity),p_rename:Boolean(sent&&sent.name!==segment.name),
    p_reroute:Boolean(sent&&(sent.start!==segment.startIndex||sent.end!==segment.endIndex))}));
   if(error)throw error;
   if(typeof data!=='string'||data.toLowerCase()!==id)throw new Error('The server did not confirm this section.');
   const confirmed=await read(id);
   if(!confirmed||!sameOwner(confirmed.creator_id,owner)||confirmed.deleted_at||confirmed.status!=='approved'||confirmed.visibility!=='public'||['restricted','closed_temporary','closed_permanent','sensitive'].includes(confirmed.access)){
    updated[key]={...base,blocked:true,serverStatus:confirmed?.status||'unavailable'};
   }else{
    updated[key]={...base,uploaded:true,confirmedAt:now(),sent:{name:segment.name,start:segment.startIndex,end:segment.endIndex}};
    published++;republish.add(trip.id);
   }
   await checkpoint({...updated});
  }catch(error){
   const permanent=/Invalid segment proposal|another creator/i.test(error.message||'');
   updated[key]={...base,...(permanent?{skipped:'refused',reason:segmentRefusal(error.message)}:{failed:String(error.message||'Publication unavailable').slice(0,300),errorCode:String(error.code||'NETWORK').slice(0,30),attempts:(receipt?.attempts||0)+1,firstFailureAt:receipt?.firstFailureAt||now()})};
   await checkpoint({...updated});
   if(!permanent)failure=new Error('Segment publishing was not confirmed. It remains on this device for retry.');
  }
 }
 return {receipts:updated,republish,published,pending:candidates.length>limit,failure};
}

export async function syncPrivateActivities(client,state,receipts={}, {checkpoint=async()=>{},cryptoImpl=crypto,maxActivities=Infinity,publishSegments=true}={}){
 const {data,error}=await client.auth.getUser();if(error||!data.user)throw new Error('Sign in before backing up.');
 const owner=data.user.id;
 if(state.ownerID?.toLowerCase()!==owner.toLowerCase())throw new Error('Backup account does not match the native recordings.');
 if(!cryptoImpl.subtle)throw new Error('Secure backup hashing is unavailable on this device.');
 const hash=hashWith(cryptoImpl);
 const updated={...receipts};let uploaded=0,deleted=0,processed=0,pending=false;
 const acknowledge=async()=>checkpoint({...updated});
 let segmentFailure=null;const republish=new Set();
 if(publishSegments){
  const publication=await syncPublicSegments(client,state,updated,{owner,checkpoint});
  Object.assign(updated,publication.receipts);segmentFailure=publication.failure;pending=publication.pending;
  for(const id of publication.republish)republish.add(id);
 }
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
  const key=`place:${place.id}`,row={id:place.id,owner_id:owner,name:place.name,kind:place.kind,latitude:place.latitude,longitude:place.longitude,radius:place.radius,share_with_friends:place.shareWithFriends===true};
  const fingerprint=await hash(row),receipt=updated[key];
  if(receipt&&receipt.owner!==owner)throw new Error('Place backup belongs to another account.');
  if(receipt?.fingerprint===fingerprint)continue;
  let {error}=await client.from('saved_places').upsert(row);
  // A server without the share_with_friends column yet still backs the place up.
  if(error&&/share_with_friends/i.test(error.message||'')){const legacy={...row};delete legacy.share_with_friends;({error}=await client.from('saved_places').upsert(legacy));}
  if(error)throw new Error('Private places could not be backed up.');updated[key]={owner,fingerprint};await acknowledge();
 }
 const finished=finishedTrip(state);
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
 {
  const efforts=await syncSegmentEfforts(client,state,updated,{owner,hash,acknowledge,finished,republish});
  if(efforts.pending)pending=true;
  segmentFailure=segmentFailure||efforts.failure;
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
 if(segmentFailure)throw segmentFailure;
 return {receipts:updated,uploaded,photosUploaded,deleted,pending,lastSync:new Date().toISOString()};
}
