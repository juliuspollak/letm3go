// The short status under each person in Friends and Household, from the same
// location states as the map (householdLocation.memberLocationState). One word
// set for both screens, so a person never reads differently in one of them.
//
// tone: live (green dot), stale (clock), off (sharing turned off), none (no
// position known), issue (the signed-in user's location access needs fixing).
import {formatAge} from './householdLocation.js';

const AGE=seconds=>seconds!=null&&seconds<60?'just now':formatAge(seconds);
// Shared coarse statuses that are worth showing in place of "Sharing".
const MOVING=['Driving','Walking','Running','Cycling'];

export function personStatus({state,ageSeconds=null,home=false,activity=null}){
 switch(state){
  case 'live':
   if(home)return {text:'At home',tone:'live'};
   return {text:`${MOVING.includes(activity)?activity:'Sharing'} · ${AGE(ageSeconds)}`,tone:'live'};
  // An old position is never presented as current, and never as "sharing off":
  // the person may simply be out of signal.
  case 'stale':return {text:`Last seen ${formatAge(ageSeconds)}`,tone:'stale'};
  case 'waiting':return {text:'Waiting for location',tone:'none'};
  case 'off':return {text:'Not sharing',tone:'off'};
  // Sharing state not known to this viewer (a friend with no recent position).
  default:return {text:'No recent location',tone:'none'};
 }
}

// You, from what your audience actually received (confirmed sends), not from
// the switch alone. Home only with a current position.
export function selfStatus({enabled,state=null,ageSeconds=null,home=false,activity=null,permission=null,precise=null}){
 if(!enabled)return {text:'Not sharing',tone:'off'};
 if(permission==='denied'||permission==='restricted'||precise===false)return {text:'Location access needed',tone:'issue'};
 if(state==='live')return home?{text:'At home',tone:'live'}:{text:MOVING.includes(activity)?activity:'Sharing',tone:'live'};
 if(state==='stale')return {text:`Last sent ${formatAge(ageSeconds)}`,tone:'stale'};
 return {text:'Sharing · waiting to send',tone:'none'};
}
