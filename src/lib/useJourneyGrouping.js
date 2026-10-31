import {activityCode} from './activityNames.js';
import {reconcileSources} from './fleetJourneys.js';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {buildJourneys,changeGrouping,emptyGrouping,placeKey,readGrouping,internalStops} from './journeyGrouping.js';
import {recorder,recorderAvailable} from './recorder.js';
export function useJourneyGrouping({owner,activities,places,vehicles,serialized,savePreferences,telemetry=[]}){
 const metadata=useMemo(()=>readGrouping(serialized,owner),[serialized,owner]);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const current=useRef(emptyGrouping(owner)),queue=useRef(Promise.resolve());
 useEffect(()=>{current.current=metadata;},[metadata]);
 const persist=useCallback(updater=>{
  const operation=async()=>{const next=updater(current.current);if(next.owner!==owner)throw new Error('Account changed.');const value=JSON.stringify(next);if(value.length>900000)throw new Error('Journey metadata is full.');await savePreferences({journeyGrouping:value});current.current=next;return next;};
  const result=queue.current.then(operation,operation);queue.current=result.catch(()=>{});return result;
 },[owner,savePreferences]);
 const reconciled=useMemo(()=>reconcileSources(activities,{owner,vehicles,links:metadata.sourceLinks||[]}),[activities,owner,vehicles,metadata.sourceLinks]);
 const model=useMemo(()=>{const own=buildJourneys(reconciled.activities,{owner,metadata,places,vehicles,telemetry});const shared=reconciled.activities.filter(t=>t.ownerID&&t.ownerID!==owner&&t.sharedToHousehold);const publicPlaces=Object.fromEntries(Object.entries(metadata.places).filter(([,p])=>p.source==='apple-geocoder-mapkit'));const sharedJourneys=[...new Set(shared.map(t=>t.ownerID))].flatMap(sharedOwner=>buildJourneys(shared.filter(t=>t.ownerID===sharedOwner),{owner:sharedOwner,metadata:{...emptyGrouping(sharedOwner),places:publicPlaces},places:[],vehicles:[],telemetry}).journeys.map(j=>({...j,readOnly:true})));return {...own,journeys:[...own.journeys,...sharedJourneys]};},[reconciled.activities,owner,metadata,places,vehicles,telemetry]);
 const fingerprint=JSON.stringify(activities.map(t=>[t.id,t.updatedAt,t.points?.length,t.endedAt]));
 useEffect(()=>{
  if(!recorderAvailable()||!owner)return;let alive=true;
  async function enrich(){
   // Sequential lookups avoid geocoder throttling; results are cached per account.
   const context={owner,metadata:current.current,places,vehicles,telemetry:[]};
   const candidates=activities.flatMap(t=>{
    const points=t.points||[];if(!points.length)return [];
    const indexes=[0,points.length-1,...internalStops(t,context).map(s=>s.pointIndex)];
    if(['Hiking','Walking','Running','Cycling','MTB','Road cycling','Mountain biking'].includes(activityCode(t.activity))&&points.length>10)indexes.push(...[.2,.4,.6,.8].map(f=>Math.round((points.length-1)*f)));
    return [...new Set(indexes)].filter(i=>points[i]).map(index=>({id:t.id,index,point:points[index],cloud:t.source!=='device'&&t.source!=='simulator'}));
   });
   const seen=new Set();
   for(const c of candidates){
    if(!alive)return;const key=placeKey(c.point);if(!key||seen.has(key))continue;seen.add(key);
    const cached=current.current.places[key];if(cached&&(!cached.retryAfter||cached.retryAfter>Date.now()))continue;
    try{const place=await recorder.recogniseTripPlace(c.id,c.index,c.cloud?c.point:null);if(!alive)return;await persist(meta=>({...meta,places:{...meta.places,[key]:place}}));}
    catch{if(alive)await persist(meta=>({...meta,places:{...meta.places,[key]:{retryAfter:Date.now()+6*3600000}}})).catch(()=>{});}
    await new Promise(resolve=>setTimeout(resolve,1200));
   }
  }
  void enrich();return()=>{alive=false;};
 // Re-run when actual recordings change, not on every two-second polling identity.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[owner,fingerprint]);
 async function act(action){setBusy(true);setError('');try{await persist(meta=>changeGrouping(meta,action,{activities,owner,vehicles,places}));return true;}catch(e){setError(e.message||'Journey change could not be saved.');return false;}finally{setBusy(false);}}
 return {...model,records:reconciled.activities,sourceSuggestions:reconciled.suggestions,metadata,act,busy,error};
}
