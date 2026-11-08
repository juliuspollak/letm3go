import {useEffect,useRef} from 'react';

const AUTO_DISMISS_MS=3500;

// The newest unread poke, shown briefly over whatever screen is open.
export default function PokeOverlay({poke,onDismiss}){
 const dismiss=useRef(onDismiss);
 useEffect(()=>{dismiss.current=onDismiss;},[onDismiss]);
 useEffect(()=>{
  if(!poke)return undefined;
  const timer=setTimeout(()=>dismiss.current(),AUTO_DISMISS_MS);
  return()=>clearTimeout(timer);
 },[poke]);
 if(!poke)return null;
 return <div className="poke-layer" role="status" aria-live="polite">
  <button type="button" className="poke-toast" onClick={()=>dismiss.current()}>
   <span className="poke-toast-icon" aria-hidden="true">👋</span>
   <span className="poke-toast-text">{poke.body}</span>
  </button>
 </div>;
}
