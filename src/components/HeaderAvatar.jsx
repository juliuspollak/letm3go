import {useEffect,useRef} from 'react';
import {badgeText} from '../lib/notifications.js';

// The profile bubble in the header, with the unread notification count at its
// lower right. When the count rises (a new notification while the app is open,
// or found on return to the app) the bubble wiggles once, gently; never on a
// fall, never continuously, and not at all with Reduce Motion on.
const WIGGLE=[{transform:'rotate(0)'},{transform:'rotate(-9deg)'},{transform:'rotate(7deg)'},{transform:'rotate(-4deg)'},{transform:'rotate(0)'}];
function reducedMotion(){
 try{return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;}catch{return false;}
}
export default function HeaderAvatar({count=0,onOpen,children}){
 const bubble=useRef(null);
 const previous=useRef(count);
 useEffect(()=>{
  const rose=count>previous.current;
  previous.current=count;
  if(!rose||reducedMotion())return;
  bubble.current?.animate?.(WIGGLE,{duration:650,easing:'ease-in-out',iterations:1});
 },[count]);
 return <button type="button" ref={bubble} className="avatar header-avatar" aria-label={count>0?`Open profile, ${count} new notification${count===1?'':'s'}`:'Open profile'} onClick={onOpen}>
  {children}
  {count>0&&<span className="notification-badge" aria-hidden="true">{badgeText(count)}</span>}
 </button>;
}
