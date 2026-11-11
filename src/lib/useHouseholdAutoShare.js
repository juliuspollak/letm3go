import {useEffect,useRef} from 'react';
import {shareNewHouseholdActivities} from './householdAutoShare.js';

// Runs when the app opens, when an activity finishes, when the app comes back to the
// foreground and when the network returns; never on a timer. iOS suspends the WebView, so
// nothing here can run in the background: what is waiting simply goes out the next time,
// from the server's own list of what is still unshared, so nothing is lost or repeated
// (publishing is idempotent). Only one pass runs at a time; a trigger that arrives
// meanwhile schedules exactly one more afterwards.
export function useHouseholdAutoShare({client,recorder,enabled,finishedCount,receipts,checkpoint}){
 const running=useRef(false),again=useRef(false),latest=useRef({});
 useEffect(()=>{latest.current={client,recorder,receipts,checkpoint};});
 useEffect(()=>{
  if(!enabled||!client)return undefined;
  let timer=null,alive=true;
  const pass=()=>{
   if(running.current){again.current=true;return;}
   running.current=true;
   shareNewHouseholdActivities(latest.current).catch(()=>{}).finally(()=>{
    running.current=false;
    if(again.current&&alive){again.current=false;timer=setTimeout(pass,2000);}
   });
  };
  const soon=()=>{clearTimeout(timer);timer=setTimeout(pass,3000);};
  const visible=()=>{if(document.visibilityState!=='hidden')soon();};
  timer=setTimeout(pass,5000);
  document.addEventListener('visibilitychange',visible);
  window.addEventListener('online',soon);
  return()=>{alive=false;clearTimeout(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',soon);};
 },[enabled,client,finishedCount]);
}
