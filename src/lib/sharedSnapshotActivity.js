// The only source for a recipient's activity is the server-authorised,
// already-redacted publication. No raw activity, device cache or GPS repair.
const safePoint=p=>Number.isFinite(p?.latitude)&&Number.isFinite(p?.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180&&!(p.latitude===0&&p.longitude===0);
export function sharedSnapshotActivity(snapshot,activityID,ownerName='Friend'){
 if(!snapshot||!activityID||!Array.isArray(snapshot.points))throw new Error('Shared activity unavailable.');
 const points=[],routeSegments=[];let lastSegment=null;
 for(const p of snapshot.points){
  if(!safePoint(p)){lastSegment=null;continue;}
  const segment=Number.isInteger(p.segment)?p.segment:null;
  if(!routeSegments.length||lastSegment===null||segment!==lastSegment)routeSegments.push([]);
  routeSegments.at(-1).push([p.latitude,p.longitude]);
  points.push({latitude:p.latitude,longitude:p.longitude,segment});
  lastSegment=segment;
 }
 const begun=Date.parse(snapshot.startedAt||'');
 const finished=Date.parse(snapshot.endedAt||'');
 const startedAt=Number.isFinite(begun)?begun/1000:0;
 const endedAt=Number.isFinite(finished)?finished/1000:startedAt;
 const distanceMeters=Number.isFinite(snapshot.distanceMeters)?Math.max(0,snapshot.distanceMeters):0;
 const durationSeconds=Number.isFinite(snapshot.durationSeconds)?Math.max(0,snapshot.durationSeconds):Math.max(0,endedAt-startedAt);
 const photos=(Array.isArray(snapshot.photos)?snapshot.photos:[]).filter(p=>typeof p?.id==='string').map(p=>({
  id:p.id,caption:typeof p.caption==='string'?p.caption:'',locationSource:safePoint(p)?'gps':'unlocated',
  point:safePoint(p)?[p.latitude,p.longitude]:null
 }));
 return {
  id:'shared:'+activityID,sharedActivityID:activityID,source:'shared',
  readOnly:true,isShared:true,state:'finished',ownerName,title:snapshot.title||'Shared activity',
  activity:snapshot.activity||'Other',description:snapshot.description||'',
  startedAt,endedAt,date:new Date(startedAt*1000).toLocaleDateString('en-CA'),
  durationSeconds,distanceMeters,distance:distanceMeters/1000,minutes:Math.floor(durationSeconds/60),
  points,route:[],routeSegments,photos,tags:[],notes:'',details:{},recordingMode:'shared',location:'',
  // Only the already-redacted snapshot can be rendered. No private source metadata.
  classification:null,recognisedStops:[],sourceRecords:[]
 };
}
