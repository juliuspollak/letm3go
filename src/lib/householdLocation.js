// Household location state, Home presence and same-place grouping. One
// implementation for the Household screen, People on the map and the map pins,
// so a member can never look "live" in one place and missing in another.
import {resolveAvatar} from './avatar.js';
import {cameraFit,personActivity,personLabel,savedPlaceName,secondsAtPlace} from './peopleMap.js';

// Freshness policy (documented in docs/household-location-sharing.md):
// - live:        a position confirmed within the last 10 minutes. A phone
//                publishes every 3-5 s while driving or moving in the foreground,
//                every 10 s on foot in the background, and confirms an
//                unchanged position every 5 minutes while its location service
//                runs, so a present member stays inside this window.
// - stale:       an older position, shown with its age, up to 24 hours.
// - unavailable: sharing is on but the last position is older than 24 hours;
//                the server no longer returns its coordinates.
// - waiting:     sharing is on and no position has been received yet.
// - off:         the member does not share.
export const LIVE_SECONDS=10*60;
// A member's movement status. What their phone published with the position comes from
// native code and works while locked, so it outranks the WebView's household presence.
const NATIVE_ACTIVITY={driving:'Driving',cycling:'Cycling',running:'Running',walking:'Walking'};
// A movement status is only meaningful while its position is fresh. This also
// protects viewers from a car that was left behind by an old app or a phone that
// stopped publishing before it could send an explicit clear.
export const NATIVE_ACTIVITY_TTL_SECONDS=120;
export const LAST_KNOWN_SECONDS=24*60*60;
let foregroundOffset=0;
let hiddenClock=null;
export function freshnessNow(){return performance.now()+foregroundOffset;}
export function freshnessVisibility(hidden,wall=Date.now(),monotonic=performance.now()){
 if(hidden){hiddenClock??={wall,monotonic};return;}
 if(!hiddenClock)return;
 const wallElapsed=wall-hiddenClock.wall,elapsed=Math.max(0,monotonic-hiddenClock.monotonic);
 // Some runtimes stop the monotonic clock during suspension. A backward
 // clock change during that gap makes current status unverifiable.
 if(wallElapsed-elapsed>2000)foregroundOffset+=wallElapsed-elapsed;
 else if(wallElapsed<0)foregroundOffset+=LIVE_SECONDS*1000+1000;
 hiddenClock=null;
}
export function stampPosition(row,receivedAtMs=Date.now(),receivedMonotonicMs=freshnessNow()){
 return {...row,receivedAtMs,receivedMonotonicMs};
}
function captureAge(row,nowMs,monotonicMs){
 const captured=Date.parse(row.location_at);
 const reference=row.server_now?Date.parse(row.server_now):row.receivedAtMs??nowMs;
 if(!Number.isFinite(captured)||!Number.isFinite(reference))return null;
 const elapsed=Number.isFinite(row.receivedMonotonicMs)&&Number.isFinite(monotonicMs)?
  Math.max(0,monotonicMs-row.receivedMonotonicMs):0;
 if(captured>reference+5000)return null;
 return Math.max(0,(reference-captured+elapsed)/1000);
}
export function memberActivities(presence=[],members=[],nowMs=Date.now(),monotonicMs){
 const legacy=new Map(presence.filter(p=>p.user_id&&p.activity_label).map(p=>[p.user_id,p.activity_label]));
 const shared=Object.fromEntries([...legacy].filter(([,label])=>!Object.values(NATIVE_ACTIVITY).includes(label)));
 for(const member of members){
  const age=captureAge(member,nowMs,monotonicMs);
  if(!member.sharing_enabled&&member.sharing_enabled!==undefined){delete shared[member.user_id];continue;}
  if(age==null||age>NATIVE_ACTIVITY_TTL_SECONDS){delete shared[member.user_id];continue;}
  if(member.activity===undefined){
   const label=legacy.get(member.user_id);
   if(label)shared[member.user_id]=label;
   continue;
  }
  if(NATIVE_ACTIVITY[member.activity])shared[member.user_id]=NATIVE_ACTIVITY[member.activity];
  else delete shared[member.user_id];
 }
 return shared;
}

const finite=value=>typeof value==='number'&&Number.isFinite(value);
export function validPoint(latitude,longitude){
 return finite(latitude)&&finite(longitude)&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180&&!(latitude===0&&longitude===0);
}
export function distanceMetres(a,b){
 const r=Math.PI/180,dlat=(b.latitude-a.latitude)*r,dlon=(b.longitude-a.longitude)*r;
 const x=Math.sin(dlat/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(dlon/2)**2;
 return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));
}

