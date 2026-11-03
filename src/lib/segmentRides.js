import {namedSegments,segmentColor,segmentRuns} from './namedSegments.js';
import {SEGMENT_MATCHER_VERSION,matchEfforts,segmentDefinition} from './segmentMatcher.js';
import {thinLine} from './mapContent.js';

// A segment is a stretch of trail, not one lap of one ride. It is drawn once, on the
// ride it was made on, and from then on every ride through it counts. This works out
// which of them a ride passed, how often, and how each pass compares. Nothing here is
// stored: it is worked out from the recordings, so a deleted ride simply stops counting.
const clock=seconds=>{const s=Math.max(0,Math.round(seconds||0)),h=Math.floor(s/3600),m=Math.floor(s/60)%60,rest=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${rest}`:`${m}:${rest}`;};
const dayText=seconds=>new Date(seconds*1000).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'});
const timeText=seconds=>new Date(seconds*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'});

// Matching is the expensive step and a recording rarely changes, so each pairing of a
// segment and a ride is remembered until either one does.
const MATCHER=SEGMENT_MATCHER_VERSION;
const remembered=new Map();
const LIMIT=20000;
function effortsOn(definition,version,trip){
 const key=`${MATCHER}:${definition.id}:${version}:${trip.id}:${trip.updatedAt||0}:${trip.points.length}`;
 let efforts=remembered.get(key);
 if(!efforts){
  efforts=matchEfforts(definition,trip).efforts;
  if(remembered.size>=LIMIT)remembered.clear();
  remembered.set(key,efforts);
 }
 return efforts;
}
export function forgetSegmentRides(){remembered.clear();}

const riddenTrips=trips=>(trips||[]).filter(trip=>Array.isArray(trip?.points)&&trip.points.length>1);

// Every segment the person has made, with what is needed to look for it elsewhere.
function allSegments(trips){
 return trips.flatMap(owner=>namedSegments(owner).map(segment=>({segment,owner,
  definition:segmentDefinition({id:segment.id,name:segment.name,trip:owner,start:segment.startIndex,end:segment.endIndex,saved:true})})));
}

const bounds=points=>{let south=Infinity,north=-Infinity,west=Infinity,east=-Infinity;for(const p of points){if(!Number.isFinite(p?.latitude)||!Number.isFinite(p?.longitude))continue;south=Math.min(south,p.latitude);north=Math.max(north,p.latitude);west=Math.min(west,p.longitude);east=Math.max(east,p.longitude);}return {south,north,west,east};};
const overlap=(a,b,pad=0.0005)=>a.south<=b.north+pad&&b.south<=a.north+pad&&a.west<=b.east+pad&&b.west<=a.east+pad;

// Segments from other rides that lie in this ride's area, so a stretch that already has
// one can be seen before making it again. The ride's own are already on its map.
export function nearbySegmentLayers(trip,trips){
 const library=riddenTrips(trips);
 if(!Array.isArray(trip?.points)||trip.points.length<2)return {styled:[],pins:[]};
 const area=bounds(trip.points);
 const styled=[],pins=[];
 for(const {segment,owner} of allSegments(library)){
  if(owner.id===trip.id)continue;
  const section=owner.points.slice(segment.startIndex,segment.endIndex+1);
  if(!overlap(bounds(section),area))continue;
  const color=segmentColor(segment.colorIndex);
  const runs=segmentRuns(owner.points,segment.startIndex,segment.endIndex).filter(run=>run.length>1);
  for(const run of runs)styled.push({points:thinLine(run.map(p=>[p.latitude,p.longitude]),500),color,width:6,segmentID:segment.id});
  const middle=section[Math.floor(section.length/2)];
  if(middle)pins.push({point:[middle.latitude,middle.longitude],title:segment.name,kind:'segment',color,id:`segment:${segment.id}`});
 }
 return {styled,pins};
}

function passesOf({segment,owner,definition},trips){
 const version=`${segment.updatedAt||0}`;
 const passes=[];
 for(const trip of trips){
  for(const effort of definition?effortsOn(definition,version,trip):[])passes.push({trip,startedAt:effort.startTimestamp,elapsedSeconds:Math.max(0,effort.elapsedSeconds-effort.gapSeconds),interrupted:effort.gapSeconds>0});
 }
 // A section made across a GPS gap cannot be looked for elsewhere, and a segment always
 // counts on the ride that made it.
 if(!passes.some(pass=>pass.trip.id===owner.id))passes.push({trip:owner,startedAt:segment.startTimestamp,elapsedSeconds:segment.durationSeconds});
 return onePerLap(passes,trips);
}

// An automatic recording can run during a recorded ride. A lap it saw belongs to that
// ride, and one lap seen by both counts once.
function onePerLap(passes,trips){
 const recorded=trips.filter(trip=>trip.recordingMode!=='automatic'&&Number.isFinite(trip.endedAt));
 const placed=passes.map(pass=>{
  if(pass.trip.recordingMode!=='automatic')return pass;
  const ride=recorded.find(trip=>trip.startedAt<=pass.startedAt&&pass.startedAt<=trip.endedAt);
  return ride?{...pass,trip:ride,seenByAutomatic:true}:pass;
 }).sort((a,b)=>Boolean(a.seenByAutomatic)-Boolean(b.seenByAutomatic)||a.startedAt-b.startedAt);
 const kept=[];
 for(const pass of placed){
  const same=kept.some(other=>other.trip.id===pass.trip.id&&pass.startedAt<other.startedAt+other.elapsedSeconds&&other.startedAt<pass.startedAt+pass.elapsedSeconds);
  if(!same)kept.push(pass);
 }
 return kept;
}

// A lap with a break in the recording counts as ridden, but its time is not a real time.
const fastestFirst=(a,b)=>Boolean(a.interrupted)-Boolean(b.interrupted)||a.elapsedSeconds-b.elapsedSeconds||a.startedAt-b.startedAt;
const bestOf=passes=>{const clean=passes.find(pass=>!pass.interrupted);return clean?clock(clean.elapsedSeconds):'—';};
const MAX_LISTED=200;
export function segmentRides(trip,trips){
 const library=riddenTrips(trips);
 if(!trip?.id||!library.length)return [];
 const rows=[];
 for(const entry of allSegments(library)){
  const passes=passesOf(entry,library).sort(fastestFirst);
  const thisRide=passes.filter(pass=>pass.trip.id===trip.id).length;
  if(!thisRide)continue;
  const {segment,owner}=entry;
  rows.push({id:segment.id,ownerID:String(owner.id),owned:owner.id===trip.id,name:segment.name,color:segmentColor(segment.colorIndex),thisRide,total:passes.length,rideCount:new Set(passes.map(pass=>pass.trip.id)).size,best:bestOf(passes),
   passes:passes.slice(0,MAX_LISTED).map((pass,index)=>({id:`${pass.trip.id}:${pass.startedAt}`,activityID:String(pass.trip.id),rank:index+1,time:`${pass.interrupted?'~':''}${clock(pass.elapsedSeconds)}`,interrupted:pass.interrupted===true,when:`${dayText(pass.startedAt)} · ${timeText(pass.startedAt)}`,title:pass.trip.title||'Activity',current:pass.trip.id===trip.id}))});
 }
 return rows.sort((a,b)=>a.name.localeCompare(b.name));
}

// Everything needed to maintain segments, across every ride.
export function segmentLibrary(trips){
 const library=riddenTrips(trips);
 return allSegments(library).map(entry=>{
  const passes=passesOf(entry,library).sort(fastestFirst);
  const {segment,owner}=entry;
  return {id:segment.id,name:segment.name,color:segmentColor(segment.colorIndex),activityID:owner.id,activityTitle:owner.title||'Activity',startIndex:segment.startIndex,endIndex:segment.endIndex,total:passes.length,rideCount:new Set(passes.map(pass=>pass.trip.id)).size,best:bestOf(passes),when:dayText(segment.startTimestamp)};
 }).sort((a,b)=>a.name.localeCompare(b.name));
}

// For the recording report: why a segment was or was not found on this ride. It holds
// no coordinates, names of places or account details.
export function segmentMatchReport(trip,trips){
 const library=riddenTrips(trips);
 if(!Array.isArray(trip?.points))return [];
 const gaps=trip.points.slice(1).map((p,i)=>p.timestamp-trip.points[i].timestamp).sort((a,b)=>a-b);
 const lines=[`Segment matching v${SEGMENT_MATCHER_VERSION}: ${trip.points.length} fixes, median ${gaps[Math.floor(gaps.length/2)]??'?'} s apart, ${gaps.filter(g=>g<=0).length} repeated timestamps`];
 for(const {segment,owner,definition} of allSegments(library)){
  const result=definition?matchEfforts(definition,trip):null;
  const reasons={};
  for(const reject of result?.rejects||[])reasons[reject.reason]=(reasons[reject.reason]||0)+1;
  lines.push(`${segment.name}${owner.id===trip.id?' (made here)':''}: ${definition?`${Math.round(definition.lengthMeters)} m, ${result.efforts.length} passes (${result.efforts.filter(effort=>effort.gapSeconds>0).length} with a recording break), rejected ${JSON.stringify(reasons)}`:'no definition'}`);
 }
 return lines;
}
