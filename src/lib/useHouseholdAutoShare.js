import {useEffect,useRef} from 'react';
import {HOUSEHOLD_SHARE_LIMIT,shareNewHouseholdActivities} from './householdAutoShare.js';
import {BACKED_UP_EVENT} from './syncNow.js';

// Runs when the app opens, when an activity finishes, when the app comes back to the
// foreground and when the network returns. iOS suspends the WebView, so nothing here can
// run in the background: what is waiting goes out the next time, from the server's own
// list of what is still unshared, so nothing is lost or repeated (publishing is
// idempotent).
//
// The server may learn about a finished recording after the first sharing pass.
// Keep short follow-ups and a foreground recheck; full batches continue on their own.
//
// Only one pass runs at a time; a trigger that arrives meanwhile schedules exactly one more
// afterwards (from whichever effect instance is current).
export const HOUSEHOLD_RECHECK_MS=120000;
export const FOLLOW_UPS_MS=[5000,150000,400000];
export function useHouseholdAutoShare({client,recorder,enabled,finishedCount,receipts,checkpoint}){
 const running=useRef(false),again=useRef(false),latest=useRef({}),pass=useRef(null),mounted=useRef(true),drain=useRef(null);
 useEffect(()=>{latest.current={client,recorder,receipts,checkpoint,enabled};});
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimeout(drain.current);};},[]);
 useEffect(()=>{
  pass.current=()=>{
   if(!mounted.current||!latest.current.enabled||!latest.current.client||document.visibilityState==='hidden'||!navigator.onLine)return;
   if(running.current){again.current=true;return;}
   running.current=true;
   shareNewHouseholdActivities(latest.current).then(result=>{if(result?.published?.length>=HOUSEHOLD_SHARE_LIMIT)again.current=true;}).catch(()=>{}).finally(()=>{
    running.current=false;
    if(again.current&&mounted.current){again.current=false;clearTimeout(drain.current);drain.current=setTimeout(()=>pass.current?.(),2000);}
   });
  };
 });
 useEffect(()=>{
  if(!enabled||!client)return undefined;
  const timers=FOLLOW_UPS_MS.map(ms=>setTimeout(()=>pass.current?.(),ms));
  let soonTimer=null;
  const soon=()=>{clearTimeout(soonTimer);soonTimer=setTimeout(()=>pass.current?.(),3000);};
  const visible=()=>{if(document.visibilityState!=='hidden')soon();};
  const periodic=setInterval(visible,HOUSEHOLD_RECHECK_MS);
  document.addEventListener('visibilitychange',visible);
  window.addEventListener('online',soon);
  // Household sharing follows the backup: an activity that has just reached the cloud is looked at within seconds.
  window.addEventListener(BACKED_UP_EVENT,soon);
  return()=>{timers.forEach(clearTimeout);clearInterval(periodic);clearTimeout(soonTimer);clearTimeout(drain.current);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',soon);window.removeEventListener(BACKED_UP_EVENT,soon);};
 },[enabled,client,finishedCount]);
}
