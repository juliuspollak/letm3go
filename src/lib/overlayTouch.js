// Reports where the details sheet's top edge is to the native map, which decides
// at touch-down whether a finger belongs to the map or the sheet. A moving sheet
// changes height every frame, so reports are paced, one at a time, always carrying
// the newest position; the native side treats them as approximate until the final
// `moving:false` report gives the exact edge. An idle sheet sends nothing.
export const BOUNDARY_INTERVAL_MS=48;
export const BOUNDARY_SETTLE_MS=140;

export function createBoundaryReporter(send,{interval=BOUNDARY_INTERVAL_MS,settle=BOUNDARY_SETTLE_MS}={}){
 let wanted=null,delivered=null,sending=false,closed=false,lastAt=-Infinity,pace=null,quiet=null;
 function flush(){
  clearTimeout(pace);pace=null;
  if(closed||sending||!wanted||wanted===delivered)return;
  const wait=lastAt+interval-Date.now();
  if(wanted.moving&&wait>0){pace=setTimeout(flush,wait);return;}
  const state=wanted;
  sending=true;delivered=state;lastAt=Date.now();
  Promise.resolve().then(()=>send(state)).catch(()=>{}).finally(()=>{sending=false;flush();});
 }
 return {
  update(value){
   const height=Math.max(0,Math.round(value));
   if(closed||wanted?.height===height)return;
   const first=!wanted;
   wanted={height,moving:!first};
   clearTimeout(quiet);
   if(!first)quiet=setTimeout(()=>{wanted={height:wanted.height,moving:false};flush();},settle);
   if(!pace)flush();
  },
  dispose(){closed=true;clearTimeout(pace);clearTimeout(quiet);}
 };
}
