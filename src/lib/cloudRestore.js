import {recorder} from './recorder.js';
import {supabase} from './supabase.js';

// Explicit, additive recovery. Never replaces existing activities or removes local files.
// The server's RLS restricts every query to the authenticated account.
export async function restoreCloudJournal({onProgress=()=>{}}={}){
 if(!supabase)throw new Error('Cloud connection unavailable.');
 const {data:auth,error:authError}=await supabase.auth.getUser();
 if(authError||!auth?.user)throw new Error('Sign in before restoring.');
 const owner=auth.user.id;
 const local=await recorder.getState();
 if(local.ownerID?.toLowerCase()!==owner.toLowerCase())throw new Error('The iPhone recorder is not unlocked for this account.');
 const {data:rows,error}=await supabase.from('activities').select('id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,vehicle,description,notes,tags,collection,classification,user_corrected,route_points,sync_fingerprint,revision').eq('owner_id',owner).eq('visibility','private').order('started_at',{ascending:true}).limit(1000);
 if(error)throw new Error('Could not read private cloud activities. Check the database migration and RLS.');
 let restored=0,photosRestored=0;
 const receipts={};
 const locallyKnown=new Set((local.trips||[]).map(t=>t.id.toLowerCase()));
 for(const row of rows||[]){
  if(row.recording_mode==='tesla'||!Array.isArray(row.route_points)||row.route_points.length>50000)continue;
  const start=Date.parse(row.started_at)/1000,end=Date.parse(row.ended_at)/1000;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)continue;
  if(!locallyKnown.has(row.id.toLowerCase())){
   const activity={id:row.id,activity:row.activity,title:row.title,vehicle:row.vehicle||null,startedAt:start,endedAt:end,state:'finished',accumulatedSeconds:row.duration_seconds,resumedAt:null,segment:0,points:row.route_points,distanceMeters:row.distance_meters,source:'device',recordingMode:row.recording_mode,details:{description:row.description||'',notes:row.notes||'',tags:row.tags||[],collection:row.collection||'',classification:row.classification||{predicted:'Unknown',confidence:'low',evidence:[]},userCorrected:!!row.user_corrected}};
   const result=await recorder.restoreActivity(activity);
   if(result.restored){restored++;locallyKnown.add(row.id.toLowerCase());}
  }
  if(row.sync_fingerprint)receipts[row.id]={owner,fingerprint:row.sync_fingerprint,revision:row.revision};
  const {data:assets,error:assetsError}=await supabase.from('media_assets').select('id,caption').eq('owner_id',owner).eq('activity_id',row.id).limit(50);
  if(assetsError)throw new Error('Could not retrieve this activity\'s private photo metadata.');
  for(const photo of assets||[]){
   const {data:link,error:linkError}=await supabase.functions.invoke('journeys',{body:{action:'download',id:row.id,mediaID:photo.id}});
   if(linkError||!link?.url)throw new Error('Could not securely download cloud photo.');
   const response=await fetch(link.url);
   if(!response.ok)throw new Error('Cloud photo could not be downloaded.');
   const bytes=await response.arrayBuffer();
   if(bytes.byteLength>5_000_000)throw new Error('Cloud photo exceeds safe recovery size.');
   const data=new Uint8Array(bytes);
   let binary='';for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));
   const outcome=await recorder.restorePhoto({tripID:row.id,photoID:photo.id,base64:btoa(binary),caption:photo.caption||''});
   if(outcome.restored)photosRestored++;
   receipts[`photo:${row.id}:${photo.id}`]={owner,uploaded:true};
  }
  onProgress({restored,photosRestored});
 }
 return {restored,photosRestored,receipts};
}
