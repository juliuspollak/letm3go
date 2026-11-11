import {useEffect,useRef} from 'react';
import {shareNewHouseholdActivities} from './householdAutoShare.js';

// Runs when the app opens, when an activity finishes, when the app comes back to the
// foreground and when the network returns. iOS suspends the WebView, so nothing here can
// run in the background: what is waiting goes out the next time, from the server's own
// list of what is still unshared, so nothing is lost or repeated (publishing is
// idempotent).
//
// The list comes from the server, and a drive that has only just finished is uploaded by
// the background backup a little later (about every two minutes), so after an activity
// finishes the pass is repeated twice more instead of trusting the first, early look.
//
// Only one pass runs at a time; a trigger that arrives meanwhile schedules exactly one more
// afterwards (from whichever effect instance is current).
export const FOLLOW_UPS_MS=[5000,150000,400000];
export function useHouseholdAutoShare({client,recorder,enabled,finishedCount,receipts,checkpoint}){
 const running=useRef(false),again=useRef(false),latest=useRef({}),pass=useRef(null),mounted=useRef(true);
 useEffect(()=>{latest.current={client,recorder,receipts,checkpoint};});
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  pass.current=()=>{
   if(running.current){again.current=true;return;}
   running.current=true;
   shareNewHouseholdActivities(latest.current).catch(()=>{}).finally(()=>{
    running.current=false;
    if(again.current&&mounted.current){again.current=false;setTimeout(()=>pass.current?.(),2000);}
   });
  };
 });
 useEffect(()=>{
  if(!enabled||!client)return undefined;
  const timers=FOLLOW_UPS_MS.map(ms=>setTimeout(()=>pass.current?.(),ms));
  let soonTimer=null;
  const soon=()=>{clearTimeout(soonTimer);soonTimer=setTimeout(()=>pass.current?.(),3000);};
  const visible=()=>{if(document.visibilityState!=='hidden')soon();};
  document.addEventListener('visibilitychange',visible);
  window.addEventListener('online',soon);
  return()=>{timers.forEach(clearTimeout);clearTimeout(soonTimer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',soon);};
 },[enabled,client,finishedCount]);
}
