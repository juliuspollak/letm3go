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
 return [t.id,t.updatedAt,t.startedAt,t.points?.length,t.endedAt,t.state,t.durationSeconds,t.distanceMeters,t.activity,t.details?.provisional,t.details?.continuationEndsAt,t.details?.userCorrected,t.details?.visibility,t.details?.coverPhotoID,t.details?.visibleRouteStart,t.details?.visibleRouteEnd,(t.details?.photos||[]).length].join(':');
}
function snapshotKey(data){
 if(!data)return '';
 const svc=data.trackingServices||{};
 return [
  data.ownerID,data.permission,data.precise,data.storageReady,
  data.automaticEnabled,data.automaticAvailable,data.automaticVerified,
  data.automaticState,data.automaticSampling,data.automaticSettledTripID,
  data.automaticSettledAt,data.automaticContinuationEndsAt,
  data.motionAvailable,data.motionPermission,data.motionTypes?.join(','),data.motionConfidence,data.motionTimestamp,
  data.backgroundEnabled,data.backgroundRecording,data.locationServices,data.applicationState,data.backgroundSession,data.commit,
  data.gpsReason,data.indicatorRequested,data.lastTrackingEvent,data.lastTrackingEventAt,
  data.error,data.recovery,data.accuracy,data.lastFixAt,data.currentSpeed,
  tripKey(data.active),tripKey(data.automaticTrip),
  (data.trips||[]).map(tripKey).join('|'),
  (data.places||[]).map(p=>[p.id,p.name,p.kind,p.latitude,p.longitude,p.radius].join(':')).join('|'),
  (data.deletedIDs||[]).join(','),
  svc.continuousGPSRequested,svc.pausedByIOS,svc.significantChangesRequested,svc.visitsRequested,svc.motionRequested,svc.registeredRegions,svc.automaticPauseEnabled,svc.lastExecutionGapSeconds,
  data.nativeFamilySharing?.armed,data.nativeFamilySharing?.uploadInFlight,data.nativeFamilySharing?.mode,data.nativeFamilySharing?.lastUploadOkAt,data.nativeFamilySharing?.status
 ].join('~');
}
function lockedSnapshot(data){
 return {...emptyRecorder,version:data?.version||emptyRecorder.version,build:data?.build||emptyRecorder.build,permission:data?.permission||'locked',storageReady:false,nativeBinding:data?.nativeBinding||null,error:data?.error||''};
}

export function useRecorder(ownerID,onBindingRequired){
 const [state,setState]=useState(emptyRecorder),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lastKey=useRef('');
 const rebindAttempt=useRef(null);
 const requestRebind=useCallback(actualOwner=>{
  if(!ownerID||!onBindingRequired)return;
  const key=`${ownerID.toLowerCase()}:${String(actualOwner||'unbound').toLowerCase()}`;
  if(rebindAttempt.current===key)return;
  rebindAttempt.current=key;
  void Promise.resolve().then(()=>onBindingRequired(ownerID)).catch(err=>setError(err?.message||'Unable to reopen private activity storage.'));
 },[ownerID,onBindingRequired]);
 useEffect(()=>{
  let alive=true,pending=false,requestID=0,startedAt=0;
  async function refresh(force=false){
   if(!alive||(!force&&document.visibilityState==='hidden'))return;
   // A suspended WebView can leave an old bridge request unresolved. A native
   // foreground event starts a fresh read; late responses cannot replace it.
   if(pending&&!force&&Date.now()-startedAt<10000)return;
   const id=++requestID;pending=true;startedAt=Date.now();
   try{
    const data=await recorder.getState();
    if(!alive||id!==requestID)return;
    if(recorderAvailable()&&ownerID&&data.ownerID?.toLowerCase()!==ownerID.toLowerCase()){
     lastKey.current='';setState(lockedSnapshot(data));requestRebind(data.ownerID);throw new Error(data.ownerID?'Private recorder account does not match this sign-in. Activity storage remains locked.':'Native activity storage is locked / not bound to this sign-in. Existing recordings were not cleared.');
    }
    rebindAttempt.current=null;
    setError('');
    // Skip an identical poll: keeps the state reference stable so memoised
    // journey lists and maps do not recompute while nothing actually changed.
    const key=snapshotKey(data);
    if(key===lastKey.current)return;
    lastKey.current=key;
    setState(data);
   }catch(err){if(alive&&id===requestID)setError(err.message||'Unable to read native recorder.');}
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
  return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',visible);window.removeEventListener('pageshow',visible);document.removeEventListener('visibilitychange',visible);void listener?.remove();void journeyListener?.remove();};
 },[ownerID,requestRebind]);
 const run=useCallback(async(method,...args)=>{setBusy(true);setError('');try{const result=await recorder[method](...args);if(result?.trips){if(recorderAvailable()&&ownerID&&result.ownerID?.toLowerCase()!==ownerID.toLowerCase()){setState(lockedSnapshot(result));requestRebind(result.ownerID);throw new Error('Private recorder account changed. Activity storage remains locked.');}setState(result);}return result||true;}catch(err){setError(err.message||'Recording action failed.');return null;}finally{setBusy(false);}},[ownerID,requestRebind]);
 // A forced read that ignores the snapshot-key skip. Used by Diagnostics so the
 // debug-only counters (trackingUsage, recorderDiagnostics) refresh on open even
 // though they are excluded from routine polling.
 const refresh=useCallback(async()=>{
  if(!recorderAvailable())return;
  try{
   const data=await recorder.getState();
   if(ownerID&&data.ownerID?.toLowerCase()!==ownerID.toLowerCase()){lastKey.current='';setState(lockedSnapshot(data));requestRebind(data.ownerID);setError(data.ownerID?'Private recorder account does not match this sign-in. Activity storage remains locked.':'Native activity storage is locked / not bound to this sign-in. Existing recordings were not cleared.');return;}
   rebindAttempt.current=null;
   setError('');
   lastKey.current=snapshotKey(data);
   setState(data);
  }catch(err){setError(err.message||'Unable to read native recorder.');}
 },[ownerID,requestRebind]);

 return {state,run,busy,error,refresh};
}
