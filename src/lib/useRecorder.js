import { useCallback, useEffect, useState } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { emptyRecorder, onJourneysChanged, recorder, recorderAvailable } from './recorder.js';
export function useRecorder(ownerID){
 const [state,setState]=useState(emptyRecorder),[busy,setBusy]=useState(false),[error,setError]=useState('');
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
     setState(emptyRecorder);throw new Error('Private recorder account does not match this sign-in. Reauthenticate.');
    }
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
