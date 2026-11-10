import {Capacitor} from '@capacitor/core';
import {App as NativeApp} from '@capacitor/app';
// Invalidate consumers only after the server and durable local receipt agree.
export const SEGMENTS_CHANGED='letm3go:segments-changed';
export const notifySegmentsChanged=()=>window.dispatchEvent(new Event(SEGMENTS_CHANGED));
export function watchSegmentRefresh(refresh,{interval=60000}={}){
 let alive=true,listener;
 const visible=(reason='event')=>{if(alive&&document.visibilityState!=='hidden'&&navigator.onLine)refresh(typeof reason==='string'?reason:'event');};
 for(const event of [SEGMENTS_CHANGED,'focus','pageshow','online'])window.addEventListener(event,visible);
 document.addEventListener('visibilitychange',visible);
 const timer=setInterval(()=>visible('timer'),interval);
 if(Capacitor.isNativePlatform())void NativeApp.addListener('appStateChange',({isActive})=>{if(isActive)visible();})
  .then(handle=>{if(alive)listener=handle;else void handle.remove();}).catch(()=>{});
 return()=>{alive=false;clearInterval(timer);for(const event of [SEGMENTS_CHANGED,'focus','pageshow','online'])window.removeEventListener(event,visible);document.removeEventListener('visibilitychange',visible);void listener?.remove();};
}
