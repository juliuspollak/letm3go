import { Capacitor, registerPlugin } from '@capacitor/core';
import { displaySegments } from './mapGeometry.js';
const native=registerPlugin('AppleMaps');
export const appleMapsAvailable=()=>Capacitor.getPlatform()==='ios';
const valid=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180;
// Straight-line connector distance in metres, used only to decide whether two
// consecutive observed segments are close enough to be one interrupted stretch.
function gapMetres(a,b){const r=Math.PI/180,dlat=(b[0]-a[0])*r,dlon=(b[1]-a[1])*r,x=Math.sin(dlat/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dlon/2)**2;return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));}
// `peoplePins` (from householdLocation.peoplePins) carry avatars, freshness, Home
// and same-place grouping for the signed-in user, household and friends.
export function mapPayload(journeys=[],currentPosition=null,homePresence=null,livePeople=[],peoplePins=[]){
 const routes=[],pins=[],gaps=[];
 journeys.slice(0,50).forEach(j=>{
  const segments=displaySegments(j).map(s=>s.filter(valid)).filter(s=>s.length);
  routes.push(...segments);
  // A dashed connector marks missing GPS coverage between two observed segments.
  // It is a straight-line uncertainty marker, never a travelled road, and it is
  // only drawn when the segments are near enough (<= 1 km) to plausibly be one
  // interrupted stretch. Large gaps are left unjoined so a direct-looking line is
  // never drawn where the route is genuinely unknown.
  for(let i=1;i<segments.length;i++){
   const from=segments[i-1].at(-1),to=segments[i][0];
   if(from&&to&&gapMetres(from,to)<=1000)gaps.push([from,to]);
  }
  const points=segments.flat();
  if(points.length){pins.push({point:points[0],title:'Start',kind:'start'},{point:points.at(-1),title:'Finish',kind:'finish'});}
  (j.photos||[]).filter(p=>valid(p.point)).forEach(p=>pins.push({point:p.point,title:p.caption||'Journey photo',kind:'photo',journeyID:String(j.id),photoID:String(p.id)}));
 });
 if(homePresence&&valid([homePresence.latitude,homePresence.longitude])&&homePresence.count>0)pins.push({point:[homePresence.latitude,homePresence.longitude],title:homePresence.names?.join(', ')||'Family at Home',kind:'home-presence',count:homePresence.count});
 for(const member of livePeople){if(valid([member.latitude,member.longitude]))pins.push({point:[member.latitude,member.longitude],title:`${member.display_name||'Family member'} · ${member.source==='friend'&&member.updated_at?'Last seen '+new Date(member.updated_at).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'}):Number.isFinite(member.speed_kmh)?Math.round(member.speed_kmh)+' km/h':'Recent location'}`,kind:member.source==='friend'?'friend-live':'family-live',speed:member.speed_kmh});}
 if(currentPosition&&valid([currentPosition.latitude,currentPosition.longitude]))pins.push({point:[currentPosition.latitude,currentPosition.longitude],title:'Your current location',kind:'location',radius:Math.max(0,Number(currentPosition.accuracy)||0)});
 for(const pin of peoplePins)if(pin?.kind==='people'&&valid(pin.point)&&Array.isArray(pin.members)&&pin.members.length)pins.push(pin);
 return {routes,pins,gaps};
}
export const appleMaps={snapshot:options=>native.snapshot(options),open:options=>native.open(options),close:options=>native.close(options),embed:options=>native.embed(options),unembed:options=>native.unembed(options),addListener:(event,callback)=>native.addListener(event,callback)};

export async function setNativeAppearance(theme){if(appleMapsAvailable())await native.setAppearance({theme});}