// Age is measured against the server clock returned with the rows, so a phone
// with a wrong clock cannot make an old position look live.
export function memberLocationState(row,nowMs=Date.now(),monotonicMs){
 if(!row?.sharing_enabled)return {state:'off',ageSeconds:null,position:null};
 const age=captureAge(row,nowMs,monotonicMs);
 const ageSeconds=age==null?null:Math.floor(age);
 const position=validPoint(row.latitude,row.longitude)?{latitude:row.latitude,longitude:row.longitude,accuracy:finite(row.accuracy_m)?row.accuracy_m:null}:null;
 if(!position||age>LAST_KNOWN_SECONDS)return {state:age==null?'waiting':'unavailable',ageSeconds,position:null};
 return {state:age!=null&&age<=LIVE_SECONDS?'live':'stale',ageSeconds,position};
}
export function lastKnownActivity(row){
 return NATIVE_ACTIVITY[row?.activity]??null;
}

export function formatAge(seconds){
 if(seconds==null)return '';
 if(seconds<60)return 'just now';
 const minutes=Math.round(seconds/60);
 if(minutes<60)return `${minutes} min ago`;
 // Under three hours the minutes matter (90 min must not read as "2 h").
 if(minutes<180)return minutes%60?`${Math.floor(minutes/60)} h ${minutes%60} min ago`:`${minutes/60} h ago`;
 const hours=Math.round(minutes/60);
 return hours<24?`${hours} h ago`:`${Math.round(hours/24)} d ago`;
}
export function locationStatusText({state,ageSeconds}){
 switch(state){
  case 'live':return ageSeconds!=null&&ageSeconds<60?'Sharing location · updated just now':`Sharing location · updated ${formatAge(ageSeconds)}`;
  case 'stale':return `Last updated ${formatAge(ageSeconds)}`;
  case 'unavailable':return 'Location unavailable';
  case 'waiting':return 'Waiting for location';
  default:return 'Location sharing off';
 }
}

// Home uses the existing saved Home place and the same radius bounds as presence.
// Hysteresis stops the tag flickering at the boundary: entering needs the fix
// (and half its uncertainty) inside the radius; leaving needs it clearly outside.
export function homeRadius(home){return Math.max(25,Math.min(2000,Number(home?.radius)||150));}
export function atHome(previous,point,home){
 if(!home||!point||!validPoint(home.latitude,home.longitude)||!validPoint(point.latitude,point.longitude))return false;
 const radius=homeRadius(home),uncertainty=Math.min(100,Math.max(0,Number(point.accuracy)||0))/2;
 const distance=distanceMetres(home,point);
 if(previous)return distance-uncertainty<=radius+Math.max(25,radius*0.2);
 return distance+uncertainty<=radius;
}

// People closer than this are one place on the map: one marker with every
// avatar in it, so nobody is hidden behind someone else.
export const SAME_PLACE_METRES=30;
export function groupPeople(people,metres=SAME_PLACE_METRES){
 const groups=[];
 for(const person of people){
  if(!validPoint(person.latitude,person.longitude))continue;
  const group=groups.find(g=>distanceMetres(g.anchor,person)<=metres);
  if(group)group.members.push(person);
  else groups.push({anchor:{latitude:person.latitude,longitude:person.longitude},members:[person]});
 }
 return groups;
}

// A placeholder label is for text only; it never becomes an avatar initial.
export function personName(member){
 return member.display_name?.trim()||(member.source==='friend'?'Friend':'Household member');
}

