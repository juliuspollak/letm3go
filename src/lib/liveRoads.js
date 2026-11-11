import {gapKey,roadRecord,failedRecord,routeGaps} from './gapReconstruction.js';

// Road estimates for GPS gaps in a drive that is still being recorded. The same gap
// detection, plausibility check and record shape as a finished drive (so the answer
// is the one kept when it finishes), computed once here on the owner's phone and
// published for viewers, who never ask Apple Maps themselves.
const records=new Map(); // gap key -> road record, for this app session
const LIMIT=200;
export function rememberLiveRoad(key,record){
 records.delete(key);records.set(key,record);
 while(records.size>LIMIT)records.delete(records.keys().next().value);
}
// useJourneyGrouping asks here before Apple Maps, so a drive that finishes reuses
// what it found while driving.
export const liveRoad=key=>records.get(key);
export const forgetLiveRoads=()=>{records.clear();forgetPublished();};

// Which roads viewers have been given, and when a failed publication may be tried again.
const published=new Set(),publishRetryAt=new Map();
export const forgetPublished=()=>{published.clear();publishRetryAt.clear();};
const accepted=result=>Boolean(result)&&!result.error&&result.data!==false;

// One pass over the drive's closed gaps: ask Apple Maps for the ones not yet answered
// (once each), and give viewers every road found, retrying a publication that failed or
// was refused (no trail row yet, sharing off) instead of treating the road as delivered.
// `pace`: milliseconds between two Apple Maps requests (the same care useJourneyGrouping takes).
export async function liveRoadWork({trip,lookup,publish,held=()=>null,perPass=3,now=Date.now(),pace=3000}){
 const done=[];let lookups=0;
 for(const gap of routeGaps(trip,{live:true})){
  if(done.length>=perPass)break;
  const key=gapKey(trip.id,gap);
  let record=records.get(key)||held(key),worked=false;
  if(!record||(record.retryAfter&&record.retryAfter<=now)){
   if(lookups++>0&&pace>0)await new Promise(r=>setTimeout(r,pace));
   try{const found=await lookup(gap.from,gap.to);record=roadRecord(found?.routes||[],gap,now);}
   catch{record=failedRecord(record,now);}
   rememberLiveRoad(key,record);worked=true;
  }
  if(record.status==='route'&&record.line&&!published.has(key)&&(publishRetryAt.get(key)||0)<=now){
   let ok;
   try{ok=accepted(await publish(trip.id,key,record.line));}catch{ok=false;}
   if(ok){published.add(key);publishRetryAt.delete(key);}
   else publishRetryAt.set(key,now+30000);
   worked=true;
  }
  if(worked)done.push(key);
 }
 return done;
}
