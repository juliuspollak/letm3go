import { useCallback, useEffect, useState } from 'react';
import { emptyRecorder, recorder, recorderAvailable } from './recorder.js';
export function useRecorder(ownerID){
 const [state,setState]=useState(emptyRecorder),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let alive=true;let pending=false;async function refresh(){if(pending||document.visibilityState==='hidden')return;pending=true;try{const data=await recorder.getState();if(alive){if(recorderAvailable()&&ownerID&&data.ownerID?.toLowerCase()!==ownerID.toLowerCase()){setState(emptyRecorder);throw new Error('Private recorder account does not match this sign-in. Reauthenticate.');}setState(data);}}catch(err){if(alive)setError(err.message||'Unable to read native recorder.');}finally{pending=false;}}void refresh();const timer=setInterval(refresh,2000);window.addEventListener('focus',refresh);return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',refresh);};},[ownerID]);
 const run=useCallback(async(method,...args)=>{setBusy(true);setError('');try{const result=await recorder[method](...args);if(result?.trips){if(recorderAvailable()&&ownerID&&result.ownerID?.toLowerCase()!==ownerID.toLowerCase()){setState(emptyRecorder);throw new Error('Private recorder account changed.');}setState(result);}return result||true;}catch(err){setError(err.message||'Recording action failed.');return null;}finally{setBusy(false);}},[ownerID]);
 return {state,run,busy,error};
}
