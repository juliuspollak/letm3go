import {useEffect,useState} from 'react';
// Full-screen loading state. The markup and classes match the launch splash in
// index.html (styled there so it paints before the bundle loads), so the hand-over
// from the splash to React is seamless. After a few seconds it says so, instead of
// leaving a screen that looks frozen.
const SLOW_AFTER_MS=4000;
export default function LoadingScreen({message='Starting…',slowMessage='Still working. This is taking longer than usual, and your journeys are safe on this device.',slowAfter=SLOW_AFTER_MS}){
 // Remember which message has been waiting too long; a new message starts the wait again.
 const [slowFor,setSlowFor]=useState(null),slow=slowFor===message;
 useEffect(()=>{const timer=setTimeout(()=>setSlowFor(message),slowAfter);return()=>clearTimeout(timer);},[message,slowAfter]);
 return <main className="boot auth-loading" aria-busy="true">
  <div className="boot-mark"><span className="boot-ring"/><svg className="boot-glyph" viewBox="0 0 28 28" fill="none" aria-hidden="true" focusable="false"><path d="M5 22h3a8 8 0 0 0 8-8V6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/><path d="m10.5 11.5 5.5-5.5 5.5 5.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
  <span className="boot-word">letm<b>3</b>go</span>
  <div className="boot-bar" aria-hidden="true"/>
  <p className="boot-text" role="status">{slow?slowMessage:message}</p>
 </main>;
}
// A thin bar across the top of the screen for work that continues behind a screen that is
// already usable. It fades in after half a second, so quick loads never flash it.
export function TopProgress({active}){return active?<div className="boot-top" role="progressbar" aria-label="Loading"/>:null;}
