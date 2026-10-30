import {useCallback,useEffect,useRef,useState} from 'react';
import {recorder} from './recorder.js';

// Not Now lasts for this foreground session and only for this problem. It lives
// above the Home screen so changing tabs does not bring the warning back, and it
// clears when the app leaves the screen, so the next opening warns again. Each
// problem is logged as shown once per session, however often React re-renders.
export function useRecordingWarning(){
 const [dismissed,setDismissed]=useState('');
 const shown=useRef(new Set());
 useEffect(()=>{
  const left=()=>{if(document.visibilityState==='hidden'){setDismissed('');shown.current.clear();}};
  document.addEventListener('visibilitychange',left);
  return()=>document.removeEventListener('visibilitychange',left);
 },[]);
 const logShown=useCallback(code=>{
  if(shown.current.has(code))return;
  shown.current.add(code);
  void recorder.noteRecordingWarning('shown',code);
 },[]);
 return {dismissed,dismiss:setDismissed,logShown};
}
