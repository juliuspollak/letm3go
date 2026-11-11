import {useDeferredValue,useEffect,useMemo,useState} from 'react';
import {ChevronLeft,ChevronRight,X} from 'lucide-react';
import AppleMap from './AppleMap.jsx';
import PersonAvatar from './PersonAvatar.jsx';
import SharedActivityDetail from './SharedActivityDetail.jsx';
import {usePersonDay} from '../lib/usePersonDay.js';
import {addDays,dayKeyOf} from '../lib/dayWindow.js';
import {linesUntil,positionAt} from '../lib/personDay.js';
import {thinLine} from '../lib/mapContent.js';
import {formatAge} from '../lib/householdLocation.js';

// One person's map: their latest shared location, the day's movement, a numbered
// marker for each activity, and a time slider. The map is the app's only map
// renderer (AppleMap); this screen only chooses what it draws. Everything the slider
// does is computed from data already on the phone.
const browserZone=()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';}catch{return 'UTC';}};
const dateLabel=(key,today)=>{
 if(key===today)return 'Today';
 if(key===addDays(today,-1))return 'Yesterday';
 return new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});
};
const clock=(seconds,timeZone)=>new Date(seconds*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone});

// 'Today' follows the clock: a map left open past midnight moves on to the new day.
function useToday(timeZone){
 const [today,setToday]=useState(()=>dayKeyOf(Date.now()/1000,timeZone));
 useEffect(()=>{
  const timer=setInterval(()=>setToday(dayKeyOf(Date.now()/1000,timeZone)),60000);
  return()=>clearInterval(timer);
 },[timeZone]);
 return today;
}

export default function PersonMap({person,viewer,photos,selfAvatar,unit='km',timeZone=browserZone(),onClose,onPoke,onOpenOwn}){
 const isSelf=person.userId===viewer;
 const today=useToday(timeZone);
 // The day shown follows the clock until the person picks another: left open past midnight
 // on "Today", it moves on to the new today (live trail and latest location included).
 const [picked,setPicked]=useState(null);
 const date=picked??today;
 const [scrub,setScrub]=useState(null);
 const [opened,setOpened]=useState(null);
 const {day,loading,error}=usePersonDay({viewer,owner:person.userId,date,timeZone});
 const isToday=date===today;
 const deferred=useDeferredValue(scrub);
 const position=person.position;
 const payload=useMemo(()=>{
  const scrubbing=deferred!=null;
  const recorded=scrubbing?[...day.untimed,...linesUntil(day,deferred)]:day.recorded;
  // The newest live stretch is its own overlay (replaced as points arrive); earlier
  // stretches of the same drive, separated by GPS gaps, are ordinary lines.
  const live=scrubbing?[]:day.live;
  const routes=[...recorded,...live.slice(0,-1)].map(line=>thinLine(line));
  const pins=day.markers.map(m=>({id:'step:'+m.activityID,kind:'step',point:m.point,title:m.title,label:String(m.n),activityID:m.activityID}));
  if(!isSelf&&isToday&&position&&Number.isFinite(position.latitude))pins.push({id:'latest:'+person.userId,kind:'friend-live',point:[position.latitude,position.longitude],title:`${person.name||'Member'} · ${person.status?.text||'Latest location'}`});
  const at=scrubbing?positionAt(day,deferred):null;
  if(at)pins.push({id:'playback',kind:'playback',point:at.point,title:at.inGap?`No GPS signal · last fix ${formatAge(Math.round(at.ageSeconds))} earlier`:`Recorded at ${clock(at.t,timeZone)}`});
  // fitKey: the camera is brought to a new day once; points, the live trail and the slider never refit it.
  return {routes,gaps:[],estimated:scrubbing?[]:[...day.estimated,...day.liveRoads].map(line=>thinLine(line,2000)),live:live.length?thinLine(live.at(-1)):[],pins,fitKey:`${person.userId}|${date}`};
 },[day,deferred,isToday,isSelf,position,person.userId,person.name,person.status?.text,timeZone,date]);
 const first=day.samples[0]?.t,last=day.samples.at(-1)?.t;
 const canScrub=day.samples.length>1;
 const at=scrub!=null?positionAt(day,scrub):null;
 // My own map lists everything I recorded, shared or not, so a marker opens my own
 // activity; anyone else's opens the shared copy I am allowed to see.
 const openMarker=id=>{if(isSelf&&onOpenOwn&&onOpenOwn(id))return;setOpened(id);};
 if(opened)return <SharedActivityDetail activityID={opened} ownerName={person.name} ownerID={person.userId} unit={unit} onBack={()=>setOpened(null)}/>;
 return <section className="person-map" aria-label={`${person.name||'Member'}’s map`}>
  <header className="person-map-head">
   <PersonAvatar name={person.name} userId={person.userId} selfId={viewer} photos={photos} selfAvatar={selfAvatar} size="md"/>
   <div className="person-map-who"><strong>{person.name||'Member'}</strong><span>{person.status?.text||'No location shared'}</span></div>
   {!isSelf&&<button type="button" className="secondary person-map-poke" onClick={onPoke}>👋 Poke</button>}
   <button type="button" className="icon-button" aria-label="Close map" onClick={onClose}><X size={20}/></button>
  </header>
  <div className="person-map-days" role="group" aria-label="Day">
   <button type="button" aria-label="Previous day" onClick={()=>{setPicked(addDays(date,-1));setScrub(null);}}><ChevronLeft size={20}/></button>
   <strong>{dateLabel(date,today)}</strong>
   <button type="button" aria-label="Next day" disabled={isToday} onClick={()=>{const next=addDays(date,1);setPicked(next>=today?null:next);setScrub(null);}}><ChevronRight size={20}/></button>
  </div>
  <div className="person-map-canvas">
   <AppleMap payload={payload} large dynamic viewportKey={person.userId} onStep={openMarker}/>
   {loading&&<p className="person-map-note" role="status">Loading…</p>}
   {!loading&&day.isEmpty&&!error&&<p className="person-map-note" role="status">{isToday?'No movement shared yet today.':'Nothing shared for this day.'}</p>}
   {error&&<p className="person-map-note" role="alert">{error}</p>}
  </div>
  {canScrub&&<div className="person-map-timeline">
   <input type="range" aria-label="Time of day" min={first} max={last} step={30} value={scrub??last} onChange={event=>setScrub(Number(event.target.value))}/>
   <div className="person-map-time"><span>{scrub==null?(isToday?'Now':'End of day'):clock(scrub,timeZone)}</span>
    {at&&<span>{at.inGap?'No GPS signal · last recorded fix shown':'Recorded position'}</span>}
    {scrub!=null&&<button type="button" className="text-button" onClick={()=>setScrub(null)}>{isToday?'Back to now':'Show whole day'}</button>}</div>
  </div>}
  <p className="person-map-legend">Solid lines are recorded GPS. Orange lines are estimated roads where GPS was missing.</p>
 </section>;
}
