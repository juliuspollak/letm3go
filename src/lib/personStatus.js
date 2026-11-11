// The short status under each person in Friends and Household, from the same
// location states as the map (householdLocation.memberLocationState). One word
// set for both screens, so a person never reads differently in one of them.
//
// tone: live (green dot), stale (clock), off (sharing turned off), none (no
// position known), issue (the signed-in user's location access needs fixing).
import {formatAge} from './householdLocation.js';

const PLACE_FRESH_SECONDS=90*60;
const AGE=seconds=>seconds!=null&&seconds<60?'just now':formatAge(seconds);
// Shared coarse statuses that are worth showing in place of "Sharing".
const MOVING=['Driving','Walking','Running','Cycling'];

// `verifiedHome`: an old position that was inside Home. It says where the person
// was last verified, with its real age; it never claims they are there now.
// "since 8:46", or with the day when it began before today.
export function sinceText(since,now=new Date()){
 const date=new Date(since);
 if(Number.isNaN(date.getTime()))return '';
 const time=date.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'});
 return date.toDateString()===now.toDateString()?`since ${time}`:`since ${date.toLocaleDateString('en-AU',{weekday:'short'})} ${time}`;
}

// `placeName`: the owner's own name for a saved place they chose to show friends
// while the phone rests there. A resting phone sends nothing and iOS wakes a
// closed app only for movement, so a named place stays true until they move.
export function personStatus({state,ageSeconds=null,home=false,activity=null,verifiedHome=false,placeName=null,placeSince=null}){
 if(placeName&&(state==='live'||state==='stale')){
  const since=placeSince?sinceText(placeSince):'';
  const base=since?`At ${placeName} · ${since}`:`At ${placeName}`;
  // The place stays true while the phone is quiet, but a long silence is shown:
  // the phone may be off, so the age is never hidden.
  if(ageSeconds!=null&&ageSeconds>PLACE_FRESH_SECONDS)return {text:`${base} · seen ${formatAge(ageSeconds)}`,tone:'stale'};
  return {text:base,tone:'live'};
 }
 switch(state){
  case 'live':
   if(home)return {text:'At home',tone:'live'};
   return {text:`${MOVING.includes(activity)?activity:'Sharing'} · ${AGE(ageSeconds)}`,tone:'live'};
  // An old position is never presented as current, and never as "sharing off":
  // the person may simply be out of signal.
  case 'stale':return {text:verifiedHome?`Last verified at home · ${formatAge(ageSeconds)}`:`Last seen ${formatAge(ageSeconds)}`,tone:'stale'};
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
