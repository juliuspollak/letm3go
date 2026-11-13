import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {usePersonDay} from '../lib/usePersonDay.js';
import {addDays,dayKeyOf} from '../lib/dayWindow.js';
import {thinLine} from '../lib/mapContent.js';
import {activityLabel} from '../lib/activityNames.js';
import {activitySymbol} from '../lib/mapToolbar.js';
import {formatDuration} from '../lib/peopleMap.js';
import {distanceText} from '../lib/distanceUnits.js';
import {filterPersonDay,personRoutes,personFlags,boundedPersonLines,recordedDistance} from '../lib/personMapPresentation.js';

// The Map tab's person view: the selected person's latest shared location, the day's
// movement and selectable saved routes with an on-map activity bubble. There is no second
// map: `renderMap` receives what to draw ({payload,onStep}, or null for All people) and
// the Map tab renders its one map there, so selecting a person, changing day or selecting an activity
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

const fresh=forOwner=>({owner:forOwner,picked:null,notice:'',locate:null,selected:null,activity:''});

// What an empty day means. A drive reaches other people's maps once the phone that recorded it has backed it up (the
// live position is sent on its own, in the background), so for someone else's day the note says so instead of implying
// they chose not to share.
function emptyNote({isSelf,isToday,name}){
 if(isSelf)return isToday?'No movement recorded yet today.':'Nothing recorded for this day.';
 const who=name||'This person';
 return isToday?`No recorded drives from ${who} yet today. Drives appear here once ${who}'s phone has backed them up.`:`Nothing shared by ${who} for this day.`;
}
export default function PersonMap({person,personPin=null,viewer,timeZone=browserZone(),onOpenOwn,onOpenShared,locateSelf=null,renderMap,localTrips=null,localLiveTrip=null,deletedIDs,unit='km',viewState=null,onViewChange=null}){
 const owner=person?.userId||'';
 const isSelf=owner===viewer;
 const today=useToday(timeZone);
 // The day shown follows the clock until the person picks another: left open past midnight
 // on "Today", it moves on to the new today (live trail and latest location included).
 // Day, selection and notes belong to one person; the parent retains them during detail navigation.
 const [localView,setLocalView]=useState(()=>fresh(''));
 const view=viewState??localView;
 const setView=onViewChange??setLocalView;
 const mine=view.owner===owner?view:fresh(owner);
 const update=useCallback(patch=>setView(previous=>({...(previous?.owner===owner?previous:fresh(owner)),...patch})),[owner,setView]);
 const picked=mine.picked,notice=mine.notice;
 const date=picked??today;
 // Locate asks the camera to go somewhere once (a new fit key, and a point when there is one); it belongs
 // to the day it was asked on and never re-centres later.
 const locate=mine.locate&&mine.locate.date===date?mine.locate:null;
 const {day:loadedDay,loading,error}=usePersonDay({viewer,owner,date,timeZone,enabled:Boolean(person),localTrips:isSelf?localTrips:null,localLiveTrip:isSelf?localLiveTrip:null,deletedIDs});
 const day=useMemo(()=>filterPersonDay(loadedDay,mine.activity),[loadedDay,mine.activity]);
 const selected=day.activities.find(a=>a.id===mine.selected);
 const isToday=date===today;
 const name=person?.name;
 const status=!person?'':error?error:notice?notice:loading?'Loading…':mine.activity&&day.isEmpty?'No activities match this filter.':day.isEmpty?emptyNote({isSelf,isToday,name}):'';
 const activityPreview=useMemo(()=>selected?{
  activityID:selected.id,title:selected.title,symbol:activitySymbol(selected.activity||''),
  detail:notice||`${activityLabel(selected.activity)||'Activity'} · ${clock(selected.startedAt,timeZone)} · ${formatDuration(selected.durationSeconds)} · ~${distanceText(recordedDistance(selected)/1000,unit)} recorded`,
 }:null,[selected,timeZone,unit,notice]);
 const savedRoutes=useMemo(()=>personRoutes(day,selected?.id),[day,selected]);
 const payload=useMemo(()=>{
  if(!owner)return null;
  const live=day.live;
  const styled=savedRoutes.slice();
  styled.push(...boundedPersonLines(live.slice(0,-1),125,62500).map(points=>({points,color:'accent',width:6,opacity:1})));
  styled.push(...boundedPersonLines(day.liveRoads,125,62500).map(points=>({points,color:'#F29927',width:3.75,opacity:selected?0.55:1})));
  const pins=personFlags(day,savedRoutes,selected?.id);
  // Reuse the single-person pin from the All people map. The native renderer then
  // shows the same profile photo, live movement/speed label and activity ornament.
  // Never show a current position on a historical day or when its owner is hidden.
  if(isToday&&personPin?.kind==='people'&&personPin.members?.length===1&&(personPin.members[0].id===owner||(isSelf&&personPin.members[0].id==='self')))pins.push(personPin);
  // scope changes pause following without reframing; only an explicit Locate focus moves the camera.
  return {routes:[],styled,personDay:true,selectedActivity:selected?.id||null,activityPreview,status,scope:`${owner}|${date}`,gaps:[],estimated:[],live:live.length?thinLine(live.at(-1)):[],pins,...(locate?.point?{focus:locate.point}:{}),fitKey:`${owner}|${date}${locate?`|locate${locate.n}`:''}`};
 },[day,isToday,isSelf,personPin,owner,date,locate,selected,savedRoutes,activityPreview,status]);
 const openActivity=useCallback((id,options={})=>{
  if(isSelf){
   // My own activity: opened from this phone's copy. One that is only in the cloud (another
   // phone, a watch) is not a shared copy, so the shared viewer would fail; say so instead.
   if(onOpenOwn&&onOpenOwn(id,options)){update({picked:date});return;}
   update({notice:'That activity is not on this phone. Open it from Activities once it has synced.'});return;
  }
  update({picked:date});
  onOpenShared?.(id,{userId:owner,name},options);
 },[isSelf,owner,name,onOpenOwn,onOpenShared,update,date]);
 const onStep=useCallback(id=>{if(day.activities.some(a=>a.id===id))update({selected:id,notice:''});},[day.activities,update]);
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
  const [,action,...parts]=id.split(':');
  if(action==='open'||action==='open-fullscreen'){if(selected&&(!parts.length||parts.join(':')===selected.id))openActivity(selected.id,{fullscreen:action==='open-fullscreen'});}
  else if(action==='clear'){if(!parts.length||parts.join(':')===selected?.id)update({selected:null,notice:''});}
  else if(id.startsWith('pday:activity:'))update({activity:id.slice('pday:activity:'.length),selected:null,notice:''});
  else if(id==='pday:reset')update({activity:'',selected:null,notice:''});
  else if(id==='pday:prev')update({picked:addDays(date,-1),locate:null,notice:'',selected:null});
  else if(id==='pday:next'){const next=addDays(date,1);update({picked:next>=today?null:next,locate:null,notice:'',selected:null});}
  else if(id==='pday:today')update({picked:null,locate:null,notice:'',selected:null});
 },[date,today,update,selected,openActivity]);
 // Locate always means my own current location, independent of the selected person/day.
 // Ignore delayed answers after either changes; never fall back to somebody else's fix.
 const requestContext=useRef('');
 const context=`${owner}|${date}`;
 useEffect(()=>{requestContext.current=context;},[context]);
 const [locating,setLocating]=useState(false);
 const onLocate=useCallback(async()=>{
  if(locating)return;
  setLocating(true);
  const here=await Promise.resolve().then(()=>locateSelf?.()).catch(()=>null);
  setLocating(false);
  if(requestContext.current!==context)return;
  if(Number.isFinite(here?.latitude)&&Number.isFinite(here?.longitude)&&Math.abs(here.latitude)<=90&&Math.abs(here.longitude)<=180){
   setView(previous=>{const base=previous?.owner===owner?previous:fresh(owner);return {...base,notice:'',locate:{n:(base.locate?.n||0)+1,point:[here.latitude,here.longitude],date}};});
  }else update({notice:'Your location is not available. Check Location access in iOS Settings.'});
 },[owner,date,context,locateSelf,locating,update,setView]);
 const filters=useMemo(()=>({
  active:mine.activity?1:0,
  sections:[{id:'activity',label:'Activity',options:[{id:'pday:activity:',label:'All activities',text:'All activities',selected:!mine.activity},
   ...[...new Set(loadedDay.activities.map(a=>a.activity).filter(Boolean))].map(activity=>({id:'pday:activity:'+activity,label:activityLabel(activity),text:activityLabel(activity),symbol:activitySymbol(activity),selected:mine.activity===activity}))]}],
 }),[mine.activity,loadedDay.activities]);
 const personDay=useMemo(()=>payload?{payload,onStep,date:date_,onControl,onLocate,locating,filters}:null,[payload,onStep,date_,onControl,onLocate,locating,filters]);
 // Slots are fixed so the map keeps its place in the tree (and is never re-created) whether
 // a person is selected or not. Day notices stay within the map surface.
 return <div className={person?'person-map-canvas':'map-canvas'}>
  {/* The render slot forwards event callbacks, never invokes them during render. */}
  {/* eslint-disable-next-line react-hooks/refs */}
  {renderMap(personDay)}
  {status?<p className="person-map-note" role={error?'alert':'status'}>{status}{notice&&!error?<button type="button" className="text-button" onClick={()=>update({notice:''})}>OK</button>:null}</p>:null}
 </div>;
}
