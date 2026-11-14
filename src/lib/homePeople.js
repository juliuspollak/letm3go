import {metersBetween} from './activityPrivacy.js';
import {distanceText} from './distanceUnits.js';
import {personStatus} from './personStatus.js';
import {atHome} from './householdLocation.js';

// Everyone on the Home screen: household and friends, one person once, with the same
// words as Social. Distance is a straight line between two known positions, so it is
// only shown when both are known, and never for a person with no position.
const ORDER={live:0,stale:1};
const usable=position=>Number.isFinite(position?.latitude)&&Number.isFinite(position?.longitude);

export function distanceAway(from,to,unit='km'){
 if(!usable(from)||!usable(to))return null;
 const metres=metersBetween(from,to);
 return unit==='km'&&metres<1000?`${Math.round(metres/10)*10} m away`:`${distanceText(metres/1000,unit)} away`;
}

// The short form of distanceAway for the compact tile: "2.6 km", "120 m".
export function distanceShort(from,to,unit='km'){
 const text=distanceAway(from,to,unit);
 return text?text.replace(/ away$/,''):null;
}
// "just now", "8m ago", "2h ago", "3d ago".
export function shortAge(seconds){
 if(seconds==null||!Number.isFinite(seconds))return '';
 if(seconds<60)return 'just now';
 const minutes=Math.round(seconds/60);
 if(minutes<60)return `${minutes}m ago`;
 const hours=Math.round(minutes/60);
 return hours<24?`${hours}h ago`:`${Math.round(hours/24)}d ago`;
}
const MOVING=['Driving','Walking','Running','Cycling'];
// One short line for the Home tile (the full status stays on `status`, for the screen reader and
// the detailed screens). An old position carries its age and is never worded as current.
export function compactStatus({state,ageSeconds,home,verifiedHome,placeName,activity,distance}){
 const age=shortAge(ageSeconds);
 if(state==='live'||state==='stale'){
  if(verifiedHome)return age?`Last at home · ${age}`:'Last at home';
  if(placeName)return state==='stale'&&age?`At ${placeName} · ${age}`:`At ${placeName}`;
  if(home&&state==='live')return 'At home';
  if(state==='live'&&MOVING.includes(activity))return distance?`${activity} · ${distance}`:activity;
  const parts=[distance,age].filter(Boolean);
  if(parts.length)return parts.join(' · ');
  return state==='live'?'Sharing':'Last seen';
 }
 if(state==='waiting')return 'Waiting';
 if(state==='off')return 'Not sharing';
 return 'No recent location';
}

export function homePeople({household=[],friends=[],selfID,selfPosition=null,homeFlags={},homePlace=null,activities={},unit='km'}){
 const seen=new Set([selfID]);
 const people=[];
 for(const member of [...household,...friends]){
  if(seen.has(member.user_id))continue;
  seen.add(member.user_id);
  const home=homeFlags[member.user_id]===true;
  // Home is shared by the household only; a friend's old position is never placed there.
  const verifiedHome=member.source==='household'&&member.state==='stale'&&atHome(false,member.position,homePlace);
  const status=personStatus({state:member.state,ageSeconds:member.ageSeconds,home,activity:activities[member.user_id],verifiedHome,placeName:member.place_name,placeSince:member.place_since});
  const away=member.state==='live'||member.state==='stale'?distanceAway(selfPosition,member.position,unit):null;
  const live=member.state==='live'||member.state==='stale';
  people.push({id:member.user_id,userId:member.user_id,name:member.display_name||'Member',position:usable(member.position)?member.position:null,state:member.state,
   group:member.source==='household'?'household':'friend',
   short:compactStatus({state:member.state,ageSeconds:member.ageSeconds,home,verifiedHome,placeName:member.place_name,activity:activities[member.user_id],distance:live&&!home&&!verifiedHome?distanceShort(selfPosition,member.position,unit):null}),
   ageText:live?shortAge(member.ageSeconds):'',
   // The tile shows the house icon (as on the Map) instead of the word Home; `homeAge` is what follows it.
   atHomeLine:verifiedHome||(home&&member.state==='live')?{age:verifiedHome?shortAge(member.ageSeconds):''}:null,
   status:{text:away&&!home&&!verifiedHome?`${status.text} · ${away}`:status.text,tone:home?'home':status.tone}});
 }
 return people.sort((a,b)=>(ORDER[a.state]??2)-(ORDER[b.state]??2)||a.name.localeCompare(b.name));
}
