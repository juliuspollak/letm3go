import {useEffect,useMemo,useRef,useState} from 'react';
import {recorder,recorderAvailable} from './recorder.js';

// How long each person is away by car, from Apple Maps (the same directions lookup the
// activity road estimates use). Looked up one at a time, and again only when someone or
// you have moved about 200 m or the answer is five minutes old.
const FRESH_MS=5*60*1000,usable=p=>Number.isFinite(p?.latitude)&&Number.isFinite(p?.longitude);
const cell=p=>`${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`;

export function driveTimeText(seconds){
 if(!Number.isFinite(seconds)||seconds<0)return '';
 const minutes=Math.max(1,Math.round(seconds/60));
 if(minutes<60)return `${minutes} min drive`;
 const hours=Math.floor(minutes/60),rest=minutes%60;
 return `${hours} h${rest?` ${rest} min`:''} drive`;
}

export function useDriveTimes({people,from,enabled,lookup=(a,b)=>recorder.roadRoute(a,b)}){
 const [times,setTimes]=useState({});
 const cache=useRef(new Map()),latest=useRef(lookup);
 useEffect(()=>{latest.current=lookup;});
 const origin=usable(from)?{latitude:from.latitude,longitude:from.longitude}:null;
 // Only who is located matters: a person's status text changing must not repeat the lookups.
 const targets=useMemo(()=>(people||[]).filter(p=>p.userId&&usable(p.position)&&(p.state==='live'||p.state==='stale')).map(p=>({userId:p.userId,latitude:p.position.latitude,longitude:p.position.longitude})),[people]);
 const targetKey=JSON.stringify(targets.map(t=>[t.userId,cell(t)])),originKey=origin?cell(origin):'';
 useEffect(()=>{
  if(!enabled||!origin||!recorderAvailable()||!targets.length)return undefined;
  let alive=true;
  (async()=>{
   for(const target of targets){
    if(!alive)return;
    const key=`${target.userId}|${cell(target)}|${originKey}`,hit=cache.current.get(key);
    let seconds=hit&&Date.now()-hit.at<FRESH_MS?hit.seconds:undefined;
    if(seconds===undefined){
     try{
      const found=await latest.current(origin,target);
      const best=(found?.routes||[]).map(route=>route.expectedSeconds).filter(Number.isFinite).sort((a,b)=>a-b)[0];
      seconds=Number.isFinite(best)?best:null;
      cache.current.set(key,{seconds,at:Date.now()});
     }catch{continue;}
    }
    if(!alive)return;
    setTimes(current=>current[target.userId]===seconds?current:{...current,[target.userId]:seconds});
   }
  })();
  return()=>{alive=false;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[enabled,originKey,targetKey,recorderAvailable()]);
 return times;
}
