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
  people.push({id:member.user_id,userId:member.user_id,name:member.display_name||'Member',position:usable(member.position)?member.position:null,state:member.state,
   status:{text:away&&!home&&!verifiedHome?`${status.text} · ${away}`:status.text,tone:home?'home':status.tone}});
 }
 return people.sort((a,b)=>(ORDER[a.state]??2)-(ORDER[b.state]??2)||a.name.localeCompare(b.name));
}
