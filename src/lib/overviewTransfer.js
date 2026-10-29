// Journeys as the overview worker needs them: the display route packed into one
// transferable Float64Array (NaN marks a segment break or an invalid sample,
// which the density never bridges), plus the few fields the photo card shows.
// The route signature is computed here, on the original arrays, so the worker
// and this side agree on the overview key.
import {displaySegments} from './mapGeometry.js';
import {routeSignature} from './routeDensity.js';

const number=value=>typeof value==='number'?value:NaN;
export function packJourneys(journeys){
 const meta=[];let length=0;
 const routes=journeys.map(journey=>{const segments=displaySegments(journey,1500);length+=segments.reduce((n,s)=>n+2*(s.length+1),0);return segments;});
 const coordinates=new Float64Array(length);
 let offset=0;
 journeys.forEach((journey,index)=>{
  const start=offset;
  for(const segment of routes[index]){
   for(const point of Array.isArray(segment)?segment:[]){
    coordinates[offset++]=Array.isArray(point)?number(point[0]):NaN;
    coordinates[offset++]=Array.isArray(point)?number(point[1]):NaN;
   }
   coordinates[offset++]=NaN;coordinates[offset++]=NaN;
  }
  meta.push({id:journey.id,startedAt:journey.startedAt,date:journey.date,title:journey.title,activity:journey.activity,distance:journey.distance,distanceMeters:journey.distanceMeters,
   signature:routeSignature(journey),start,end:offset,photos:(journey.photos||[]).map(p=>({id:p.id,point:p.point,caption:p.caption}))});
 });
 return {meta,coordinates};
}
export function unpackJourneys({meta,coordinates}){
 return meta.map(({start,end,...journey})=>{
  const segments=[];let segment=[];
  for(let i=start;i<end;i+=2){
   if(Number.isNaN(coordinates[i])&&Number.isNaN(coordinates[i+1])){if(segment.length)segments.push(segment);segment=[];}
   else segment.push([coordinates[i],coordinates[i+1]]);
  }
  if(segment.length)segments.push(segment);
  return {...journey,routeSegments:segments};
 });
}
