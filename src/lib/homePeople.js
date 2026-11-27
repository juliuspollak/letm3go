import {metersBetween} from './activityPrivacy.js';
import {distanceText} from './distanceUnits.js';
import {personStatus} from './personStatus.js';
import {formatDuration,matchVisibleSavedPlace,secondsAtPlace} from './peopleMap.js';
import {atHome,lastKnownActivity} from './householdLocation.js';

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
// Whether the Friends row is still waiting for its first answer. An empty list means "nobody is sharing" only once
// both lists have answered; a failure, being offline or a long wait ends the loading state, so it never spins for ever.
export function friendsStillLoading({configured=true,householdReady,friendsReady,householdError='',friendsError='',waitOver=false,online=true}){
 return Boolean(configured)&&!(householdReady&&friendsReady)&&!householdError&&!friendsError&&!waitOver&&online!==false;
}

// Fallback text in the Map person selector.
export function compactStatus({state,ageSeconds,home,verifiedHome,placeName,activity,distance}){
 const age=shortAge(ageSeconds);
 if(state==='live'||state==='stale'){
  if(verifiedHome)return age?`Last at home · ${age}`:'Last at home';
  if(placeName)return state==='stale'&&age?`Last at ${placeName} · ${age}`:`At ${placeName}`;
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

export function homePeople({household=[],friends=[],selfID,selfPosition=null,homeFlags={},homePlace=null,places=[],activities={},unit='km'}){
 const seen=new Set([selfID]);
 const people=[];
 for(const member of [...household,...friends]){
  if(seen.has(member.user_id))continue;
  seen.add(member.user_id);
  const home=member.state==='live'&&homeFlags[member.user_id]===true;
  // Home is shared by the household only; a friend's old position is never placed there.
  const verifiedHome=member.source==='household'&&member.state==='stale'&&atHome(false,member.position,homePlace);
  const savedPlace=home?null:matchVisibleSavedPlace(member.state,member.position,places);
  const placeName=savedPlace?.name||member.place_name;
  const location={savedPlace,speedKmh:member.ageSeconds<=30&&member.ageSeconds!=null?member.speed_kmh:null,state:member.state,ageSeconds:member.ageSeconds,home,homeSeconds:home||verifiedHome?secondsAtPlace(member,{allowStale:verifiedHome}):null,activity:activities[member.user_id],lastKnownActivity:activities[member.user_id]?null:lastKnownActivity(member),verifiedHome,placeName,placeSince:member.place_since};
  const status=personStatus(location);
  const away=member.state==='live'||member.state==='stale'?distanceAway(selfPosition,member.position,unit):null;
  const live=member.state==='live'||member.state==='stale';
  people.push({id:member.user_id,userId:member.user_id,name:member.display_name||'Member',position:usable(member.position)?member.position:null,state:member.state,
   locationAt:live&&usable(member.position)&&member.ageSeconds!=null?Date.parse(member.location_at):null,
   group:member.source==='household'?'household':'friend',
   short:compactStatus({state:member.state,ageSeconds:member.ageSeconds,home,verifiedHome,placeName,activity:activities[member.user_id],distance:live&&!home&&!verifiedHome?distanceShort(selfPosition,member.position,unit):null}),
   ageText:live?shortAge(member.ageSeconds):'',
   distance:home||verifiedHome?null:away,
   location,
   status:{text:away&&!home&&!verifiedHome?`${status.text} · ${away}`:status.text,tone:home?'home':status.tone}});
 }
 return people.sort((a,b)=>(ORDER[a.state]??2)-(ORDER[b.state]??2)||a.name.localeCompare(b.name));
}

// Shared by every people tile. Map status can include distance and place-since
// information, while the tile labels the age of the position used for routes.
export function personTileLocation(location){
 const {state,ageSeconds,home,verifiedHome,placeName,activity,lastKnownActivity}=location;
 const age=shortAge(ageSeconds).replace(/(\d+)([mhd]) ago$/,(_,amount,unit)=>`${amount} ${unit==='m'?'min':unit} ago`);
 if((state==='live'&&home)||verifiedHome){
  const duration=location.homeSeconds>=60?formatDuration(location.homeSeconds).replace(/(\d+)m$/, '$1 min'):'';
  const text=duration?`Since ${duration} ago`:location.homeSeconds!=null?'Since just now':age?`Seen ${age}`:verifiedHome?'Last seen at home':'At home';
  return {text,tone:'home',lastKnown:verifiedHome===true};
 }
 const status=personStatus(location);
 if(state!=='live'&&state!=='stale')return status;
 const detail=placeName?(state==='stale'?`Last at ${placeName}`:`At ${placeName}`):state==='live'&&MOVING.includes(activity)?activity:lastKnownActivity?`Last activity: ${lastKnownActivity}`:null;
 const time=state==='stale'?`Last location${age?` · ${age}`:''}`:age?`Location updated ${age}`:'Sharing location';
 return {text:[detail,time].filter(Boolean).join(' · '),tone:status.tone};
}