// Map pins for people. The signed-in user is drawn first and anchors their own
// group; Home and freshness travel with each person, so a stale position is never
// tagged Home and a shared Home shows everyone who is there.
//
// Each pin has a stable id made of the user ids at that place (never names or
// coordinates), so the native map moves the existing marker instead of replacing
// it. `fit` says whether the camera keeps it in view (see cameraFit), and the
// label says where the person is and for how long, only when that is known.
// `places` are the viewer's own saved places; `activities` the coarse status
// members already share (user id → label).
export function peoplePins({self=null,members=[],photos={},selfId=null,selfAvatar=null,places=[],activities={},nowMs=Date.now()}){
 const people=[];
 if(self&&validPoint(self.latitude,self.longitude))people.push({...self,id:'self',isSelf:true,state:'live',seconds:self.seconds??null,activity:self.activity??null});
 for(const member of members)if(member.position&&['live','stale'].includes(member.state))
  people.push({id:member.user_id,userId:member.user_id,name:personName(member),named:Boolean(member.display_name?.trim()),latitude:member.position.latitude,longitude:member.position.longitude,
   accuracy:member.position.accuracy,state:member.state,ageSeconds:member.ageSeconds,home:member.home&&member.state==='live',source:member.source||'household',
   seconds:secondsAtPlace(member),activity:activities[member.user_id]??null,
   speedKmh:member.speed_kmh,speedAge:member.ageSeconds==null?null:member.ageSeconds+(!Number.isFinite(member.receivedMonotonicMs)&&Number.isFinite(member.receivedAtMs)?Math.max(0,(nowMs-member.receivedAtMs)/1000):0)});
 for(const p of people){
  const place=p.home||p.state!=='live'?null:savedPlaceName(p,places);
  p.label=personLabel({state:p.state,ageSeconds:p.isSelf?null:p.ageSeconds,home:p.home,place,seconds:p.seconds});
  p.movement=personActivity({state:p.state,home:p.home,seconds:p.seconds,shared:p.activity});
  // Location stays visible longer than speed. Advance the server-measured age
  // locally so failed refreshes cannot leave an old speed looking current.
  if(p.state==='live'&&Number.isFinite(p.speedAge)&&p.speedAge>=0&&p.speedAge<=30&&
    Number.isFinite(p.speedKmh)&&p.speedKmh>=0&&p.speedKmh<=250){
   const speed=`${Math.round(p.speedKmh)} km/h`;
   const movement={driving:'Driving',walking:'Walking',running:'Running',cycling:'Cycling'}[p.movement];
   p.label={...p.label,short:movement?`${movement} · ${speed}`:p.label.short?`${p.label.short} · ${speed}`:speed,
    text:`${p.label.text} · ${speed} · speed updated ${Math.floor(p.speedAge)} s ago`};
   p.speedText=`${speed} · speed updated ${Math.floor(p.speedAge)} s ago`;
  }
 }
 const fit=cameraFit(people);
 return groupPeople(people).map(({anchor,members:group})=>{
  const everyoneHome=group.every(p=>p.home);
  const names=group.map(p=>p.isSelf?'You':p.name);
  const self=group.find(p=>p.isSelf);
  // One person: their own label. Several: "Home" when everyone there is at Home;
  // each person's own time is in the callout.
  const label=group.length===1?group[0].label:everyoneHome?{short:'Home',kind:'home'}:{short:null,kind:'none'};
  const locationStatus=p=>p.isSelf?(p.label.kind==='live'?'your location':p.label.text):
   p.state==='live'&&p.label.kind!=='live'?`${p.label.text} · ${locationStatusText(p).replace('Sharing location · ','')}`:locationStatusText(p);
  const status=p=>[locationStatus(p),p.label.kind==='live'?p.speedText:null].filter(Boolean).join(' · ');
  return {
   id:'people:'+group.map(p=>p.id).sort().join(','),
   point:self?[self.latitude,self.longitude]:[anchor.latitude,anchor.longitude],
   kind:'people',
   title:names.length>1?`${names.slice(0,-1).join(', ')} & ${names.at(-1)}`:names[0],
   subtitle:[everyoneHome?'Home':null,...group.map(p=>`${p.isSelf?'You':p.name}: ${status(p)}`)].filter(Boolean).join(' · '),
   home:everyoneHome,
   fit:group.some(p=>fit[p.id]),
   ...(label.short?{label:label.short,labelKind:label.kind}:{}),
   ...(self&&Number.isFinite(self.accuracy)&&self.accuracy>0?{radius:Math.min(self.accuracy,100)}:{}),
   members:group.map(p=>{
    // The photo comes from the same id-keyed set as Household and Friends. Without
    // one, the initial comes only from a real name; a member with no name gets a
    // neutral silhouette (empty initial), never the initial of a placeholder.
    const avatar=resolveAvatar({userId:p.isSelf?selfId:p.userId,selfId,photos,selfAvatar,name:p.isSelf?(p.name||'You'):p.name});
    return {id:p.id,name:p.isSelf?'You':p.name,initial:p.isSelf||p.named?avatar.initial:'',avatar:avatar.src&&avatar.src.startsWith('data:image/')?avatar.src:null,
     self:Boolean(p.isSelf),state:p.isSelf?'live':p.state,home:Boolean(p.home),label:p.label.text,activity:p.movement,
     ...(p.seconds!=null?{secondsAtPlace:p.seconds}:{})};
   })
  };
 });
}
