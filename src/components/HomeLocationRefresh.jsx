import {useEffect,useRef,useState} from 'react';
import {RefreshCw} from 'lucide-react';

const REFRESH_THRESHOLD=65;
const REFRESH_OFFSET=72;
const pullOffset=distance=>Math.min(96,distance*.78);
const downward=(origin,touch)=>{
 const distance=touch.clientY-origin.y;
 return distance>Math.abs(touch.clientX-origin.x)*1.5?distance:0;
};

export default function HomeLocationRefresh({enabled,onRefresh,children}){
 const main=useRef(null),start=useRef(null),inFlight=useRef(false);
 const [distance,setDistance]=useState(0),[refreshing,setRefreshing]=useState(false),[error,setError]=useState(false);
 useEffect(()=>{
  if(!enabled)return;
  const element=main.current;
  function move(event){
   const origin=start.current;
   if(!origin||event.touches.length!==1)return;
   const touch=event.touches[0];
   const delta=downward(origin,touch);
   if(!origin.dragging&&(window.scrollY>0||!delta&&Math.abs(touch.clientX-origin.x)>10)){
    start.current=null;
    return;
   }
   if(delta<8&&!origin.dragging)return;
   // Once the vertical pull owns the gesture, keep the WebView from rubber-banding behind it.
   origin.dragging=true;
   if(event.cancelable)event.preventDefault();
   setDistance(delta);
  }
  element.addEventListener('touchmove',move,{passive:false});
  return()=>{element.removeEventListener('touchmove',move);start.current=null;setDistance(0);};
 },[enabled]);

 async function refresh(){
  if(!enabled||inFlight.current)return;
  inFlight.current=true;
  setRefreshing(true);
  setError(false);
  try{await onRefresh();}
  catch{setError(true);}
  finally{inFlight.current=false;setRefreshing(false);}
 }
 function beginPull(event){
  if(event.touches.length!==1){cancelPull();return;}
  const touch=event.touches[0];
  start.current=enabled&&!inFlight.current&&window.scrollY<=0&&
   !event.target.closest('input,select,textarea,[role="dialog"]')
   ?{x:touch.clientX,y:touch.clientY,dragging:false}:null;
 }
 function cancelPull(){
  start.current=null;
  setDistance(0);
 }
 function finishPull(event){
  const origin=start.current;
  const touch=event.changedTouches[0];
  cancelPull();
  if(!origin||!touch||event.touches.length||window.scrollY>0&&!origin.dragging)return;
  if(downward(origin,touch)>=REFRESH_THRESHOLD)void refresh();
 }
 const pulling=enabled&&distance>0;
 const spinning=enabled&&refreshing;
 const offset=spinning?REFRESH_OFFSET:pulling?pullOffset(distance):0;
 const progress=Math.min(1,distance/REFRESH_THRESHOLD);
 return <>
  <main ref={main} className={enabled?'home-pull-page':undefined} data-pulling={pulling||undefined} data-offset={offset>0||undefined}
   style={offset?{'--home-pull-offset':`${offset}px`}:undefined}
   onTouchStart={beginPull} onTouchEnd={finishPull} onTouchCancel={cancelPull}>
   {children}
  </main>
  {(pulling||spinning)&&<div className="home-pull-reveal"
   style={{'--home-pull-offset':`${offset}px`,'--home-pull-progress':spinning?1:progress,'--home-pull-turn':`${progress*300}deg`}}>
   <div className="home-pull-indicator" data-ready={spinning||progress>=1} data-refreshing={spinning}
    role={spinning?'status':undefined} aria-hidden={spinning?undefined:true}>
    <RefreshCw size={24} strokeWidth={2.25} aria-hidden="true"/>
    {spinning&&<span className="sr-only">Refreshing locations…</span>}
   </div>
  </div>}
  {enabled&&error&&<div className="home-location-refresh-notice" role="alert">Locations could not be refreshed.</div>}
 </>;
}
