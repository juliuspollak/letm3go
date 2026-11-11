import {useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from './supabase.js';
import {addDays,dayWindow} from './dayWindow.js';
import {composeDay,localDayRows,mergeOwnRows} from './personDay.js';
import {mergeTrail,newestTime} from './liveTrail.js';
import {cachedDay,epochOf,invalidateViewer,mergeRows,peekFreshDay,storeDay} from './personDayCache.js';
import {subscribeHouseholdSignals,throttled} from './householdRealtime.js';

// One person's day for the map: what they shared with me (or my own), plus their
// live trail while it is today. Cached days appear immediately and are quietly
// revalidated (an unchanged activity costs one etag, never its geometry again); a
// revoked or hidden activity disappears on that revalidation because the server
// stops returning it. Neighbouring days are fetched ahead.
export const LIVE_POLL_MS=10000;
// While a map is open its days are revalidated this often (an etag round trip when
// nothing changed), when the app returns to the foreground and when the network returns.
// This is how a withdrawn permission reaches an open map without a push channel.
export const REVALIDATE_MS=60000;
// A day is cached by its window, so the same date in another time zone (a traveller)
// is a different entry and can never be served for the wrong 24 hours.
const slot=(date,timeZone)=>`${date}@${timeZone}`;
// Resolves with the rows, or null when access may have changed while the request was in
// flight (the answer could pre-date a revocation, so it is neither stored nor shown; a
// fresh request follows from whatever changed it).
async function fetchDay({viewer,owner,date,timeZone}){
 const epoch=epochOf(viewer,owner);
 const w=dayWindow(date,timeZone),held=cachedDay(viewer,owner,slot(date,timeZone));
 const known=(held?.rows||[]).map(row=>row.etag).filter(Boolean);
 const {data,error}=await supabase.rpc('my_shared_day',{p_owner:owner,p_from:new Date(w.start*1000).toISOString(),p_to:new Date(w.end*1000).toISOString(),p_known:known});
 if(error)throw new Error(error.message||'Unable to load this day.');
 if(epochOf(viewer,owner)!==epoch)return null;
 const rows=mergeRows(held?.rows,data||[]);
 storeDay(viewer,owner,slot(date,timeZone),{rows,at:Date.now()});
 return rows;
}
const clock=()=>Date.now()/1000;
const NONE=[];
// `localTrips` (my own map only): activities saved on this phone, merged with the cloud ones.
export function usePersonDay({viewer,owner,date,timeZone,enabled=true,now=clock,localTrips=null,deletedIDs=NONE}){
 const key=`${viewer}|${owner}|${slot(date,timeZone)}`;
 const [loaded,setLoaded]=useState({key:null,rows:[],error:''});
 const held=peekFreshDay(viewer,owner,slot(date,timeZone));
 const current=loaded.key===key;
 const heldRows=held?.rows;
 const rows=useMemo(()=>current?loaded.rows:(heldRows||NONE),[current,loaded.rows,heldRows]);
 const refresh=useRef(null),sequence=useRef(0);
 useEffect(()=>{
  if(!enabled||!supabase||!viewer||!owner)return undefined;
  let cancelled=false;
  const run=()=>{
   // Only the newest request may change what is shown: an older answer arriving late (it
   // may predate a revocation) is ignored.
   const mine=++sequence.current;
   const current=()=>!cancelled&&mine===sequence.current;
   fetchDay({viewer,owner,date,timeZone}).then(next=>{if(current()&&next)setLoaded({key,rows:next,error:''});})
    .catch(error=>{if(!current())return;
     // Could not reach the server. What was loaded stays only while it was verified recently;
     // after that it is dropped and the failure is reported, so a withdrawn permission is not
     // displayed from memory and the person is told the data cannot be confirmed.
     const recent=peekFreshDay(viewer,owner,slot(date,timeZone));
     setLoaded(previous=>recent?{key,rows:previous.key===key?previous.rows:recent.rows,error:''}:{key,rows:[],error:error.message||'Unable to confirm this day.'});
    });
  };
  refresh.current=run;
  run();
  // Ahead of the person asking: the days either side, quietly.
  for(const neighbour of [addDays(date,-1),addDays(date,1)])if(!cachedDay(viewer,owner,slot(neighbour,timeZone)))void fetchDay({viewer,owner,date:neighbour,timeZone}).catch(()=>{});
  const visible=()=>{if(typeof document==='undefined'||document.visibilityState!=='hidden')run();};
  const timer=setInterval(visible,REVALIDATE_MS);
  document.addEventListener('visibilitychange',visible);
  window.addEventListener('online',run);
  return()=>{cancelled=true;refresh.current=null;clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',run);};
 },[key,timeZone,enabled]); // eslint-disable-line react-hooks/exhaustive-deps
 // Access changed (a share removed, a friend or household member removed): the server says
 // so over the person's own private channel, with an empty message. Everything held counts as
 // unverified, responses already on their way are discarded, and the day is read again now.
 // Best effort: if the channel is down or a message is missed, the schedule above recovers it.
 useEffect(()=>{
  if(!enabled||!supabase?.channel||!viewer)return undefined;
  let stop=()=>{},cancelled=false;
  const changed=throttled(()=>{invalidateViewer(viewer);refresh.current?.();});
  (async()=>{
   try{await supabase.realtime?.setAuth?.();}catch{/* polling still works */}
   if(cancelled)return;
   stop=subscribeHouseholdSignals(supabase,[`user:${viewer}`],{event:'share',onSignal:changed,onState:()=>{}});
  })();
  return()=>{cancelled=true;changed.cancel();stop();};
 },[viewer,enabled]);
 const isToday=useMemo(()=>{const w=dayWindow(date,timeZone),t=now();return t>=w.start&&t<w.end;},[date,timeZone,now]);
 const liveKey=`${owner}|${isToday}|${date}|${timeZone}`;
 const [liveState,setLiveState]=useState({key:null,value:null});
 const live=liveState.key===liveKey?liveState.value:null;
 useEffect(()=>{
  if(!enabled||!supabase||!owner||!isToday)return;
  let cancelled=false,timer=null,trail=null;
  const refreshDay=()=>{void fetchDay({viewer,owner,date,timeZone}).then(next=>{if(!cancelled&&next)setLoaded({key,rows:next,error:''});}).catch(()=>{});};
  async function tick(){
   if(cancelled)return;
   if(typeof document!=='undefined'&&document.visibilityState==='hidden'){timer=setTimeout(tick,LIVE_POLL_MS);return;}
   try{
    const after=trail?newestTime(trail.points):0;
    const {data,error}=await supabase.rpc('my_live_trail',{p_owner:owner,p_after:after});
    if(cancelled)return;
    const row=Array.isArray(data)?data[0]:data;
    if(!error){
     // No row, or a row whose trail the server has emptied (finished, hidden, sharing off):
     // drop what we hold, and fetch the day again so a finished drive arrives as the saved
     // activity instead of being drawn twice or not at all.
     if(!row||row.point_count===0){if(trail){trail=null;setLiveState({key:liveKey,value:null});refreshDay();}}
     else{
      // A new activity restarts the trail; the same one only appends.
      const fresh=!trail||trail.ref!==row.activity_ref;
      const next={ref:row.activity_ref,points:mergeTrail(fresh?[]:trail.points,row.points||[]),roads:row.roads||{}};
      // A quiet poll changes nothing: do not rebuild the day for it.
      const same=!fresh&&next.points.length===trail.points.length&&newestTime(next.points)===newestTime(trail.points)
       &&JSON.stringify(next.roads)===JSON.stringify(trail.roads);
      trail=next;
      if(!same)setLiveState({key:liveKey,value:{...trail}});
     }
    }
   }catch{/* the next poll tries again */}
   timer=setTimeout(tick,LIVE_POLL_MS);
  }
  void tick();
  return()=>{cancelled=true;clearTimeout(timer);};
 },[owner,isToday,enabled,liveKey,date,timeZone]); // eslint-disable-line react-hooks/exhaustive-deps
 const shownRows=useMemo(()=>localTrips?mergeOwnRows(rows,localDayRows(localTrips,dayWindow(date,timeZone),deletedIDs),deletedIDs):rows,[rows,localTrips,deletedIDs,date,timeZone]);
 const day=useMemo(()=>composeDay({rows:shownRows,live,timeZone,date,now:now()}),[shownRows,live,timeZone,date,now]);
 return {day,live,loading:enabled&&!current&&!held,error:current?loaded.error:''};
}
