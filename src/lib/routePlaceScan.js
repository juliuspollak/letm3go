import {recognitionSampleIndexes,assessRoutePlaces} from './journeyRecognition.js';
import {rankPlaceCandidates} from './placeTagPolicy.js';
import {recorder} from './recorder.js';
import {placeKey} from './journeyGrouping.js';
import {recognisedStopVenue} from './stopVenueRecognition.js';

// Looks up named places along a route for the person to review. Shared by the
// React tags section and the native Activity Details screen. `signal` stops a
// scan between lookups when the screen it was started from has gone.
export async function scanRoutePlaces(trip,{hidden=[],places={},onProgress,signal}={}){
 const segments=trip.segments?.length?trip.segments:[trip];
 const samples=[];
 for(const segment of segments){
  const points=Array.isArray(segment.points)&&segment.points.length?segment.points:
   (segment.routeSegments||[]).flat().map(p=>Array.isArray(p)?{latitude:p[0],longitude:p[1]}:p);
  if(!points.length)continue;
  const stops=(trip.recognisedStops||trip.stops||[]).filter(stop=>
   stop.pointIndex!=null&&(!stop.segmentID||stop.segmentID===segment.id));
  for(const index of recognitionSampleIndexes({...segment,activity:trip.activity,points},stops)){
   const point=points[index],stop=stops.find(s=>s.pointIndex===index);
   if(!placeKey(point))continue;
   const previous=samples.find(item=>placeKey(item.point)===placeKey(point));
   if(previous){if(stop&&!previous.stop)previous.stop=stop;continue;}
   samples.push({point,index,stop});
  }
 }
 if(!samples.length)return {suggestions:[],notice:'This activity has no usable GPS route points to search.'};
 const result=[],errors=[];
 const ranked=()=>rankPlaceCandidates(result,{activity:trip.activity,existing:trip.tags||[],hidden}).map(x=>({...x,tag:x.name}));
 for(let n=0;n<samples.length;n++){
  if(signal?.aborted)throw new Error('Place search was cancelled.');
  onProgress?.({notice:`Checking place ${n+1} of ${samples.length}…`});
  const {point,stop}=samples[n],key=placeKey(point);
  let place=places?.[key];
  if(!place?.nearbyName&&!place?.categories?.length){
   try{
    // Pass the actual sampled coordinate. Displayed/trimmed indices are not native indices.
    place=await recorder.recogniseTripPlace(null,0,point,true);
    if(stop)place={...place,stopLookup:true};
   }catch(error){errors.push(error?.message||'Place lookup unavailable');continue;}
  }
  if(stop){
   const venue=recognisedStopVenue(place,point,stop.durationSeconds);
   if(venue&&!result.some(x=>x.name.toLowerCase()===venue.name.toLowerCase()))
    result.push({name:venue.name,tag:venue.name,kind:'stop',source:venue.source});
  }
  const assessed=assessRoutePlaces(trip,[place],{hidden});
  for(const candidate of assessed.candidates){if(!result.some(x=>x.name.toLowerCase()===candidate.name.toLowerCase()))result.push({...candidate,tag:candidate.name,kind:'route',source:place?.source||'Apple Maps'});}
  for(const name of [place?.nearbyName,...(place?.categories||[]),...(place?.nearbyName?[]:[place?.locality])].filter(Boolean)){
   if(typeof name!=='string'||name.length>50||result.some(x=>x.tag.toLowerCase()===name.toLowerCase())||hidden.some(x=>x.toLowerCase()===name.toLowerCase()))continue;
   result.push({tag:name,name,kind:stop?'stop':n===samples.length-1?'destination':n===0?'start':'route',point:n,source:place?.source||'Apple Maps'});
  }
  onProgress?.({notice:`Checking place ${n+1} of ${samples.length}…`,suggestions:ranked()});
 }
 const available=ranked();
 return {suggestions:available,notice:available.length?`Found ${available.length} place suggestions. Review them below.`:errors.length===samples.length?'Place lookup could not run. Check your connection and try again on your iPhone.':errors.length?`No new places found; ${errors.length} lookups failed. Try again with a connection.`:'No additional named places found along this route. You can still add a place name manually.'};
}
