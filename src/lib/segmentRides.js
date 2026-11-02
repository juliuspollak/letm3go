import {namedSegments,segmentColor} from './namedSegments.js';
import {matchEfforts,segmentDefinition} from './segmentMatcher.js';

// A segment is a stretch of trail, not one lap of one ride. It is drawn once, on the
// ride it was made on, and from then on every ride through it counts. This works out
// which of them a ride passed, how often, and how each pass compares. Nothing here is
// stored: it is worked out from the recordings, so a deleted ride simply stops counting.
const clock=seconds=>{const s=Math.max(0,Math.round(seconds||0)),h=Math.floor(s/3600),m=Math.floor(s/60)%60,rest=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${rest}`:`${m}:${rest}`;};
const dayText=seconds=>new Date(seconds*1000).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'});
const timeText=seconds=>new Date(seconds*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'});

// Matching is the expensive step and a recording rarely changes, so each pairing of a
// segment and a ride is remembered until either one does.
const remembered=new Map();
const LIMIT=20000;
function effortsOn(definition,version,trip){
 const key=`${definition.id}:${version}:${trip.id}:${trip.updatedAt||0}:${trip.points.length}`;
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
  definition:segmentDefinition({id:segment.id,name:segment.name,trip:owner,start:segment.startIndex,end:segment.endIndex})})));
}

function passesOf({segment,owner,definition},trips){
 const version=`${segment.updatedAt||0}`;
 const passes=[];
 for(const trip of trips){
  for(const effort of definition?effortsOn(definition,version,trip):[])passes.push({trip,startedAt:effort.startTimestamp,elapsedSeconds:effort.elapsedSeconds});
 }
 // A section made across a GPS gap cannot be looked for elsewhere, and a segment always
 // counts on the ride that made it.
 if(!passes.some(pass=>pass.trip.id===owner.id))passes.push({trip:owner,startedAt:segment.startTimestamp,elapsedSeconds:segment.durationSeconds});
 return passes;
}

const MAX_LISTED=200;
export function segmentRides(trip,trips){
 const library=riddenTrips(trips);
 if(!trip?.id||!library.length)return [];
 const rows=[];
 for(const entry of allSegments(library)){
  const passes=passesOf(entry,library).sort((a,b)=>a.elapsedSeconds-b.elapsedSeconds||a.startedAt-b.startedAt);
  const thisRide=passes.filter(pass=>pass.trip.id===trip.id).length;
  if(!thisRide)continue;
  const {segment,owner}=entry;
  rows.push({id:segment.id,ownerID:String(owner.id),owned:owner.id===trip.id,name:segment.name,color:segmentColor(segment.colorIndex),thisRide,total:passes.length,rideCount:new Set(passes.map(pass=>pass.trip.id)).size,best:clock(passes[0].elapsedSeconds),
   passes:passes.slice(0,MAX_LISTED).map((pass,index)=>({id:`${pass.trip.id}:${pass.startedAt}`,activityID:String(pass.trip.id),rank:index+1,time:clock(pass.elapsedSeconds),when:`${dayText(pass.startedAt)} · ${timeText(pass.startedAt)}`,title:pass.trip.title||'Activity',current:pass.trip.id===trip.id}))});
 }
 return rows.sort((a,b)=>a.name.localeCompare(b.name));
}
