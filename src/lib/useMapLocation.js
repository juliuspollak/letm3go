import {useCallback,useEffect,useRef,useState} from 'react';
import {App as NativeApp} from '@capacitor/app';
import {recorder,recorderAvailable} from './recorder.js';

// Viewing your own position never changes friend/household sharing consent.
export function useMapLocation(owner,enabled,permission){
 const [result,setResult]=useState({owner:null,position:null,loading:false,error:''});
 const request=useRef(0);
 const cancel=useCallback(()=>{request.current+=1;},[]);
 const locate=useCallback(async()=>{
  if(!owner||!recorderAvailable())return null;
  const version=++request.current;
  setResult(old=>({owner,position:old.owner===owner?old.position:null,loading:true,error:''}));
  try{
   const position=await recorder.currentPosition();
   if(version!==request.current)return null;
   if(!Number.isFinite(position?.latitude)||!Number.isFinite(position?.longitude)||Math.abs(position.latitude)>90||Math.abs(position.longitude)>180||!Number.isFinite(position.timestamp)||Math.abs(Date.now()/1000-position.timestamp)>30)throw new Error('A recent location is not available yet. Try the location button again.');
   setResult({owner,position,loading:false,error:''});return position;
  }catch(error){if(version===request.current)setResult(old=>({...old,owner,loading:false,error:error.message||'Location unavailable.'}));return null;}
 },[owner]);
 useEffect(()=>{
  // Automatic startup must not display a new permission prompt.
  if(!enabled||!['always','whenInUse'].includes(permission)||!recorderAvailable())return;
  let alive=true,listener;
  const first=setTimeout(()=>void locate(),0),timer=setInterval(()=>{if(document.visibilityState!=='hidden')void locate();},30000);
  const visible=()=>{if(document.visibilityState!=='hidden')void locate();};
  document.addEventListener('visibilitychange',visible);
  void NativeApp.addListener('appStateChange',({isActive})=>{if(isActive)void locate();}).then(handle=>{if(alive)listener=handle;else void handle.remove();}).catch(()=>{});
  return()=>{alive=false;cancel();clearTimeout(first);clearInterval(timer);document.removeEventListener('visibilitychange',visible);void listener?.remove();};
 },[enabled,permission,locate,cancel]);
 useEffect(()=>cancel,[owner,cancel]);
 return {position:result.owner===owner?result.position:null,loading:result.owner===owner&&result.loading,error:result.owner===owner?result.error:'',locate};
}
