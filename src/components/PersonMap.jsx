import {useCallback,useDeferredValue,useEffect,useMemo,useState} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import PersonAvatar from './PersonAvatar.jsx';
import {usePersonDay} from '../lib/usePersonDay.js';
import {addDays,dayKeyOf} from '../lib/dayWindow.js';
import {linesUntil,positionAt} from '../lib/personDay.js';
import {thinLine} from '../lib/mapContent.js';
import {formatAge} from '../lib/householdLocation.js';

// The Map tab's person view: the selected person's latest shared location, the day's
// movement, a numbered marker for each activity, and a time slider. There is no second
// map: `renderMap` receives what to draw ({payload,onStep}, or null for All people) and
// the Map tab renders its one map there, so selecting a person, changing day or scrubbing
// updates that native map in place. Everything the slider does is computed from data
// already on the phone.
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

export default function PersonMap({person,viewer,photos,selfAvatar,timeZone=browserZone(),poke=null,onPoke,onOpenOwn,onOpenShared,renderMap,localTrips=null,localLiveTrip=null,deletedIDs}){
 const owner=person?.userId||'';
 const isSelf=owner===viewer;
 const today=useToday(timeZone);
 // The day shown follows the clock until the person picks another: left open past midnight
 // on "Today", it moves on to the new today (live trail and latest location included).
 // Choice of day, slider and note belong to one person: another person starts at Today with the slider released.
 const [view,setView]=useState({owner:'',picked:null,scrub:null,notice:''});
 const mine=view.owner===owner?view:{owner,picked:null,scrub:null,notice:''};
 const update=useCallback(patch=>setView(previous=>({...(previous.owner===owner?previous:{owner,picked:null,scrub:null,notice:''}),...patch})),[owner]);
 const picked=mine.picked,scrub=mine.scrub,notice=mine.notice;
 const date=picked??today;
 const setScrub=value=>update({scrub:value}),setNotice=value=>update({notice:value});
 const {day,loading,error}=usePersonDay({viewer,owner,date,timeZone,enabled:Boolean(person),localTrips:isSelf?localTrips:null,localLiveTrip:isSelf?localLiveTrip:null,deletedIDs});
 const isToday=date===today;
 const deferred=useDeferredValue(scrub);
 const position=person?.position;
 const payload=useMemo(()=>{
  if(!owner)return null;
  const scrubbing=deferred!=null;
  const recorded=scrubbing?[...day.untimed,...linesUntil(day,deferred)]:day.recorded;
  // The newest live stretch is its own overlay (replaced as points arrive); earlier
  // stretches of the same drive, separated by GPS gaps, are ordinary lines.
  const live=scrubbing?[]:day.live;
  const routes=[...recorded,...live.slice(0,-1)].map(line=>thinLine(line));
  const pins=day.markers.map(m=>({id:'step:'+m.activityID,kind:'step',point:m.point,title:m.title,label:String(m.n),activityID:m.activityID}));
  if(!isSelf&&isToday&&position&&Number.isFinite(position.latitude))pins.push({id:'latest:'+owner,kind:'friend-live',point:[position.latitude,position.longitude],title:`${person?.name||'Member'} · ${person?.status?.text||'Latest location'}`});
  const at=scrubbing?positionAt(day,deferred):null;
  if(at)pins.push({id:'playback',kind:'playback',point:at.point,title:at.inGap?`No GPS signal · last fix ${formatAge(Math.round(at.ageSeconds))}`:`Recorded at ${clock(at.t,timeZone)}`});
  // fitKey: the camera is brought to a new day once; points, the live trail and the slider never refit it.
  return {routes,gaps:[],estimated:scrubbing?[]:[...day.estimated,...day.liveRoads].map(line=>thinLine(line,2000)),live:live.length?thinLine(live.at(-1)):[],pins,fitKey:`${owner}|${date}`};
 },[day,deferred,isToday,isSelf,position,owner,person?.name,person?.status?.text,timeZone,date]);
 const first=day.samples[0]?.t,last=day.samples.at(-1)?.t;
 const canScrub=day.samples.length>1;
 const at=scrub!=null?positionAt(day,scrub):null;
 // My own map lists everything I recorded, shared or not, so a marker opens my own
 // activity; anyone else's opens the shared copy I am allowed to see.
 const name=person?.name;
 const onStep=useCallback(id=>{
  if(isSelf){
   // My own activity: opened from this phone's copy. One that is only in the cloud (another
   // phone, a watch) is not a shared copy, so the shared viewer would fail; say so instead.
   if(onOpenOwn&&onOpenOwn(id))return;
   update({notice:'That activity is not on this phone. Open it from Activities once it has synced.'});return;
  }
  onOpenShared?.(id,{userId:owner,name});
 },[isSelf,owner,name,onOpenOwn,onOpenShared,update]);
 const personDay=useMemo(()=>payload?{payload,onStep}:null,[payload,onStep]);
 const shown=person?.self||isSelf?'You':person?.name||'Member';
 // Slots are fixed so the map keeps its place in the tree (and is never re-created) whether
 // a person is selected or not.
 return <>
  {person?<header className="person-map-head" aria-label={`${shown}’s map`}>
   <PersonAvatar name={person.name} userId={person.userId} selfId={viewer} photos={photos} selfAvatar={selfAvatar} size="md"/>
   <div className="person-map-who"><strong>{shown}</strong><span>{poke?(poke.state==='sent'?'Poked ✓':poke.message||'Couldn’t poke'):person.status?.text||'No location shared'}</span></div>
   {!isSelf&&onPoke&&<button type="button" className="person-map-poke text-button" aria-label={`Poke ${shown}`} onClick={onPoke}>Poke</button>}
  </header>:null}
  {person?<div className="person-map-days" role="group" aria-label="Day">
   <button type="button" aria-label="Previous day" onClick={()=>{update({picked:addDays(date,-1),scrub:null});}}><ChevronLeft size={20}/></button>
   <strong>{dateLabel(date,today)}</strong>
   <button type="button" aria-label="Next day" disabled={isToday} onClick={()=>{const next=addDays(date,1);update({picked:next>=today?null:next,scrub:null});}}><ChevronRight size={20}/></button>
  </div>:null}
  <div className={person?'person-map-canvas':'map-canvas'}>
   {renderMap(personDay)}
   {person&&loading&&<p className="person-map-note" role="status">Loading…</p>}
   {person&&!loading&&day.isEmpty&&!error&&<p className="person-map-note" role="status">{isToday?'No movement shared yet today.':'Nothing shared for this day.'}</p>}
   {person&&error&&<p className="person-map-note" role="alert">{error}</p>}
   {person&&notice&&<p className="person-map-note" role="status" onClick={()=>setNotice('')}>{notice}</p>}
  </div>
  {person&&canScrub?<div className="person-map-timeline">
   <input type="range" aria-label="Time of day" min={Math.ceil(first)} max={Math.floor(last)} step={1} value={scrub??Math.floor(last)} onChange={event=>setScrub(Number(event.target.value))}/>
   <div className="person-map-time"><span>{scrub==null?(isToday?'Now':'End of day'):clock(scrub,timeZone)}</span>
    {at&&<span>{at.inGap?'No GPS signal · last recorded fix shown':'Recorded position'}</span>}
    {scrub!=null&&<button type="button" className="text-button" onClick={()=>setScrub(null)}>{isToday?'Back to now':'Show whole day'}</button>}</div>
  </div>:null}
  {person?<p className="person-map-legend">Solid lines are recorded GPS. Orange lines are estimated roads where GPS was missing.</p>:null}
 </>;
}
