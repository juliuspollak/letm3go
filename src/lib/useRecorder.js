import { useCallback, useEffect, useRef, useState } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { emptyRecorder, onJourneysChanged, recorder, recorderAvailable } from './recorder.js';

// A cheap, point-free fingerprint of the snapshot. It covers every field that
// affects the rendered UI (journeys, places, permission, motion, sampling state,
// live recording) but omits the debug-only live counters (`trackingUsage`,
// `recorderDiagnostics`) that advance on every poll even when nothing changed.
// This lets the poll skip `setState` — and therefore skip re-rendering the whole
// app — while the recorder is idle.
function tripKey(t){
 if(!t)return '';
 // Covers live changes that do not bump `updatedAt` (points.length, durationSeconds,
 // distanceMeters, state) plus everything `updatedAt` reflects (edits, route trim,
 // equipment, photos). The visible-route indices are listed explicitly as defence
 // in case a future trim path forgets to advance `updatedAt`.
 return [t.id,t.source,t.recordingMode,t.title,t.updatedAt,t.startedAt,t.points?.length,t.endedAt,t.state,t.durationSeconds,t.distanceMeters,t.activity,t.details?.provisional,t.details?.continuationEndsAt,t.details?.userCorrected,t.details?.visibility,t.details?.coverPhotoID,t.details?.visibleRouteStart,t.details?.visibleRouteEnd,(t.details?.photos||[]).length,t.details?.heartRate?.samples?.length,t.details?.unverifiedHeartRate?.samples?.length,t.details?.titleEdited,JSON.stringify(t.details?.energy),JSON.stringify(t.details?.unverifiedEnergy),JSON.stringify(t.details?.wholeWorkoutEnergy),JSON.stringify(t.details?.unverifiedWholeWorkoutEnergy)].join(':');
}
export function snapshotKey(data){
 if(!data)return '';
 const svc=data.trackingServices||{};
 return [
  data.ownerID,data.historyToken,data.sharedActivity,data.permission,data.precise,data.storageReady,JSON.stringify(data.recordingHealth),
  data.automaticEnabled,data.automaticAvailable,data.automaticVerified,
  data.automaticState,data.automaticSampling,data.automaticSettledTripID,
  data.automaticSettledAt,data.automaticContinuationEndsAt,
  data.motionAvailable,data.motionPermission,data.motionTypes?.join(','),data.motionConfidence,data.motionTimestamp,
  data.backgroundEnabled,data.backgroundRecording,data.locationServices,data.applicationState,data.backgroundSession,data.commit,
  data.gpsReason,data.indicatorRequested,data.lastTrackingEvent,data.lastTrackingEventAt,
  data.locationMode,data.locationIndicator?.reason,
  data.automaticPendingWalk,data.place?.state,data.place?.radiusMeters,data.place?.settled,data.place?.lastDecision,
  data.recordingElsewhere?.sessionID,data.recordingElsewhere?.state,data.recordingElsewhere?.activity,
  data.error,data.recovery,data.accuracy,data.lastFixAt,data.currentSpeed,
  tripKey(data.active),tripKey(data.automaticTrip),
  (data.trips||[]).map(tripKey).join('|'),
  (data.places||[]).map(p=>[p.id,p.name,p.kind,p.latitude,p.longitude,p.radius].join(':')).join('|'),
  (data.deletedIDs||[]).join(','),
  svc.continuousGPSRequested,svc.pausedByIOS,svc.significantChangesRequested,svc.visitsRequested,svc.motionRequested,svc.registeredRegions,svc.automaticPauseEnabled,svc.lastExecutionGapSeconds,
  data.nativeFamilySharing?.armed,data.nativeFamilySharing?.uploadInFlight,data.nativeFamilySharing?.mode,data.nativeFamilySharing?.lastUploadOkAt,data.nativeFamilySharing?.status,
 // Adaptive engine status; time in state at minute resolution.
 data.adaptive?.enabled,data.adaptive?.state,data.adaptive?.engine,data.adaptive?.liveUpdatesRunning,data.adaptive?.coreLocationStationary,data.adaptive?.placeRegionMonitored,
 data.adaptive?.standbyWakes,data.adaptive?.liveUpdatesFailures,data.adaptive?.lastDepartureLatency?.at,Math.floor((data.adaptive?.secondsInState||0)/60),
 // Passive rest and Home Wi-Fi; stillness at minute resolution.
 data.passiveRest?.enabled,data.passiveRest?.active,data.passiveRest?.restConfirmed,data.passiveRest?.retainReason,data.passiveRest?.serviceSession,
 data.passiveRest?.keepAliveRunning,data.passiveRest?.sessionReleases,data.passiveRest?.lastPreciseReason,Math.floor((data.passiveRest?.stillSeconds||0)/60),
 data.passiveRest?.wifi?.configured,data.passiveRest?.wifi?.match,data.passiveRest?.wifi?.observedAt
 ].join('~');
}
// Preserve immutable history across live-status polls. This also supports older
// native builds returning full arrays: unchanged records retain their identities.
export function reconcileRecorderSnapshot(previous,data){
 const sameOwner=(previous?.ownerID||'').toLowerCase()===(data.ownerID||'').toLowerCase();
 if(data.historyUnchanged){
  if(!sameOwner||!data.historyToken||data.historyToken!==previous?.historyToken)throw new Error('Activity history cache changed. Refresh to reload your activities.');
  data={...data,trips:previous.trips,historyUnchanged:false};
 }
 if(!sameOwner)return data;
 const old=new Map((previous.trips||[]).map(t=>[t.id,t]));
 const trips=(data.trips||[]).map(t=>{const prior=old.get(t.id);return prior&&tripKey(prior)===tripKey(t)?prior:t;});
 const stable=trips.length===previous.trips?.length&&trips.every((t,i)=>t===previous.trips[i]);
 const places=JSON.stringify(data.places||[])===JSON.stringify(previous.places||[])?previous.places:data.places;
 const deletedIDs=(data.deletedIDs||[]).join('|')===(previous.deletedIDs||[]).join('|')?previous.deletedIDs:data.deletedIDs;
 return {...data,trips:stable?previous.trips:trips,places,deletedIDs};
}
function lockedSnapshot(data){
 return {...emptyRecorder,version:data?.version||emptyRecorder.version,build:data?.build||emptyRecorder.build,permission:data?.permission||'locked',storageReady:false,nativeBinding:data?.nativeBinding||null,error:data?.error||''};
}

