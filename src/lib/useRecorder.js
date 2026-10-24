import { useCallback, useEffect, useState } from 'react';
import { emptyRecorder, recorder } from './recorder.js';
export function useRecorder(){
 const [state,setState]=useState(emptyRecorder),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let alive=true;let pending=false;async function refresh(){if(pending)return;pending=true;try{const data=await recorder.getState();if(alive)setState(data);}catch(err){if(alive)setError(err.message||'Unable to read native recorder.');}finally{pending=false;}}void refresh();const timer=setInterval(refresh,2000);window.addEventListener('focus',refresh);return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',refresh);};},[]);
 const run=useCallback(async(method,...args)=>{setBusy(true);setError('');try{const result=await recorder[method](...args);if(result?.trips)setState(result);return result||true;}catch(err){setError(err.message||'Recording action failed.');return null;}finally{setBusy(false);}},[]);
 return {state,run,busy,error};
}
