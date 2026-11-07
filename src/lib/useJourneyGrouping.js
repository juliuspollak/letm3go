import {recognitionSampleIndexes,lookupDue,cachedLookup,failedLookup} from './journeyRecognition.js';
import {reconcileSources} from './fleetJourneys.js';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {buildJourneys,changeGrouping,emptyGrouping,placeKey,parseGrouping,internalStops,nativeStops} from './journeyGrouping.js';
import {recorder,recorderAvailable} from './recorder.js';
import {STOP_LOOKUP_VERSION} from './stopVenueRecognition.js';
import {routeGaps,gapKey,roadLookupDue,roadRecord,failedRecord,estimatedDistance,distanceSnapshot,ROAD_CACHE_BYTES,ROAD_VERSION} from './gapReconstruction.js';
export function useJourneyGrouping({owner,activities,places,vehicles,serialized,savePreferences,telemetry=[]}){
 const projectionCache=useMemo(()=>({owner,values:new Map()}),[owner]);
 const parsed=useMemo(()=>parseGrouping(serialized,owner),[serialized,owner]);
 const metadata=useMemo(()=>parsed??emptyGrouping(owner),[parsed,owner]);
 const readable=parsed!==null;
 // Retain unsaved provider answers across effect restarts, but never accounts.
 const pending=useMemo(()=>({owner,places:{},roads:{},enriched:{},distanceSummaries:{}}),[owner]);
 const [enrichmentError,setEnrichmentError]=useState('');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const currentReadable=useRef(readable);
 const current=useRef(emptyGrouping(owner)),queue=useRef(Promise.resolve());
 useEffect(()=>{current.current=metadata;currentReadable.current=readable;},[metadata,readable]);
 const persist=useCallback(updater=>{
  const operation=async()=>{if(!currentReadable.current)throw new Error('Saved journey metadata could not be read. Nothing was changed.');const next=updater(current.current);if(next.owner!==owner)throw new Error('Account changed.');const value=JSON.stringify(next);if(value.length>900000)throw new Error('Journey metadata is full.');await savePreferences({journeyGrouping:value});current.current=next;return next;};
  const result=queue.current.then(operation,operation);queue.current=result.catch(()=>{});return result;
 },[owner,savePreferences]);
 const reconciled=useMemo(()=>reconcileSources(activities,{owner,vehicles,links:metadata.sourceLinks||[]}),[activities,owner,vehicles,metadata.sourceLinks]);
 const model=useMemo(()=>{const own=buildJourneys(reconciled.activities,{owner,metadata,places,vehicles,telemetry,projectionCache:projectionCache.values});const shared=reconciled.activities.filter(t=>t.ownerID&&t.ownerID!==owner&&t.sharedToHousehold);const publicPlaces=Object.fromEntries(Object.entries(metadata.places).filter(([,p])=>p.source==='apple-geocoder-mapkit'));const sharedJourneys=[...new Set(shared.map(t=>t.ownerID))].flatMap(sharedOwner=>buildJourneys(shared.filter(t=>t.ownerID===sharedOwner),{owner:sharedOwner,metadata:{...emptyGrouping(sharedOwner),places:publicPlaces},places:[],vehicles:[],telemetry}).journeys.map(j=>({...j,readOnly:true})));return {...own,journeys:[...own.journeys,...sharedJourneys]};},[reconciled.activities,owner,metadata,places,vehicles,telemetry,projectionCache]);
 // Enrichment runs once, for an activity as it is saved: its places and road
 // estimates are retrieved, kept, and the activity is marked done
 // (metadata.enriched); it is never looked up or refreshed again. History is never
 // processed: only activities that finished after this account's cutoff
 // (metadata.enrichFrom, set the first time this build runs) qualify. Recordings
 // in progress and provisional stops are still changing and wait until finalised.
 const enrichFrom=metadata.enrichFrom;
 const settled=t=>Number.isFinite(enrichFrom)&&t.endedAt!=null&&t.endedAt*1000>=enrichFrom&&t.state!=='recording'&&t.details?.provisional!==true&&(!(t.ownerID||t.owner_id)||(t.ownerID||t.owner_id)===owner);
 // Not keyed on the done markers: saving them must not restart a run part-way.
 const fingerprint=JSON.stringify([readable,enrichFrom,activities.filter(settled).map(t=>[t.id,t.updatedAt,t.points?.length])]);
 useEffect(()=>{
  if(!recorderAvailable()||!owner)return;let alive=true,timer;
  // Saved metadata that exists but could not be read as this account's is never
  // written over (it would be replaced by an empty grouping), and nothing runs.
  if(!readable)return;
  // Retrying initialization must not move the cutoff past recordings saved
  // while the first write was failing.
  const initialCutoff=Date.now();
  // Results are saved in batches, not once per lookup: each save re-renders the
  // app and rebuilds every journey. A save from a changed account is refused.
  let since=Date.now();
  const count=()=>Object.keys(pending.places).length+Object.keys(pending.roads).length;
  const flush=async()=>{
   if(!count()&&!Object.keys(pending.enriched).length&&!Object.keys(pending.distanceSummaries).length)return;
   const batch={places:{...pending.places},roads:{...pending.roads},enriched:{...pending.enriched},distanceSummaries:{...pending.distanceSummaries}};
   await persist(meta=>({...meta,places:{...meta.places,...batch.places},roads:{...meta.roads,...batch.roads},enriched:{...meta.enriched,...batch.enriched},distanceSummaries:{...meta.distanceSummaries,...batch.distanceSummaries}}));
   // A newer run may have added answers while this save was queued. Only clear
   // entries confirmed by this write, and keep the entire batch on rejection.
   for(const kind of ['places','roads','enriched','distanceSummaries'])for(const [key,value] of Object.entries(batch[kind])){
    if(pending[kind][key]===value)delete pending[kind][key];
   }
   since=Date.now();
  };
  const hold=async(kind,key,value)=>{
   if(!count())since=Date.now();
   pending[kind][key]=value;
   if(kind!=='enriched'&&kind!=='distanceSummaries'&&(count()>=8||Date.now()-since>=15000))await flush();
  };
  const place=key=>pending.places[key]??current.current.places[key];
  const road=key=>pending.roads[key]??current.current.roads?.[key];
  // Provider requests are spaced (throttling), but not after the last one.
  let requested=false;const space=async ms=>{if(requested)await new Promise(resolve=>setTimeout(resolve,ms));requested=true;};
  async function enrich(){
   if(!Number.isFinite(current.current.enrichFrom)){
    await persist(meta=>Number.isFinite(meta.enrichFrom)?meta:{...meta,enrichFrom:initialCutoff});
    if(alive)setEnrichmentError('');
    return;
   }
   // Retry retained writes before doing any more provider work or done markers.
   await flush();if(!alive)return;
   requested=false;
   const todo=activities.filter(t=>settled(t)&&!current.current.enriched?.[t.id]&&!pending.enriched[t.id]).sort((a,b)=>b.startedAt-a.startedAt);
   let roadLookups=0,next=Infinity;
   for(const t of todo){
    if(!alive)return;
    let waiting=false;
    const points=t.points||[];
    if(points.length){
     const context={owner,metadata:current.current,places,vehicles,telemetry:[]};
     const stops=nativeStops(t,context),stopIndexes=new Set(stops.map(stop=>stop.pointIndex));
     // Recorded stops first, so a stop gets its shopping-centre search even
     // where the same coordinate is also a route sample.
     const samples=recognitionSampleIndexes(t,[...internalStops(t,context),...stops]).map(index=>({index,stop:stopIndexes.has(index)})).sort((a,b)=>Number(b.stop)-Number(a.stop));
     const seen=new Set();
     for(const {index,stop} of samples){
      const key=placeKey(points[index]);if(!key||seen.has(key))continue;seen.add(key);
      const cached=place(key);
      // An answer is final; a recorded stop also needs its stop search once.
      const needed=!cached||lookupDue(cached)||(stop&&cached.source!=='saved-place'&&!cached.stopLookup&&!cached.retryAfter);
      if(!needed){if(cached.retryAfter){waiting=true;next=Math.min(next,cached.retryAfter);}continue;}
      await space(1200);if(!alive)return;
      let result;
      try{const found=await recorder.recogniseTripPlace(t.id,index,t.source!=='device'&&t.source!=='simulator'?points[index]:null,stop);if(!alive)return;result=cachedLookup({...found,...(stop?{stopLookup:STOP_LOOKUP_VERSION}:{})},Date.now(),cached);}
      catch{if(!alive)return;result=failedLookup(cached);}
      await hold('places',key,result);
      if(result.retryAfter){waiting=true;next=Math.min(next,result.retryAfter);}
     }
    }
    // Road estimates for this activity's GPS gaps (gapReconstruction.js), within
    // the cache budget; past it the straight line stands, clearly marked.
    for(const gap of routeGaps(t)){
     if(!alive)return;
     const key=gapKey(t.id,gap),record=road(key);
     if(record&&!roadLookupDue(record)){if(record.retryAfter){waiting=true;next=Math.min(next,record.retryAfter);}continue;}
     // Store full: an explicit final answer (straight line, reported as such), not a silent skip.
     if(!record&&JSON.stringify({...current.current.roads,...pending.roads}).length>ROAD_CACHE_BYTES){await hold('roads',key,{version:ROAD_VERSION,status:'capacityExceeded',lookedUpAt:Date.now()});continue;}
     // At most 20 directions requests a minute; the rest wait for the next run.
     if(roadLookups>=20){waiting=true;next=Math.min(next,Date.now()+60000);continue;}
     roadLookups++;
     await space(1500);if(!alive)return;
     let result;
     try{const found=await recorder.roadRoute(gap.from,gap.to);if(!alive)return;result=roadRecord(found?.routes||[],gap);}
     catch{if(!alive)return;result=failedRecord(record);}
     await hold('roads',key,result);
     if(result.retryAfter){waiting=true;next=Math.min(next,result.retryAfter);}
    }
    // Done: the distance summary is saved once, with the done marker, so the list never rescans this activity's GPS.
    // Only activities with GPS gaps: a summary per gap-free activity would fill the
    // account's journey metadata over a year, and those cost nothing to recompute.
    if(!waiting){const estimate=estimatedDistance(t,{...current.current.roads,...pending.roads});if(estimate)await hold('distanceSummaries',t.id,distanceSnapshot(t,estimate));await hold('enriched',t.id,Date.now());}
   }
   if(alive){await flush();if(alive)setEnrichmentError('');}
   // Nothing runs again unless something is still waiting for a retry.
   if(alive&&Number.isFinite(next))timer=setTimeout(run,Math.max(60000,next-Date.now()));
  }
  // A restart for changed recordings keeps what this run already found.
  const run=()=>enrich().catch(()=>{
   if(!alive)return;
   setEnrichmentError('Activity details could not be saved. Retrying when storage is available.');
   timer=setTimeout(run,60000);
  });
  void run();return()=>{alive=false;clearTimeout(timer);void flush().catch(()=>{});};
 // Re-run when an unfinished activity appears or changes, not on every poll.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[owner,fingerprint]);
 async function act(action){setBusy(true);setError('');try{await persist(meta=>changeGrouping(meta,action,{activities,owner,vehicles,places}));return true;}catch(e){setError(e.message||'Journey change could not be saved.');return false;}finally{setBusy(false);}}
 return {...model,records:reconciled.activities,sourceSuggestions:reconciled.suggestions,metadata,act,busy,error:error||(!readable?'Saved journey metadata could not be read. It has been left unchanged.':enrichmentError)};
}
