import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {buildJourneys,changeGrouping,emptyGrouping,placeKey,readGrouping,internalStops} from './journeyGrouping.js';
import {recorder,recorderAvailable} from './recorder.js';
export function useJourneyGrouping({owner,activities,places,vehicles,serialized,savePreferences}){
 const metadata=useMemo(()=>readGrouping(serialized,owner),[serialized,owner]);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const current=useRef(emptyGrouping(owner)),queue=useRef(Promise.resolve());
 useEffect(()=>{current.current=metadata;},[metadata]);
 const persist=useCallback(updater=>{
  const operation=async()=>{const next=updater(current.current);if(next.owner!==owner)throw new Error('Account changed.');const value=JSON.stringify(next);if(value.length>900000)throw new Error('Journey metadata is full.');await savePreferences({journeyGrouping:value});current.current=next;return next;};
  const result=queue.current.then(operation,operation);queue.current=result.catch(()=>{});return result;
 },[owner,savePreferences]);
 const model=useMemo(()=>buildJourneys(activities,{owner,metadata,places,vehicles}),[activities,owner,metadata,places,vehicles]);
 const fingerprint=JSON.stringify(activities.map(t=>[t.id,t.updatedAt,t.points?.length,t.endedAt]));
 useEffect(()=>{
  if(!recorderAvailable()||!owner)return;let alive=true;
  async function enrich(){
   // Sequential lookups avoid geocoder throttling; results are cached per account.
   const context={owner,metadata:current.current,places,vehicles,telemetry:[]};
   const candidates=activities.flatMap(t=>t.points?.length?[{id:t.id,index:0,point:t.points[0]},{id:t.id,index:t.points.length-1,point:t.points.at(-1)},...internalStops(t,context).map(s=>({id:t.id,index:s.pointIndex,point:t.points[s.pointIndex]}))]:[]);
   const seen=new Set();
   for(const c of candidates){
    if(!alive)return;const key=placeKey(c.point);if(!key||seen.has(key))continue;seen.add(key);
    const cached=current.current.places[key];if(cached&&(!cached.retryAfter||cached.retryAfter>Date.now()))continue;
    try{const place=await recorder.recogniseTripPlace(c.id,c.index);if(!alive)return;await persist(meta=>({...meta,places:{...meta.places,[key]:place}}));}
    catch{if(alive)await persist(meta=>({...meta,places:{...meta.places,[key]:{retryAfter:Date.now()+6*3600000}}})).catch(()=>{});}
    await new Promise(resolve=>setTimeout(resolve,1200));
   }
  }
  void enrich();return()=>{alive=false;};
 // Re-run when actual recordings change, not on every two-second polling identity.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[owner,fingerprint]);
 async function act(action){setBusy(true);setError('');try{await persist(meta=>changeGrouping(meta,action,{activities,owner,vehicles,places}));return true;}catch(e){setError(e.message||'Journey change could not be saved.');return false;}finally{setBusy(false);}}
 return {...model,metadata,act,busy,error};
}
