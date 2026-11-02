import {useEffect,useRef,useState} from 'react';
import {
 SHEET_DETENTS,adjacentDetent,dragHeight,settleDetent,sheetHeight,sheetStyle
} from '../lib/activitySheet.js';

// The details sheet is the scrolling surface for an activity while the map above
// it stays put. Heights come from lib/activitySheet.js, so the finger drag, the
// keyboard and the regression tests share exactly one model of the three detents.
const viewportHeight=()=>{
 if(typeof window==='undefined')return 0;
 const page=typeof document==='undefined'?null:document.querySelector('.detail-sheet-page');
 // On phones the page is fixed and full-screen with a safe-area padding at the
 // top; that padding is not available to the sheet, so the sheet's budget is the
 // content box, not the raw window. Without this, a full detent plus the notch
 // inset would push the sheet's bottom under the page's clipping edge.
 if(page){
  const style=getComputedStyle(page);
  if(style?.position==='fixed'){
   const height=page.clientHeight||window.innerHeight||0;
   return Math.max(0,height-(parseFloat(style.paddingTop)||0));
  }
 }
 return Math.max(0,window.innerHeight||0);
};
const DETENT_WORDS={peek:'Collapsed',medium:'Medium',full:'Expanded'};

export default function ActivitySheet({initialDetent='medium',onDetentChange,children,label='Activity details'}){
 const [detent,setDetent]=useState(initialDetent);
 // The viewport is measured once and again only when it actually changes, so the
 // height below is derived during render instead of being pushed into state from
 // an effect (which would render twice per rotation for no reason).
 const [viewport,setViewport]=useState(()=>window.innerHeight||0);
 const [dragged,setDragged]=useState(null);
 const height=dragged??sheetHeight(detent,viewport);
 const drag=useRef(null);

 // The first render runs before `.detail-sheet-page` has been committed, so the
 // initial measurement above used the raw window height. A ResizeObserver on that
 // page corrects the first measurement (and any later safe-area/rotation change)
 // from a callback, keeping the first full detent inside the page's clipping edge.
 useEffect(()=>{
  const measure=()=>{setViewport(viewportHeight());setDragged(null);};
  const page=typeof document==='undefined'?null:document.querySelector('.detail-sheet-page');
  const observer=page&&typeof ResizeObserver!=='undefined'?new ResizeObserver(measure):null;
  observer?.observe(page);
  window.addEventListener('resize',measure);
  return()=>{observer?.disconnect();window.removeEventListener('resize',measure);};
 },[]);

 function choose(next){
  setDetent(next);
  setDragged(null);
  onDetentChange?.(next);
 }
 function pointerDown(event){
  setDragged(height);
  drag.current={startHeight:height,startY:event.clientY??0,lastY:event.clientY??0,lastAt:event.timeStamp||Date.now(),velocity:0};
  event.currentTarget.setPointerCapture?.(event.pointerId);
 }
 function pointerMove(event){
  const state=drag.current;
  if(!state)return;
  const y=event.clientY??state.lastY,now=event.timeStamp||Date.now();
  state.velocity=(y-state.lastY)/Math.max(1,now-state.lastAt)*1000;
  state.lastY=y;state.lastAt=now;
  setDragged(dragHeight(state.startHeight,state.startY,y,viewportHeight()));
 }
 function pointerUp(event){
  const state=drag.current;
  if(!state)return;
  drag.current=null;
  const y=event.clientY??state.lastY;
  const currentHeight=dragHeight(state.startHeight,state.startY,y,viewportHeight());
  // Velocity is expressed as "height increasing", matching lib/activitySheet.js,
  // while pointer coordinates grow downwards.
  choose(settleDetent({startHeight:state.startHeight,currentHeight,viewportHeight:viewportHeight(),velocity:-state.velocity}));
 }
 function keyDown(event){
  if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return;
  event.preventDefault();
  choose(adjacentDetent(detent,event.key==='ArrowUp'?1:-1));
 }

 return <section className="activity-sheet" data-detent={detent} style={{...sheetStyle(height),transition:dragged==null?undefined:'none'}} aria-label={label}>
  <div className="activity-sheet-handle" role="slider" tabIndex={0}
   aria-label="Resize activity details" aria-orientation="vertical"
   aria-valuemin={sheetHeight(SHEET_DETENTS[0],viewport)}
   aria-valuemax={sheetHeight(SHEET_DETENTS[SHEET_DETENTS.length-1],viewport)}
   aria-valuenow={Math.round(height)} aria-valuetext={`${DETENT_WORDS[detent]||detent} details`}
   onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
   onPointerCancel={pointerUp} onKeyDown={keyDown}>
   <span className="activity-sheet-grabber" aria-hidden="true"/>
  </div>
  <div className="activity-sheet-body">{children}</div>
 </section>;
}
