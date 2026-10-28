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
 return [t.id,t.updatedAt,t.points?.length,t.endedAt,t.state,t.durationSeconds,t.distanceMeters,t.activity,t.details?.provisional,t.details?.continuationEndsAt,t.details?.userCorrected,t.details?.visibility,t.details?.coverPhotoID,(t.details?.photos||[]).length].join(':');
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
  data.backgroundEnabled,data.backgroundRecording,data.locationServices,data.applicationState,
  data.gpsReason,data.indicatorRequested,data.lastTrackingEvent,data.lastTrackingEventAt,
  data.error,data.recovery,data.accuracy,data.lastFixAt,data.currentSpeed,
  tripKey(data.active),tripKey(data.automaticTrip),
  (data.trips||[]).map(tripKey).join('|'),
  (data.places||[]).map(p=>[p.id,p.name,p.kind,p.latitude,p.longitude,p.radius].join(':')).join('|'),
  (data.deletedIDs||[]).join(','),
  svc.continuousGPSRequested,svc.pausedByIOS,svc.significantChangesRequested,svc.visitsRequested,svc.motionRequested,svc.registeredRegions,
  data.nativeFamilySharing?.armed,data.nativeFamilySharing?.uploadInFlight
 ].join('~');
}

export function useRecorder(ownerID){
 const [state,setState]=useState(emptyRecorder),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lastKey=useRef('');
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
     lastKey.current='';setState(emptyRecorder);throw new Error('Private recorder account does not match this sign-in. Reauthenticate.');
    }
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
 },[ownerID]);
 const run=useCallback(async(method,...args)=>{setBusy(true);setError('');try{const result=await recorder[method](...args);if(result?.trips){if(recorderAvailable()&&ownerID&&result.ownerID?.toLowerCase()!==ownerID.toLowerCase()){setState(emptyRecorder);throw new Error('Private recorder account changed.');}setState(result);}return result||true;}catch(err){setError(err.message||'Recording action failed.');return null;}finally{setBusy(false);}},[ownerID]);
 return {state,run,busy,error};
}
