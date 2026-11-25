import {useEffect,useMemo,useRef,useState} from 'react';
import {recorder,recorderAvailable} from './recorder.js';

// Travel time to each person, from Apple Maps (the same directions lookup the
// activity road estimates use). Looked up one at a time, and again only when someone or
// you have moved about 200 m or the answer is five minutes old.
const FRESH_MS=5*60*1000,usable=p=>Number.isFinite(p?.latitude)&&Number.isFinite(p?.longitude);
const cell=p=>`${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`;

export function travelDuration(seconds){
 if(!Number.isFinite(seconds)||seconds<0)return '';
 const minutes=Math.max(1,Math.round(seconds/60));
 if(minutes<60)return `${minutes} min`;
 const hours=Math.floor(minutes/60),rest=minutes%60;
 return `${hours} h${rest?` ${rest} min`:''}`;
}

export function driveTimeText(seconds){
 const duration=travelDuration(seconds);
 return duration?`${duration} drive`: '';
}

export function useDriveTimes({people,from,enabled,transport,scope,lookup=(a,b)=>recorder.roadRoute(a,b,transport)}){
 const [times,setTimes]=useState({});
 const cache=useRef(new Map()),latest=useRef(lookup);
 useEffect(()=>{latest.current=lookup;});
 const origin=usable(from)?{latitude:from.latitude,longitude:from.longitude}:null;
 // Only who is located matters: a person's status text changing must not repeat the lookups.
 const targets=useMemo(()=>(people||[]).filter(p=>p.userId&&usable(p.position)&&(p.state==='live'||p.state==='stale')).map(p=>({userId:p.userId,latitude:p.position.latitude,longitude:p.position.longitude})),[people]);
 const originKey=origin?cell(origin):'';
 const namespace=JSON.stringify([scope,transport]);
 const routeKey=target=>JSON.stringify([namespace,target.userId,cell(target),originKey]);
 const targetKey=JSON.stringify(targets.map(routeKey));
 useEffect(()=>{
  if(!enabled||!origin||!recorderAvailable()||!targets.length)return undefined;
  let alive=true;
  (async()=>{
   for(const target of targets){
    if(!alive)return;
    const key=routeKey(target),hit=cache.current.get(key);
    let at=hit?.at;
    let seconds=hit&&Date.now()-at<FRESH_MS?hit.seconds:undefined;
    if(seconds===undefined){
     try{
      const found=await latest.current(origin,target);
      const best=(found?.routes||[]).map(route=>route.expectedSeconds).filter(seconds=>Number.isFinite(seconds)&&seconds>=0).sort((a,b)=>a-b)[0];
      seconds=Number.isFinite(best)?best:null;
      at=Date.now();
      cache.current.set(key,{seconds,at});
     }catch{continue;}
    }
    if(!alive)return;
    setTimes(current=>current[target.userId]?.key===key&&current[target.userId].at===at?current:{...current,[target.userId]:{key,namespace,seconds,at}});
   }
  })();
  return()=>{alive=false;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[enabled,originKey,targetKey,scope,transport,recorderAvailable()]);
 // Keep the last estimate during recalculation, bounded by the route cache lifetime.
 useEffect(()=>{
  if(!enabled||!originKey)return undefined;
  const pending=targets.flatMap(target=>{
   const estimate=times[target.userId];
   return estimate?.namespace===namespace&&estimate.key!==routeKey(target)
    ?[[target.userId,estimate]]:[];
  });
  if(!pending.length)return undefined;
  const expiresAt=Math.min(...pending.map(([,estimate])=>estimate.at+FRESH_MS));
  const timer=setTimeout(()=>{
   const now=Date.now();
   setTimes(current=>{
    const next={...current};
    for(const [id,estimate] of pending){
     if(current[id]===estimate&&estimate.at+FRESH_MS<=now)delete next[id];
    }
    return next;
   });
  },Math.max(0,expiresAt-Date.now()));
  return()=>clearTimeout(timer);
  // targetKey captures the same route identities used above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[enabled,namespace,originKey,targetKey,times]);
 return enabled&&origin?Object.fromEntries(targets.filter(target=>times[target.userId]?.namespace===namespace).map(target=>[target.userId,times[target.userId].seconds])):{};
}
