import { useEffect, useRef } from 'react';
export default function DismissibleSheet({label,onClose,children}){
 const root=useRef(null),close=useRef(onClose);
 useEffect(()=>{close.current=onClose;},[onClose]);
 useEffect(()=>{
  const sheet=root.current;let gesture=null,timer=null;
  function reset(){sheet.style.transition='transform 180ms ease-out';sheet.style.transform='';gesture=null;}
  function start(event){
   if(event.touches.length!==1){reset();return;}
   if(timer||sheet.scrollTop>0||!window.matchMedia('(max-width:760px)').matches)return;
   if(event.target.closest('button,input,textarea,select,a,[contenteditable=true],.leaflet-container'))return;
   const point=event.touches[0];gesture={x:point.clientX,y:point.clientY,time:performance.now(),distance:0,dragging:false};
  }
  function move(event){
   if(!gesture)return;
   if(event.touches.length!==1){reset();return;}
   const point=event.touches[0],dy=point.clientY-gesture.y,dx=Math.abs(point.clientX-gesture.x);
   if(!gesture.dragging){if(dy<0||dx>Math.max(12,dy)){gesture=null;return;}if(dy<8)return;gesture.dragging=true;}
   event.preventDefault();gesture.distance=Math.max(0,dy);
   sheet.style.transition='none';sheet.style.transform=`translate3d(0,${gesture.distance}px,0)`;
  }
  function end(){
   if(!gesture)return;
   const {distance,time,dragging}=gesture;
   const threshold=Math.min(120,(sheet.clientHeight||400)*0.25);
   const velocity=distance/Math.max(1,performance.now()-time);
   if(dragging&&(distance>=threshold||(distance>40&&velocity>0.7))){
    gesture=null;sheet.style.transition='transform 180ms ease-out';sheet.style.transform=`translate3d(0,${sheet.clientHeight||window.innerHeight}px,0)`;
    timer=setTimeout(()=>close.current(),180);
   }else reset();
  }
  sheet.addEventListener('touchstart',start,{passive:true});sheet.addEventListener('touchmove',move,{passive:false});sheet.addEventListener('touchend',end);sheet.addEventListener('touchcancel',reset);
  return()=>{clearTimeout(timer);sheet.removeEventListener('touchstart',start);sheet.removeEventListener('touchmove',move);sheet.removeEventListener('touchend',end);sheet.removeEventListener('touchcancel',reset);};
 },[]);
 return <section ref={root} className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={event=>event.stopPropagation()}><div className="sheet-grab-handle" aria-hidden="true"><span/></div>{children}</section>;
}