export function useRecorder(ownerID,onBindingRequired){
 const [state,setState]=useState(emptyRecorder),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lastKey=useRef(''),accepted=useRef(emptyRecorder),generation=useRef(0),readRequest=useRef(0),actionSequence=useRef(0);
 // Why the last action failed has to be readable in the same tick the awaited
 // `run(...)` resolves, before React re-renders, so it lives in a ref behind a
 // getter instead of in state (state would still hold the previous render's value).
 const failure=useRef('');
 const rebindAttempt=useRef(null);
 const requestRebind=useCallback(actualOwner=>{
  if(!ownerID||!onBindingRequired)return;
  const key=`${ownerID.toLowerCase()}:${String(actualOwner||'unbound').toLowerCase()}`;
  if(rebindAttempt.current===key)return;
  rebindAttempt.current=key;
  void Promise.resolve().then(()=>onBindingRequired(ownerID)).catch(err=>setError(err?.message||'Unable to reopen private activity storage.'));
 },[ownerID,onBindingRequired]);
 useEffect(()=>{
  recorder.forgetPosition?.();
  generation.current+=1;
  if(accepted.current.ownerID!==ownerID){accepted.current=emptyRecorder;lastKey.current='';}
  let alive=true,pending=false,requestID=0,startedAt=0;
  async function refresh(force=false){
   if(!alive||(!force&&document.visibilityState==='hidden'))return;
   // A suspended WebView can leave an old bridge request unresolved. A native
   // foreground event starts a fresh read; late responses cannot replace it.
   if(pending&&!force&&Date.now()-startedAt<10000)return;
   const id=++requestID;pending=true;startedAt=Date.now();
   const epoch=generation.current,request=++readRequest.current;
   try{
    const incoming=await recorder.getState(accepted.current.historyToken?{historyToken:accepted.current.historyToken}:undefined);
    if(!alive||id!==requestID||epoch!==generation.current||request!==readRequest.current)return;
    const data=incoming;
    if(recorderAvailable()&&ownerID&&data.ownerID?.toLowerCase()!==ownerID.toLowerCase()){
     lastKey.current='';setState(lockedSnapshot(data));requestRebind(data.ownerID);throw new Error(data.ownerID?'Private recorder account does not match this sign-in. Activity storage remains locked.':'Native activity storage is locked / not bound to this sign-in. Existing recordings were not cleared.');
    }
    rebindAttempt.current=null;
    setError('');
    // Skip an identical poll: keeps the state reference stable so memoised
    // journey lists and maps do not recompute while nothing actually changed.
    const next=reconcileRecorderSnapshot(accepted.current,data),key=snapshotKey(next);
    if(key===lastKey.current)return;
    lastKey.current=key;accepted.current=next;
    setState(next);
   }catch(err){if(alive&&id===requestID&&epoch===generation.current&&request===readRequest.current)setError(err.message||'Unable to read native recorder.');}
   finally{if(id===requestID)pending=false;}
  }
  const visible=()=>{if(document.visibilityState!=='hidden')void refresh(true);};
  void refresh();const timer=setInterval(()=>void refresh(),2000);
  window.addEventListener('focus',visible);window.addEventListener('pageshow',visible);document.addEventListener('visibilitychange',visible);
  let listener,journeyListener;
  if(recorderAvailable())void NativeApp.addListener('appStateChange',({isActive})=>{if(isActive)void refresh(true);}).then(handle=>{if(alive)listener=handle;else void handle.remove();}).catch(()=>{});
  // Native pushes settle/continue/finish events, so a journey appears in History
  // as soon as it is published instead of on the next poll or app restart.
  void onJourneysChanged(()=>void refresh(true)).then(handle=>{if(alive)journeyListener=handle;else void handle?.remove();}).catch(()=>{});
  return()=>{recorder.forgetPosition?.();alive=false;generation.current+=1;clearInterval(timer);window.removeEventListener('focus',visible);window.removeEventListener('pageshow',visible);document.removeEventListener('visibilitychange',visible);void listener?.remove();void journeyListener?.remove();};
 },[ownerID,requestRebind]);
 const run=useCallback(async(method,...args)=>{
  const epoch=++generation.current,action=++actionSequence.current;setBusy(true);setError('');failure.current='';
  try{
   const result=await recorder[method](...args,...(['deleteActivity','deleteActivities'].includes(method)?[ownerID]:[]));
   if(epoch!==generation.current)return null;
   if(result?.trips){
    if(recorderAvailable()&&ownerID&&result.ownerID?.toLowerCase()!==ownerID.toLowerCase()){
     accepted.current=emptyRecorder;lastKey.current='';setState(lockedSnapshot(result));requestRebind(result.ownerID);throw new Error('Private recorder account changed. Activity storage remains locked.');
    }
    const next=reconcileRecorderSnapshot(accepted.current,result);accepted.current=next;lastKey.current=snapshotKey(next);setState(next);
   }
   generation.current+=1; // also reject polls started while the mutation ran
   return result||true;
  }catch(err){if(epoch!==generation.current)return null;generation.current+=1;failure.current=err?.message||'Recording action failed.';setError(failure.current);return null;}finally{if(action===actionSequence.current)setBusy(false);}
 },[ownerID,requestRebind]);
 const lastError=useCallback(()=>failure.current,[]);
 // A forced read that ignores the snapshot-key skip. Used by Diagnostics so the
 // debug-only counters (trackingUsage, recorderDiagnostics) refresh on open even
 // though they are excluded from routine polling.
 const refresh=useCallback(async()=>{
  if(!recorderAvailable())return;
  const epoch=generation.current,request=++readRequest.current;
  try{
   const data=await recorder.getState();
   if(epoch!==generation.current||request!==readRequest.current)return;
   if(ownerID&&data.ownerID?.toLowerCase()!==ownerID.toLowerCase()){lastKey.current='';setState(lockedSnapshot(data));requestRebind(data.ownerID);setError(data.ownerID?'Private recorder account does not match this sign-in. Activity storage remains locked.':'Native activity storage is locked / not bound to this sign-in. Existing recordings were not cleared.');return;}
   rebindAttempt.current=null;
   setError('');
   const next=reconcileRecorderSnapshot(accepted.current,data);accepted.current=next;
   lastKey.current=snapshotKey(next);
   setState(next);
  }catch(err){if(epoch===generation.current&&request===readRequest.current)setError(err.message||'Unable to read native recorder.');}
 },[ownerID,requestRebind]);

 return {state,run,busy,error,refresh,lastError};
}
