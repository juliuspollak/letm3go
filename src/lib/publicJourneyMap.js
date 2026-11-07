// A shared journey must be drawn only from the server-approved snapshot.
// Never fetch an owner's private recording or infer coordinates for an unlocated photo.
const valid = (lat,lon) => Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&!(lat===0&&lon===0);
export function publicJourneyMap(snapshot) {
 if(!snapshot)return null;
 const segments=[];
 let previousSegment=null;
 for(const point of snapshot.points||[]){
  if(!valid(point?.latitude,point?.longitude)){previousSegment=null;continue;}
  if(point.segment!==previousSegment || !segments.length)segments.push([]);
  segments.at(-1).push([point.latitude,point.longitude]);
  previousSegment=point.segment;
 }
 const photos=(snapshot.photos||[]).filter(p=>p?.id && valid(p.latitude,p.longitude)).map(p=>({
  id:String(p.id),caption:p.caption||'',point:[p.latitude,p.longitude]
 }));
 return {id:'published-journey',routeSegments:segments,route:segments.flat(),photos};
}
