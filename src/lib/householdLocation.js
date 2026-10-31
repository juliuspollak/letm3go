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
export function memberActivities(presence=[],members=[]){
 const shared=Object.fromEntries(presence.filter(p=>p.user_id&&p.activity_label).map(p=>[p.user_id,p.activity_label]));
 for(const member of members){
  if(!member.activity)continue;
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
export function memberLocationState(row,nowMs=Date.now()){
 if(!row?.sharing_enabled)return {state:'off',ageSeconds:null,position:null};
 const at=row.location_at?Date.parse(row.location_at):NaN;
 const reference=row.server_now?Date.parse(row.server_now):nowMs;
 const ageSeconds=Number.isFinite(at)?Math.max(0,Math.round(((Number.isFinite(reference)?reference:nowMs)-at)/1000)):null;
 const position=validPoint(row.latitude,row.longitude)?{latitude:row.latitude,longitude:row.longitude,accuracy:finite(row.accuracy_m)?row.accuracy_m:null}:null;
 if(!position)return {state:ageSeconds==null?'waiting':'unavailable',ageSeconds,position:null};
 return {state:ageSeconds!=null&&ageSeconds<=LIVE_SECONDS?'live':'stale',ageSeconds,position};
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
export function homeRadius(home){return Math.max(50,Math.min(2000,Number(home?.radius)||150));}
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
export function peoplePins({self=null,members=[],photos={},selfId=null,selfAvatar=null,places=[],activities={}}){
 const people=[];
 if(self&&validPoint(self.latitude,self.longitude))people.push({...self,id:'self',isSelf:true,state:'live',seconds:self.seconds??null,activity:self.activity??null});
 for(const member of members)if(member.position&&['live','stale'].includes(member.state))
  people.push({id:member.user_id,userId:member.user_id,name:personName(member),named:Boolean(member.display_name?.trim()),latitude:member.position.latitude,longitude:member.position.longitude,
   accuracy:member.position.accuracy,state:member.state,ageSeconds:member.ageSeconds,home:member.home&&member.state==='live',source:member.source||'household',
   seconds:secondsAtPlace(member),activity:activities[member.user_id]??null});
 for(const p of people){
  const place=p.home||p.state!=='live'?null:savedPlaceName(p,places);
  p.label=personLabel({state:p.state,ageSeconds:p.isSelf?null:p.ageSeconds,home:p.home,place,seconds:p.seconds});
  p.movement=personActivity({state:p.state,home:p.home,seconds:p.seconds,shared:p.activity});
 }
 const fit=cameraFit(people);
 return groupPeople(people).map(({anchor,members:group})=>{
  const everyoneHome=group.every(p=>p.home);
  const names=group.map(p=>p.isSelf?'You':p.name);
  const self=group.find(p=>p.isSelf);
  // One person: their own label. Several: "Home" when everyone there is at Home;
  // each person's own time is in the callout.
  const label=group.length===1?group[0].label:everyoneHome?{short:'Home',kind:'home'}:{short:null,kind:'none'};
  const status=p=>p.isSelf?(p.label.kind==='live'?'your location':p.label.text):
   p.state==='live'&&p.label.kind!=='live'?`${p.label.text} · ${locationStatusText(p).replace('Sharing location · ','')}`:locationStatusText(p);
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
