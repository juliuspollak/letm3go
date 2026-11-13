import {namedSegments,isCommunitySegmentActivity,connected} from './namedSegments.js';
import {segmentDefinition,publicSegmentDefinition,matchEfforts} from './segmentMatcher.js';

export const WATCH_SEGMENT_LIMIT=128,WATCH_REFERENCE_LIMIT=32768;
// Prefer the deliberate recording when two devices observed the same physical
// attempt. Never choose a source just because its GPS made the time faster.
export function canonicalSegmentAttempts(attempts){
 const priority=pass=>pass.trip.recordingMode==='automatic'?2:pass.trip.source==='watch'||pass.trip.recordingMode==='watch'?0:1;
 const sorted=[...attempts].sort((a,b)=>priority(a)-priority(b)||a.startedAt-b.startedAt);
 const kept=[];
 for(const pass of sorted){
  const duplicate=kept.some(other=>{
   const overlap=Math.min(pass.startedAt+pass.elapsedSeconds,other.startedAt+other.elapsedSeconds)-Math.max(pass.startedAt,other.startedAt);
   return overlap>0&&overlap>=Math.min(pass.elapsedSeconds,other.elapsedSeconds)*0.5;
  });
  if(!duplicate)kept.push(pass);
 }
 return kept.sort((a,b)=>a.startedAt-b.startedAt);
}
export function segmentReferences(trips,publicSegments=[]){
 const published=new Map(publicSegments.filter(s=>s.status==='approved'&&s.visibility==='public').map(s=>[s.id.toLowerCase(),s]));
 const saved=[];
 for(const trip of trips||[]){
  for(const segment of namedSegments(trip)){
   if(published.has(segment.id.toLowerCase()))continue;
   const definition=segmentDefinition({id:segment.id,name:segment.name,trip,start:segment.startIndex,end:segment.endIndex,saved:true});
   if(definition?.lengthMeters>=50&&!(segment.gapSeconds>0)&&trip.points.slice(segment.startIndex+1,segment.endIndex+1).every((p,i)=>p.timestamp<=trip.points[segment.startIndex+i].timestamp||connected(trip.points[segment.startIndex+i],p)))saved.push({definition,activity:trip.activity,saved:true});
  }
 }
 const nearby=[...published.values()].flatMap(segment=>{
  const directions=segment.direction==='both'?[false,true]:[segment.direction==='reverse'];
  return directions.map(reverse=>({definition:publicSegmentDefinition(segment,{reverse}),activity:segment.activity,saved:false}));
 });
 return [...saved,...nearby].filter(r=>r.definition?.reference?.length>=2&&r.definition.reference.length<=4096);
}
export async function buildWatchSegments({ownerID,trips=[],publicSegments=[],now=Date.now()/1000,yieldWork=()=>Promise.resolve(),cryptoImpl=crypto}){
 const eligible=trips.filter(t=>isCommunitySegmentActivity(t.activity)&&Number.isFinite(t.endedAt)&&t.details?.provisional!==true&&t.points?.length>=5);
 const definitions=[];let vertices=0;
 for(const {definition,activity} of segmentReferences(eligible,publicSegments)){
  if(definitions.some(d=>d.id===definition.id))continue;
  if(definitions.length>=WATCH_SEGMENT_LIMIT||vertices+definition.reference.length>WATCH_REFERENCE_LIMIT)continue;
  const attempts=[];
  for(const trip of eligible){
   const compatible=trip.activity===activity||(['MTB','Cycling','Road cycling'].includes(trip.activity)&&['MTB','Cycling','Road cycling'].includes(activity));
   if(!compatible)continue;
   for(const effort of matchEfforts(definition,trip).efforts)attempts.push({trip,startedAt:effort.startTimestamp,elapsedSeconds:effort.elapsedSeconds,interrupted:effort.gapSeconds>0});
  }
  const best=canonicalSegmentAttempts(attempts).filter(a=>!a.interrupted&&a.elapsedSeconds>0).sort((a,b)=>a.elapsedSeconds-b.elapsedSeconds||a.startedAt-b.startedAt)[0];
  definitions.push({id:definition.id,name:definition.name+(definition.id.endsWith(':reverse')?' (reverse)':''),activity,reference:definition.reference.map(p=>[p.latitude,p.longitude,p.along]),lengthMeters:definition.lengthMeters,
   ...(best?{bestSeconds:best.elapsedSeconds,bestAt:best.startedAt,bestActivityID:best.trip.id}:{})});
  vertices+=definition.reference.length;
  await yieldWork();
 }
 const owner=ownerID.toLowerCase(),content=JSON.stringify({ownerID:owner,definitions});
 const revision=[...new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(content)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 return {schema:1,ownerID:owner,revision,generatedAt:now,definitions};
}
