import {recognitionSampleIndexes,lookupDue,cachedLookup} from './journeyRecognition.js';
import {reconcileSources} from './fleetJourneys.js';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {buildJourneys,changeGrouping,emptyGrouping,placeKey,readGrouping,internalStops,nativeStops} from './journeyGrouping.js';
import {recorder,recorderAvailable} from './recorder.js';
import {STOP_LOOKUP_VERSION} from './stopVenueRecognition.js';
import {routeGaps,gapKey,roadLookupDue,roadRecord,failedRecord,ROAD_CACHE_BYTES} from './gapReconstruction.js';
export function useJourneyGrouping({owner,activities,places,vehicles,serialized,savePreferences,telemetry=[]}){
 const projectionCache=useMemo(()=>({owner,values:new Map()}),[owner]);
 const metadata=useMemo(()=>readGrouping(serialized,owner),[serialized,owner]);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const current=useRef(emptyGrouping(owner)),queue=useRef(Promise.resolve());
 useEffect(()=>{current.current=metadata;},[metadata]);
 const persist=useCallback(updater=>{
  const operation=async()=>{const next=updater(current.current);if(next.owner!==owner)throw new Error('Account changed.');const value=JSON.stringify(next);if(value.length>900000)throw new Error('Journey metadata is full.');await savePreferences({journeyGrouping:value});current.current=next;return next;};
  const result=queue.current.then(operation,operation);queue.current=result.catch(()=>{});return result;
 },[owner,savePreferences]);
 const reconciled=useMemo(()=>reconcileSources(activities,{owner,vehicles,links:metadata.sourceLinks||[]}),[activities,owner,vehicles,metadata.sourceLinks]);
 const model=useMemo(()=>{const own=buildJourneys(reconciled.activities,{owner,metadata,places,vehicles,telemetry,projectionCache:projectionCache.values});const shared=reconciled.activities.filter(t=>t.ownerID&&t.ownerID!==owner&&t.sharedToHousehold);const publicPlaces=Object.fromEntries(Object.entries(metadata.places).filter(([,p])=>p.source==='apple-geocoder-mapkit'));const sharedJourneys=[...new Set(shared.map(t=>t.ownerID))].flatMap(sharedOwner=>buildJourneys(shared.filter(t=>t.ownerID===sharedOwner),{owner:sharedOwner,metadata:{...emptyGrouping(sharedOwner),places:publicPlaces},places:[],vehicles:[],telemetry}).journeys.map(j=>({...j,readOnly:true})));return {...own,journeys:[...own.journeys,...sharedJourneys]};},[reconciled.activities,owner,metadata,places,vehicles,telemetry,projectionCache]);
 const fingerprint=JSON.stringify(activities.map(t=>[t.id,t.updatedAt,t.points?.length,t.endedAt]));
 useEffect(()=>{
  if(!recorderAvailable()||!owner)return;let alive=true,timer;
  async function enrich(){
   // Sequential lookups avoid geocoder throttling; results are cached per account.
   const context={owner,metadata:current.current,places,vehicles,telemetry:[]};
   const candidates=activities.flatMap(t=>{
    const points=t.points||[];if(!points.length||t.endedAt==null||t.state==='recording'||(t.ownerID||t.owner_id)&& (t.ownerID||t.owner_id)!==owner)return [];
    const recordedStops=nativeStops(t,context);
    const stopIndexes=new Set(recordedStops.map(stop=>stop.pointIndex));
    const indexes=recognitionSampleIndexes(t,[...internalStops(t,context),...recordedStops]);
    return indexes.map(index=>({id:t.id,index,point:points[index],stop:stopIndexes.has(index),
      cloud:t.source!=='device'&&t.source!=='simulator'}));
   });
   // Prioritise actual recorded stops ahead of generic route samples, including
   // when the same coordinate appears in both lists.
   candidates.sort((a,b)=>Number(b.stop)-Number(a.stop));
   const seen=new Set();
   for(const c of candidates){
    if(!alive)return;const key=placeKey(c.point);if(!key||seen.has(key))continue;seen.add(key);
    const cached=current.current.places[key];if(!lookupDue(cached)&&!(c.stop&&cached?.source!=='saved-place'&&cached?.stopLookup!==STOP_LOOKUP_VERSION&&!(cached?.retryAfter>Date.now())))continue;
    try{const place=await recorder.recogniseTripPlace(c.id,c.index,c.cloud?c.point:null,c.stop);if(!alive)return;await persist(meta=>({...meta,places:{...meta.places,[key]:cachedLookup({...place,...(c.stop?{stopLookup:STOP_LOOKUP_VERSION}:{})})}}));}
    catch{if(alive)await persist(meta=>({...meta,places:{...meta.places,[key]:{...cached,retryAfter:Date.now()+5*60000}}})).catch(()=>{});}
    await new Promise(resolve=>setTimeout(resolve,1200));
   }
   // Road estimates for GPS gaps in drives (gapReconstruction.js), newest first,
   // a bounded number per cycle and within the cache budget, so neither Apple's
   // directions throttle nor the account metadata limit is reached.
   const live=new Set(activities.map(t=>t.id)),week=Date.now()-7*86400000;
   const orphans=Object.entries(current.current.roads||{}).filter(([key,r])=>!live.has(key.slice(0,key.lastIndexOf(':',key.lastIndexOf(':')-1)))&&(r.lookedUpAt||0)<week).map(([key])=>key);
   // Never while the list is still loading: an empty list is not "all deleted".
   if(alive&&activities.length&&orphans.length)await persist(meta=>{const roads={...meta.roads};for(const key of orphans)delete roads[key];return {...meta,roads};}).catch(()=>{});
   const drives=activities.filter(t=>!(t.ownerID||t.owner_id)||(t.ownerID||t.owner_id)===owner).sort((a,b)=>b.startedAt-a.startedAt);
   let lookups=0;
   roads: for(const t of drives)for(const gap of routeGaps(t)){
    if(!alive)return;if(lookups>=20)break roads;
    const key=gapKey(t.id,gap),record=current.current.roads?.[key];
    if(!roadLookupDue(record)||(!record&&JSON.stringify(current.current.roads||{}).length>ROAD_CACHE_BYTES))continue;
    lookups++;
    try{const result=await recorder.roadRoute(gap.from,gap.to);if(!alive)return;await persist(meta=>({...meta,roads:{...meta.roads,[key]:roadRecord(result?.routes||[],gap)}}));}
    catch{if(alive)await persist(meta=>({...meta,roads:{...meta.roads,[key]:failedRecord(meta.roads?.[key])}})).catch(()=>{});}
    await new Promise(resolve=>setTimeout(resolve,1500));
   }
   if(alive)timer=setTimeout(()=>void enrich(),60000);
  }
  void enrich();return()=>{alive=false;clearTimeout(timer);};
 // Re-run when actual recordings change, not on every two-second polling identity.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[owner,fingerprint]);
 async function act(action){setBusy(true);setError('');try{await persist(meta=>changeGrouping(meta,action,{activities,owner,vehicles,places}));return true;}catch(e){setError(e.message||'Journey change could not be saved.');return false;}finally{setBusy(false);}}
 return {...model,records:reconciled.activities,sourceSuggestions:reconciled.suggestions,metadata,act,busy,error};
}
