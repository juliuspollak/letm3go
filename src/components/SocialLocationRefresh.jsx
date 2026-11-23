import {useRef,useState} from 'react';
import {RefreshCw} from 'lucide-react';

export default function SocialLocationRefresh({onRefresh,children}){
 const start=useRef(null),inFlight=useRef(false);
 const [refreshing,setRefreshing]=useState(false),[error,setError]=useState(false);
 async function refresh(){
  if(inFlight.current)return;
  inFlight.current=true;
  setRefreshing(true);
  setError(false);
  try{await onRefresh();}
  catch{setError(true);}
  finally{inFlight.current=false;setRefreshing(false);}
 }
 function beginPull(event){
  const touch=event.touches[0];
  start.current=event.touches.length===1&&window.scrollY<=0&&
   !event.target.closest('button,a,input,select,textarea,[role="dialog"]')
   ?{x:touch.clientX,y:touch.clientY}:null;
 }
 function finishPull(event){
  const origin=start.current;
  start.current=null;
  const touch=event.changedTouches[0];
  if(!origin||!touch||event.touches.length)return;
  const down=touch.clientY-origin.y;
  if(down>=65&&down>Math.abs(touch.clientX-origin.x)*1.5)void refresh();
 }
 return <div className="social-layout social-redesign" onTouchStart={beginPull} onTouchEnd={finishPull} onTouchCancel={()=>{start.current=null;}}>
  <div className="social-location-refresh">
   <button type="button" className="text-button" disabled={refreshing} onClick={()=>void refresh()}>
    <RefreshCw size={15} aria-hidden="true"/> {refreshing?'Refreshing locations…':'Refresh locations'}
   </button>
   {error&&<p role="alert" className="error">Locations could not be refreshed.</p>}
  </div>
  {children}
 </div>;
}
