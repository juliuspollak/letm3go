import {useEffect,useMemo,useState} from 'react';
import {supabase} from './supabase.js';
import {addDays,dayWindow} from './dayWindow.js';
import {composeDay} from './personDay.js';
import {mergeTrail,newestTime} from './liveTrail.js';
import {cachedDay,mergeRows,peekDay,storeDay} from './personDayCache.js';

// One person's day for the map: what they shared with me (or my own), plus their
// live trail while it is today. Cached days appear immediately and are quietly
// revalidated (an unchanged activity costs one etag, never its geometry again); a
// revoked or hidden activity disappears on that revalidation because the server
// stops returning it. Neighbouring days are fetched ahead.
export const LIVE_POLL_MS=10000;
async function fetchDay({viewer,owner,date,timeZone}){
 const w=dayWindow(date,timeZone),held=cachedDay(viewer,owner,date);
 const known=(held?.rows||[]).map(row=>row.etag).filter(Boolean);
 const {data,error}=await supabase.rpc('my_shared_day',{p_owner:owner,p_from:new Date(w.start*1000).toISOString(),p_to:new Date(w.end*1000).toISOString(),p_known:known});
 if(error)throw new Error(error.message||'Unable to load this day.');
 const rows=mergeRows(held?.rows,data||[]);
 storeDay(viewer,owner,date,{rows,at:Date.now()});
 return rows;
}
const clock=()=>Date.now()/1000;
const NONE=[];
export function usePersonDay({viewer,owner,date,timeZone,enabled=true,now=clock}){
 const key=`${viewer}|${owner}|${date}`;
 const [loaded,setLoaded]=useState({key:null,rows:[],error:''});
 const held=peekDay(viewer,owner,date);
 const current=loaded.key===key;
 const heldRows=held?.rows;
 const rows=useMemo(()=>current?loaded.rows:(heldRows||NONE),[current,loaded.rows,heldRows]);
 useEffect(()=>{
  if(!enabled||!supabase||!viewer||!owner)return;
  let cancelled=false;
  const before=cachedDay(viewer,owner,date);
  fetchDay({viewer,owner,date,timeZone}).then(next=>{if(!cancelled)setLoaded({key,rows:next,error:''});})
   .catch(error=>{if(!cancelled)setLoaded({key,rows:before?.rows||[],error:before?'':error.message});});
  // Ahead of the person asking: the days either side, quietly.
  for(const neighbour of [addDays(date,-1),addDays(date,1)])if(!cachedDay(viewer,owner,neighbour))void fetchDay({viewer,owner,date:neighbour,timeZone}).catch(()=>{});
  return()=>{cancelled=true;};
 },[key,timeZone,enabled]); // eslint-disable-line react-hooks/exhaustive-deps
 const isToday=useMemo(()=>{const w=dayWindow(date,timeZone),t=now();return t>=w.start&&t<w.end;},[date,timeZone,now]);
 const liveKey=`${owner}|${isToday}`;
 const [liveState,setLiveState]=useState({key:null,value:null});
 const live=liveState.key===liveKey?liveState.value:null;
 useEffect(()=>{
  if(!enabled||!supabase||!owner||!isToday)return;
  let cancelled=false,timer=null,trail=null;
  async function tick(){
   if(cancelled)return;
   if(typeof document!=='undefined'&&document.visibilityState==='hidden'){timer=setTimeout(tick,LIVE_POLL_MS);return;}
   try{
    const after=trail?newestTime(trail.points):0;
    const {data,error}=await supabase.rpc('my_live_trail',{p_owner:owner,p_after:after});
    if(cancelled)return;
    const row=Array.isArray(data)?data[0]:data;
    if(!error){
     if(!row){if(trail){trail=null;setLiveState({key:liveKey,value:null});}}
     else{
      // A new activity restarts the trail; the same one only appends.
      const fresh=!trail||trail.ref!==row.activity_ref;
      trail={ref:row.activity_ref,points:mergeTrail(fresh?[]:trail.points,row.points||[]),roads:row.roads||{}};
      setLiveState({key:liveKey,value:{...trail}});
     }
    }
   }catch{/* the next poll tries again */}
   timer=setTimeout(tick,LIVE_POLL_MS);
  }
  void tick();
  return()=>{cancelled=true;clearTimeout(timer);};
 },[owner,isToday,enabled,liveKey]);
 const day=useMemo(()=>composeDay({rows,live,timeZone,date,now:now()}),[rows,live,timeZone,date,now]);
 return {day,live,loading:enabled&&!current&&!held,error:current?loaded.error:''};
}
