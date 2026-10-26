import { Capacitor, registerPlugin } from '@capacitor/core';
import { displaySegments } from './mapGeometry.js';
const native=registerPlugin('AppleMaps');
export const appleMapsAvailable=()=>Capacitor.getPlatform()==='ios';
const valid=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180;
export function mapPayload(journeys=[],currentPosition=null,homePresence=null,livePeople=[]){
 const routes=[],pins=[];
 journeys.slice(0,50).forEach(j=>{
  const segments=displaySegments(j).map(s=>s.filter(valid)).filter(s=>s.length);
  routes.push(...segments);
  const points=segments.flat();
  if(points.length){pins.push({point:points[0],title:'Start',kind:'start'},{point:points.at(-1),title:'Finish',kind:'finish'});}
  (j.photos||[]).filter(p=>valid(p.point)).forEach(p=>pins.push({point:p.point,title:p.caption||'Journey photo',kind:'photo',journeyID:String(j.id),photoID:String(p.id)}));
 });
 if(homePresence&&valid([homePresence.latitude,homePresence.longitude])&&homePresence.count>0)pins.push({point:[homePresence.latitude,homePresence.longitude],title:homePresence.names?.join(', ')||'Family at Home',kind:'home-presence',count:homePresence.count});
 for(const member of livePeople){if(valid([member.latitude,member.longitude]))pins.push({point:[member.latitude,member.longitude],title:`${member.display_name||'Family member'} · ${Number.isFinite(member.speed_kmh)?Math.round(member.speed_kmh)+' km/h':'Recent location'}`,kind:'family-live',speed:member.speed_kmh});}
 if(currentPosition&&valid([currentPosition.latitude,currentPosition.longitude]))pins.push({point:[currentPosition.latitude,currentPosition.longitude],title:'Your current location',kind:'location',radius:Math.max(0,Number(currentPosition.accuracy)||0)});
 return {routes,pins};
}
export const appleMaps={snapshot:options=>native.snapshot(options),open:options=>native.open(options),close:options=>native.close(options)};

export async function setNativeAppearance(theme){if(appleMapsAvailable())await native.setAppearance({theme});}
