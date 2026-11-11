import {useEffect,useRef} from 'react';
import {shareNewHouseholdActivities} from './householdAutoShare.js';

// Runs when activities finish or the app opens; never on a timer.
export function useHouseholdAutoShare({client,recorder,enabled,finishedCount,receipts,checkpoint}){
 const running=useRef(false);
 useEffect(()=>{
  if(!enabled||!client||running.current)return;
  running.current=true;
  const timer=setTimeout(()=>{
   shareNewHouseholdActivities({client,recorder,receipts,checkpoint}).catch(()=>{}).finally(()=>{running.current=false;});
  },5000);
  return()=>{clearTimeout(timer);running.current=false;};
 },[enabled,client,finishedCount]); // eslint-disable-line react-hooks/exhaustive-deps
}
