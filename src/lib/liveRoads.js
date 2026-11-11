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
export const forgetLiveRoads=()=>records.clear();

export async function liveRoadWork({trip,lookup,publish,held=()=>null,perPass=3,now=Date.now()}){
 const done=[];
 for(const gap of routeGaps(trip,{live:true})){
  if(done.length>=perPass)break;
  const key=gapKey(trip.id,gap),known=records.get(key)||held(key);
  if(known&&!(known.retryAfter&&known.retryAfter<=now))continue;
  let record;
  try{const found=await lookup(gap.from,gap.to);record=roadRecord(found?.routes||[],gap,now);}
  catch{record=failedRecord(known,now);}
  rememberLiveRoad(key,record);
  if(record.status==='route'&&record.line)await publish(trip.id,key,record.line).catch(()=>{});
  done.push(key);
 }
 return done;
}
