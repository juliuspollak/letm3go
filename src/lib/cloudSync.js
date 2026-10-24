// Explicit owner consent is required by the caller. Native records remain the queue.
export async function syncPrivateActivities(client,state,receipts={}){
 const {data,error}=await client.auth.getUser();if(error||!data.user)throw new Error('Sign in before synchronising.');
 const owner=data.user.id,updated={...receipts};let uploaded=0,deleted=0;
 for(const id of state.deletedIDs||[]){
  const receipt=updated[id];if(receipt?.owner!==owner)continue;
  const {error}=await client.from('activities').delete().eq('id',id).eq('owner_id',owner);if(error)throw error;
  // Keep the receipt and native tombstone so deletion is retried idempotently.
  updated[id]={...receipt,deleted:true};deleted++;
 }
 const tombstones=new Set((state.deletedIDs||[]).map(id=>id.toLowerCase()));
 for(const trip of state.trips){
  if(trip.source!=='device'||tombstones.has(trip.id.toLowerCase()))continue;
  const previous=updated[trip.id];if(previous&&previous.owner!==owner)continue;
  const details=trip.details||{};
  const row={id:trip.id,title:trip.title,activity:trip.activity,recording_mode:trip.recordingMode||'manual',started_at:new Date(trip.startedAt*1000).toISOString(),ended_at:new Date(trip.endedAt*1000).toISOString(),duration_seconds:trip.durationSeconds,distance_meters:trip.distanceMeters,vehicle:trip.vehicle||null,description:details.description||'',notes:details.notes||'',tags:details.tags||[],collection:details.collection||'',classification:details.classification||{predicted:'Unknown',confidence:'low',evidence:[]},user_corrected:!!details.userCorrected,route_points:trip.points,visibility:'private'};
  const fingerprint=JSON.stringify(row);if(previous?.fingerprint===fingerprint)continue;
  if(previous?.revision){const {data:remote,error}=await client.from('activities').select('revision').eq('id',trip.id).maybeSingle();if(error)throw error;if(!remote||remote.revision!==previous.revision)throw new Error('This activity changed in the cloud or was deleted. Resolve the conflict before syncing.');}
  const {data:saved,error}=await client.from('activities').upsert(row).select('revision').single();if(error)throw error;
  updated[trip.id]={owner,fingerprint,revision:saved.revision};uploaded++;
 }
 // Saved places are owner-only; no public projection reads this table directly.
 const localPlaces=new Set((state.places||[]).map(p=>`place:${p.id}`));
 for(const [key,receipt] of Object.entries(updated)){
  if(key.startsWith('place:')&&receipt.owner===owner&&!localPlaces.has(key)){
   const {error}=await client.from('saved_places').delete().eq('id',key.slice(6)).eq('owner_id',owner);if(error)throw error;delete updated[key];
  }
 }
 for(const place of state.places||[]){
  const key=`place:${place.id}`,fingerprint=JSON.stringify(place),receipt=updated[key];
  if(receipt&&(receipt.owner!==owner||receipt.fingerprint===fingerprint))continue;
  const {error}=await client.from('saved_places').upsert(place);if(error)throw error;updated[key]={owner,fingerprint};
 }
 return {receipts:updated,uploaded,deleted,lastSync:new Date().toISOString()};
}
