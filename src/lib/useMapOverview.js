import {useEffect,useMemo,useRef,useState} from 'react';
import {mapOverview,overviewKey} from './mapOverview.js';
import {packJourneys} from './overviewTransfer.js';

// The Map overview for the journeys shown, computed in a worker so a long
// history never blocks scrolling or taps (about a second for 300 journeys and
// 390,000 points). Rapid filter changes are coalesced: one calculation runs at
// a time and only the latest request waits behind it. Only an overview for the
// current journeys is ever returned; while it is being prepared the map shows
// no routes rather than the previous filter's.
//
// Without worker support (tests, very old WebViews) it is computed directly.
let shared=null;
function worker(){
 if(shared!==null)return shared;
 try{shared=typeof Worker==='undefined'?false:new Worker(new URL('./mapOverview.worker.js',import.meta.url),{type:'module'});}
 catch{shared=false;}
 return shared;
}

export function useMapOverview(journeys,{enabled=true,unit='km'}={}){
 const key=useMemo(()=>enabled&&journeys.length?overviewKey(journeys,unit):null,[enabled,journeys,unit]);
 const [result,setResult]=useState({key:null,overview:null,error:''});
 const latest=useRef({key:null,journeys:[],unit});
 const busy=useRef(false),waiting=useRef(false),next=useRef(1),requested=useRef(null);
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  latest.current={key,journeys,unit};
  // New journey objects with the same content need no new calculation.
  if(!key||requested.current===key)return;
  requested.current=key;
  const thread=worker();
  if(!thread){
   // Synchronous fallback: deferred a tick so it never runs inside render.
   const timer=setTimeout(()=>{
    try{setResult({key,overview:mapOverview(journeys,{unit}),error:''});}
    catch(error){requested.current=null;setResult({key,overview:null,error:error?.message||'Routes could not be prepared.'});}
   },0);
   return()=>{clearTimeout(timer);requested.current=null;};
  }
  const send=()=>{
   const request=latest.current;
   if(!request.key)return;
   busy.current=true;waiting.current=false;
   const id=next.current++;
   const packed=packJourneys(request.journeys);
   const done=({data})=>{
    if(data?.id!==id)return;
    thread.removeEventListener('message',done);thread.removeEventListener('error',failed);
    busy.current=false;
    if(data.overview)setResult({key:data.overview.key,overview:data.overview,error:''});
    else{requested.current=null;setResult({key:request.key,overview:null,error:data.error||'Routes could not be prepared.'});}
    if(waiting.current)send();
   };
   const failed=()=>{
    thread.removeEventListener('message',done);thread.removeEventListener('error',failed);
    // A worker that cannot run (it failed to load) is not used again; the
    // retry computes directly instead.
    if(shared===thread){try{thread.terminate();}catch{/* already gone */}shared=false;}
    busy.current=false;requested.current=null;
    setResult({key:request.key,overview:null,error:'Routes could not be prepared.'});
    if(waiting.current)send();
   };
   thread.addEventListener('message',done);thread.addEventListener('error',failed);
   thread.postMessage({id,unit:request.unit,...packed},[packed.coordinates.buffer]);
  };
  if(busy.current)waiting.current=true;
  else send();
 },[key,journeys,unit,attempt]);
 // Only an answer for the journeys on screen now.
 const current=key&&result.key===key;
 const retry=()=>{requested.current=null;setAttempt(value=>value+1);};
 return {overview:current?result.overview:null,pending:Boolean(key)&&!(current&&(result.overview||result.error)),error:current?result.error:'',retry};
}
