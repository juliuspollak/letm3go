import { useEffect,useRef } from 'react';
export default function SwipeBack({onBack,children}){
 const root=useRef(null),back=useRef(onBack);
 useEffect(()=>{back.current=onBack;},[onBack]);
 useEffect(()=>{
  const node=root.current;let gesture=null,timer=null;
  function reset(){gesture=null;node.style.transition='transform 180ms ease-out';node.style.transform='';}
  function start(e){
   if(timer||e.touches.length!==1||document.querySelector('[aria-modal="true"]')||!window.matchMedia('(max-width:760px)').matches)return;
   const p=e.touches[0];
   if(p.clientX>32||e.target.closest('button,input,textarea,select,a,[contenteditable=true]'))return;
   gesture={x:p.clientX,y:p.clientY,distance:0,time:performance.now(),dragging:false};
  }
  function move(e){
   if(!gesture)return;if(e.touches.length!==1){reset();return;}
   const p=e.touches[0],dx=p.clientX-gesture.x,dy=Math.abs(p.clientY-gesture.y);
   if(!gesture.dragging){if(dx<0||dy>Math.max(12,dx)){reset();return;}if(dx<10)return;gesture.dragging=true;}
   e.preventDefault();gesture.distance=Math.max(0,dx);node.style.transition='none';node.style.transform=`translate3d(${gesture.distance}px,0,0)`;
  }
  function end(){if(!gesture)return;const {distance,time,dragging}=gesture;if(dragging&&(distance>window.innerWidth*.3||(distance>55&&distance/Math.max(1,performance.now()-time)>.65))){gesture=null;node.style.transition='transform 180ms ease-out';node.style.transform=`translate3d(${window.innerWidth}px,0,0)`;timer=setTimeout(()=>back.current(),180);}else reset();}
  window.addEventListener('touchstart',start,{passive:true});window.addEventListener('touchmove',move,{passive:false});window.addEventListener('touchend',end);window.addEventListener('touchcancel',reset);
  return()=>{clearTimeout(timer);window.removeEventListener('touchstart',start);window.removeEventListener('touchmove',move);window.removeEventListener('touchend',end);window.removeEventListener('touchcancel',reset);};
 },[]);
 return <div className="swipe-back-page" ref={root}>{children}</div>;
}
