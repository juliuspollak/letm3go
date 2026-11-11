import {useEffect,useRef} from 'react';

const AUTO_DISMISS_MS=3500;

// The newest unread poke, shown briefly over whatever screen is open.
// `quiet`: the sender's avatar on screen already shows it, so only the timer runs.
export default function PokeOverlay({poke,onDismiss,quiet=false}){
 const dismiss=useRef(onDismiss);
 useEffect(()=>{dismiss.current=onDismiss;},[onDismiss]);
 useEffect(()=>{
  if(!poke)return undefined;
  const timer=setTimeout(()=>dismiss.current(),AUTO_DISMISS_MS);
  return()=>clearTimeout(timer);
 },[poke]);
 if(!poke||quiet)return null;
 // A speech bubble under the profile bubble, with a waving hand, not a bar across the top.
 return <div className="poke-float" role="status" aria-live="polite">
  <button type="button" className="poke-float-bubble" onClick={()=>dismiss.current()}>
   <span className="poke-float-wave" aria-hidden="true">👋</span>
   <span>{String(poke.body||'Someone poked you').replace(/\s*👋\s*$/u,'')}</span>
  </button>
 </div>;
}
