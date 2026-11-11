import {useEffect,useRef} from 'react';
import {shareNewHouseholdActivities} from './householdAutoShare.js';

// Runs when activities finish or the app opens; never on a timer. Only one pass runs
// at a time; a trigger that arrives meanwhile schedules exactly one more afterwards.
export function useHouseholdAutoShare({client,recorder,enabled,finishedCount,receipts,checkpoint}){
 const running=useRef(false),again=useRef(false),latest=useRef({});
 useEffect(()=>{latest.current={client,recorder,receipts,checkpoint};});
 useEffect(()=>{
  if(!enabled||!client)return undefined;
  let timer=null,alive=true;
  const pass=()=>{
   if(running.current){again.current=true;return;}
   running.current=true;
   const args=latest.current;
   shareNewHouseholdActivities(args).catch(()=>{}).finally(()=>{
    running.current=false;
    if(again.current&&alive){again.current=false;timer=setTimeout(pass,2000);}
   });
  };
  timer=setTimeout(pass,5000);
  return()=>{alive=false;clearTimeout(timer);};
 },[enabled,client,finishedCount]);
}
