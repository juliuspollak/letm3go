import {useCallback,useDeferredValue,useEffect,useMemo,useRef,useState} from 'react';
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

const fresh=forOwner=>({owner:forOwner,picked:null,scrub:null,notice:'',locate:null});

export default function PersonMap({person,viewer,timeZone=browserZone(),onOpenOwn,onOpenShared,locateSelf=null,renderMap,localTrips=null,localLiveTrip=null,deletedIDs}){
 const owner=person?.userId||'';
 const isSelf=owner===viewer;
 const today=useToday(timeZone);
 // The day shown follows the clock until the person picks another: left open past midnight
 // on "Today", it moves on to the new today (live trail and latest location included).
 // Choice of day, slider and note belong to one person: another person starts at Today with the slider released.
 const [view,setView]=useState(()=>fresh(''));
 const mine=view.owner===owner?view:fresh(owner);
 const update=useCallback(patch=>setView(previous=>({...(previous.owner===owner?previous:fresh(owner)),...patch})),[owner]);
 const picked=mine.picked,scrub=mine.scrub,notice=mine.notice;
 const date=picked??today;
 // Locate asks the camera to go somewhere once (a new fit key, and a point when there is one); it belongs
 // to the day it was asked on and never re-centres later.
 const locate=mine.locate&&mine.locate.date===date?mine.locate:null;
 const setScrub=value=>update({scrub:value});
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
  return {routes,gaps:[],estimated:scrubbing?[]:[...day.estimated,...day.liveRoads].map(line=>thinLine(line,2000)),live:live.length?thinLine(live.at(-1)):[],pins,...(locate?.point?{focus:locate.point}:{}),fitKey:`${owner}|${date}${locate?`|locate${locate.n}`:''}`};
 },[day,deferred,isToday,isSelf,position,owner,person?.name,person?.status?.text,timeZone,date,locate]);
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
 // Days from the map's own date bar (native, over the map): same actions as before, no extra toolbar row.
 const date_=useMemo(()=>({
  label:dateLabel(date,today),
  accessibilityLabel:`Showing ${new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'})}`,
  previous:{id:'pday:prev',label:'Previous day',symbol:'chevron.left'},
  next:{id:'pday:next',label:'Next day',symbol:'chevron.right',disabled:isToday},
  today:isToday?null:{id:'pday:today',label:'Return to Today',text:'Today'},
  clear:null,
 }),[date,today,isToday]);
 const onControl=useCallback(id=>{
  if(id==='pday:prev')update({picked:addDays(date,-1),scrub:null,locate:null,notice:''});
  else if(id==='pday:next'){const next=addDays(date,1);update({picked:next>=today?null:next,scrub:null,locate:null,notice:''});}
  else if(id==='pday:today')update({picked:null,scrub:null,locate:null,notice:''});
 },[date,today,update]);
 // The Locate button. Me: where I am now. Someone else today: their latest authorised location. A
 // past day, or no location: the day's recorded movement. Nothing to show: say so. It never goes to
 // me when someone else is selected, and never invents a position.
 const ownerNow=useRef(owner);
 useEffect(()=>{ownerNow.current=owner;},[owner]);
 const [locating,setLocating]=useState(false);
 const hasMovement=day.recorded.length+day.live.length+day.estimated.length+day.liveRoads.length+day.markers.length>0;
 const usable=point=>Number.isFinite(point?.latitude)&&Number.isFinite(point?.longitude);
 const onLocate=useCallback(async()=>{
  const forOwner=owner,forDate=date;
  const go=point=>setView(previous=>{const base=previous.owner===forOwner?previous:fresh(forOwner);return {...base,notice:'',locate:{n:(base.locate?.n||0)+1,point,date:forDate}};});
  if(isSelf){
   // One request at a time: a second tap while one is pending is ignored.
   if(locating)return;
   setLocating(true);
   const here=await Promise.resolve().then(()=>locateSelf?.()).catch(()=>null);
   setLocating(false);
   if(ownerNow.current!==forOwner)return;
   if(usable(here))go([here.latitude,here.longitude]);
   else update({notice:'Your location is not available. Check Location access in iOS Settings.'});
   return;
  }
  if(isToday&&usable(position))go([position.latitude,position.longitude]);
  else if(hasMovement)go(null);
  else update({notice:isToday?name?`${name} has no location or movement to show yet.`:'No location or movement to show yet.':'Nothing to show for this day.'});
 },[owner,date,isSelf,isToday,position,hasMovement,locateSelf,locating,name,update]);
 const personDay=useMemo(()=>payload?{payload,onStep,date:date_,onControl,onLocate,locating}:null,[payload,onStep,date_,onControl,onLocate,locating]);
 // Slots are fixed so the map keeps its place in the tree (and is never re-created) whether
 // a person is selected or not. Everything but the map is one line, below it, only when it has something to say.
 const status=!person?'':error?error:notice?notice:loading?'Loading…':day.isEmpty?(isToday?'No movement shared yet today.':'Nothing shared for this day.'):'';
 return <>
  <div className={person?'person-map-canvas':'map-canvas'}>
   {renderMap(personDay)}
  </div>
  {status?<p className="person-map-note" role={error?'alert':'status'}>{status}{notice&&!error?<> <button type="button" className="text-button" onClick={()=>update({notice:''})}>OK</button></>:null}</p>:null}
  {person&&canScrub?<div className="person-map-timeline">
   <input type="range" aria-label="Time of day" min={Math.ceil(first)} max={Math.floor(last)} step={1} value={scrub??Math.floor(last)} onChange={event=>setScrub(Number(event.target.value))}/>
   <span className="person-map-time">{scrub==null?(isToday?'Now':'End of day'):clock(scrub,timeZone)}{at?.inGap?' · No GPS signal':''}</span>
   {scrub!=null&&<button type="button" className="text-button" onClick={()=>setScrub(null)}>{isToday?'Now':'Whole day'}</button>}
  </div>:null}
 </>;
}
