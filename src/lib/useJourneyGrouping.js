import {recognitionSampleIndexes,lookupDue,cachedLookup,failedLookup} from './journeyRecognition.js';
import {reconcileSources} from './fleetJourneys.js';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {buildJourneys,changeGrouping,emptyGrouping,placeKey,validateGrouping,internalStops,nativeStops} from './journeyGrouping.js';
import {commitJourneyChanges} from './journeyMetadataStore.js';
import {supabase} from './supabase.js';
import {recorder,recorderAvailable} from './recorder.js';
import {scopeKey} from './journeyCache.js';
import {STOP_LOOKUP_VERSION} from './stopVenueRecognition.js';
import {routeGaps,gapKey,roadLookupDue,roadRecord,failedRecord,estimatedDistance,distanceSnapshot} from './gapReconstruction.js';
// Journey metadata is read from the cache of Supabase (`metadataValue`) and every change is
// written to Supabase first (commitJourneyChanges); there is no local copy to edit and no
// queue. Offline, a change is refused with a connection message.
export function useJourneyGrouping({owner,activities,processingActivities=activities,places,vehicles,metadataValue,telemetry=[],sync}){
 const projectionCache=useMemo(()=>({owner,values:new Map()}),[owner]);
 const metadata=useMemo(()=>metadataValue??emptyGrouping(owner),[metadataValue,owner]);
 // Retain unsaved provider answers across effect restarts, but never accounts.
 const pending=useMemo(()=>({owner,places:{},roads:{},enriched:{},distanceSummaries:{}}),[owner]);
 // Recordings saved before this moment are history and are never enriched. Fixed per
 // account so a save that fails while offline cannot move it past newer recordings.
 const [initialCutoff]=useState(()=>Date.now());
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const current=useRef(emptyGrouping(owner)),queue=useRef(Promise.resolve());
 useEffect(()=>{current.current=metadata;},[metadata]);
 // The one write path: the change goes to Supabase, and the cache follows its answer.
 // `derived` marks answers the device computed itself (places, roads, summaries).
 const persist=useCallback((updater,{derived=false}={})=>{
  const build=base=>{const next=validateGrouping(updater(base),owner);if(!next||next.owner!==owner)throw new Error('Account changed.');return next;};
  const operation=async()=>{
   await commitJourneyChanges({client:supabase,owner,read:sync.read,write:sync.write,ready:sync.ready},build,{derived});
   current.current=sync.read().metadata;return current.current;
  };
  const result=queue.current.then(operation,operation);queue.current=result.catch(()=>{});return result;
 },[owner,sync]);
 const reconciled=useMemo(()=>reconcileSources(activities,{owner,vehicles,links:metadata.sourceLinks||[]}),[activities,owner,vehicles,metadata.sourceLinks]);
 // Save already-confirmed source associations using the existing pair records.
 // A replacement phone can reuse the decision without downloading both GPS routes.
 const sourceLinks=JSON.stringify(reconciled.activities.filter(t=>t.isReconciled&&t.sourceRecords?.every(source=>source.geometryLoaded!==false)).flatMap(t=>t.sourceRecords.slice(1).map(source=>[t.sourceRecords[0].id,source.id].sort())));
 useEffect(()=>{
  const links=JSON.parse(sourceLinks);if(!links.length)return;
  const missing=links.filter(pair=>!current.current.sourceLinks.some(old=>JSON.stringify([...old].sort())===JSON.stringify(pair)));
  if(missing.length)void persist(meta=>({...meta,sourceLinks:[...new Map([...meta.sourceLinks,...missing].map(pair=>[JSON.stringify([...pair].sort()),pair])).values()]}),{derived:true}).catch(()=>{/* Retried when the associations are next worked out. */});
 },[sourceLinks,sync,persist]);
 const model=useMemo(()=>{const own=buildJourneys(reconciled.activities,{owner,metadata,places,vehicles,telemetry,projectionCache:projectionCache.values});const shared=reconciled.activities.filter(t=>t.ownerID&&t.ownerID!==owner&&t.sharedToHousehold);const publicPlaces=Object.fromEntries(Object.entries(metadata.places).filter(([,p])=>p.source==='apple-geocoder-mapkit'));const sharedJourneys=[...new Set(shared.map(t=>t.ownerID))].flatMap(sharedOwner=>buildJourneys(shared.filter(t=>t.ownerID===sharedOwner),{owner:sharedOwner,metadata:{...emptyGrouping(sharedOwner),places:publicPlaces},places:[],vehicles:[],telemetry}).journeys.map(j=>({...j,readOnly:true})));return {...own,journeys:[...own.journeys,...sharedJourneys]};},[reconciled.activities,owner,metadata,places,vehicles,telemetry,projectionCache]);
 // Enrichment runs once, for an activity as it is saved: its places and road
 // estimates are retrieved, kept, and the activity is marked done
 // (metadata.enriched); it is never looked up or refreshed again. History is never
 // processed: only activities that finished after this account's cutoff
 // (metadata.enrichFrom, set the first time this build runs) qualify. Recordings
 // in progress and provisional stops are still changing and wait until finalised.
 const enrichFrom=metadata.enrichFrom;
 const settled=t=>t.source!=='cloud'&&t.geometryLoaded!==false&&Number.isFinite(enrichFrom)&&t.endedAt!=null&&t.endedAt*1000>=enrichFrom&&t.state!=='recording'&&t.details?.provisional!==true&&(!(t.ownerID||t.owner_id)||(t.ownerID||t.owner_id)===owner);
 // Not keyed on the done markers: saving them must not restart a run part-way.
 const fingerprint=JSON.stringify([enrichFrom,processingActivities.filter(settled).map(t=>[t.id,t.updatedAt,t.points?.length])]);
 useEffect(()=>{
  if(!recorderAvailable()||!owner)return;let alive=true,timer;
  // Answers are saved to Supabase as they are found. One that cannot be saved (offline)
  // stays pending and is retried before any further provider work.
  const flush=async()=>{
   if(!Object.keys(pending.places).length&&!Object.keys(pending.roads).length&&!Object.keys(pending.enriched).length&&!Object.keys(pending.distanceSummaries).length)return;
   const batch={places:{...pending.places},roads:{...pending.roads},enriched:{...pending.enriched},distanceSummaries:{...pending.distanceSummaries}};
   await persist(meta=>({...meta,places:{...meta.places,...batch.places},roads:{...meta.roads,...batch.roads},enriched:{...meta.enriched,...batch.enriched},distanceSummaries:{...meta.distanceSummaries,...batch.distanceSummaries}}),{derived:true});
   // A newer run may have added answers while this save was queued. Only clear
   // entries confirmed by this write, and keep the entire batch on rejection.
   for(const kind of ['places','roads','enriched','distanceSummaries'])for(const [key,value] of Object.entries(batch[kind])){
    if(pending[kind][key]===value)delete pending[kind][key];
   }
  };
  // Answers are kept and saved together (one request per activity, or sooner when many pile
  // up), not one request per lookup: every save is a new revision for the account.
  const count=()=>Object.keys(pending.places).length+Object.keys(pending.roads).length;
  const hold=async(kind,key,value)=>{
   pending[kind][key]=value;
   if(count()>=20)await flush();
  };
  const place=key=>pending.places[key]??current.current.places[key];
  const road=key=>pending.roads[key]??current.current.roads?.[key];
  // Provider requests are spaced (throttling), but not after the last one.
  let requested=false;const space=async ms=>{if(requested)await new Promise(resolve=>setTimeout(resolve,ms));requested=true;};
  async function enrich(){
   if(!Number.isFinite(current.current.enrichFrom)){
    await persist(meta=>Number.isFinite(meta.enrichFrom)?meta:{...meta,enrichFrom:initialCutoff},{derived:true});
    return;
   }
   // Retry retained writes before doing any more provider work or done markers.
   await flush();if(!alive)return;
   requested=false;
   // Eligible: finished after the account's cutoff and not yet marked done. A cloud
   // backup receipt says nothing about enrichment: the backup often finishes first,
   // and treating it as "already processed" left every such activity untagged.
   const todo=processingActivities.filter(t=>settled(t)&&!current.current.enriched?.[t.id]&&!pending.enriched[t.id]&&sync.read().cache?.work?.[t.id]?.state!=='done').sort((a,b)=>b.startedAt-a.startedAt);
   let roadLookups=0,next=Infinity;
   for(const t of todo){
    if(!alive)return;
    await sync.write(latest=>({cache:{...latest.cache,work:{...latest.cache.work,[t.id]:{state:'pending',at:Date.now()}}}}));
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
    // Cloud-backed lists also save the lightweight presentation of gap-free routes.
    if(!waiting){
     const finalMetadata={...current.current,places:{...current.current.places,...pending.places},roads:{...current.current.roads,...pending.roads}};
     const estimate=estimatedDistance(t,finalMetadata.roads);
     {
      const projected=buildJourneys([t],{owner,metadata:finalMetadata,places,vehicles,telemetry:[]}).journeys[0];
      const presentation=projected?{title:projected.title,generatedTitle:projected.generatedTitle,location:projected.location,tags:projected.tags,recognisedStops:(projected.recognisedStops||[]).map(({id,segmentID,afterSegmentID,beforeSegmentID,name,tags,startedAt,endedAt,durationSeconds,verdict,meaningful,nearbyName,charging,pointIndex,latitude,longitude})=>({id,segmentID,afterSegmentID,beforeSegmentID,name,tags,startedAt,endedAt,durationSeconds,verdict,meaningful,nearbyName,charging,pointIndex,latitude,longitude}))}:null;
      await hold('distanceSummaries',t.id,{...distanceSnapshot(t,estimate),presentation});
     }
     await hold('enriched',t.id,Date.now());
     await flush();
     await sync.write(latest=>{
      const keys=new Set((t.points||[]).map(placeKey));
      const places=Object.keys(latest.metadata.places).filter(key=>keys.has(key));
      const prior=latest.cache.scopes[scopeKey([t.id])];
      return {cache:{...latest.cache,work:{...latest.cache.work,[t.id]:{state:'done',at:Date.now()}},scopes:{...latest.cache.scopes,[scopeKey([t.id])]:{ids:prior?.ids||[t.id],details:[t.id],places,at:Date.now(),revision:latest.status.revision,stale:false}}}};
     });
    }
    if(alive)await flush();
   }
   if(alive)await flush();
   // Nothing runs again unless something is still waiting for a retry.
   if(alive&&Number.isFinite(next))timer=setTimeout(run,Math.max(60000,next-Date.now()));
  }
  // A restart for changed recordings keeps what this run already found.
  // Offline or a failed save is not an error to show: the work stays pending and runs again.
  const run=()=>enrich().catch(()=>{
   if(alive)timer=setTimeout(run,60000);
  });
  void run();return()=>{alive=false;clearTimeout(timer);void flush().catch(()=>{});};
 // Re-run when an unfinished activity appears or changes, not on every poll.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[owner,fingerprint]);
 async function act(action){setBusy(true);setError('');try{await persist(meta=>changeGrouping(meta,action,{activities,owner,vehicles,places}));return true;}catch(e){setError(e.message||'Journey change could not be saved.');return false;}finally{setBusy(false);}}
 return {...model,records:reconciled.activities,sourceSuggestions:reconciled.suggestions,sourceContextIncomplete:reconciled.incomplete,metadata,act,busy,error};
}
