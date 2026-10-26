import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from './supabase.js';
import {recorder,recorderAvailable} from './recorder.js';
export function useHouseholdPresence(owner,online,automaticActivity=null,places=[]){
 const lastAutomatic=useRef(undefined), lastPlace=useRef(null), lastPlaceSentAt=useRef(0), locationBusy=useRef(false);
 const [people,setPeople]=useState([]),[self,setSelf]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [liveEnabled,setLiveEnabled]=useState(false),[livePeople,setLivePeople]=useState([]),[liveError,setLiveError]=useState('');
 const liveBusy=useRef(false);
 const refresh=useCallback(async()=>{
  if(!owner||!online||!supabase)return;
  const [mine,others]=await Promise.all([supabase.rpc('my_presence_settings'),supabase.rpc('my_household_presence')]);
  if(mine.error||others.error){setError('Social presence is unavailable. The database migration may not be deployed.');return;}
  setSelf(mine.data?.[0]||{sharing_enabled:false});setPeople(others.data||[]);setError('');
 },[owner,online]);
 useEffect(()=>{if(!online)return;const load=()=>{if(document.visibilityState==='visible')void refresh();};const initial=setTimeout(load,0);const timer=setInterval(load,15000);document.addEventListener('visibilitychange',load);return()=>{clearTimeout(initial);clearInterval(timer);document.removeEventListener('visibilitychange',load);};},[refresh,online]);
 useEffect(()=>{
  if(!owner||!online||!supabase||self?.sharing_enabled!==true){lastAutomatic.current=undefined;lastPlace.current=null;lastPlaceSentAt.current=0;return;}
  if(lastAutomatic.current===automaticActivity)return;
  if(!automaticActivity&&lastPlace.current==='Home')return;
  lastAutomatic.current=automaticActivity;
  if(automaticActivity)lastPlace.current=null;
  let cancelled=false;
  const send=async()=>{
   const {error:failure}=await supabase.rpc('set_household_presence',{p_enabled:true,p_activity:automaticActivity,p_place:null});
   if(failure&&!cancelled)setError('Automatic activity sharing could not update.');
   if(!failure&&!cancelled)void refresh();
  };
  void send();
  return()=>{cancelled=true;};
 },[owner,online,self?.sharing_enabled,automaticActivity,refresh]);

 const homeKey=places.filter(p=>p.kind==='home').map(p=>[p.id,p.latitude,p.longitude,p.radius].join(':')).join('|');
 useEffect(()=>{
  const home=places.find(p=>p.kind==='home');
  if(!owner||!online||!supabase||!recorderAvailable()||!home||self?.sharing_enabled!==true)return;
  let alive=true;
  const check=async()=>{
   if(!alive||document.visibilityState==='hidden'||locationBusy.current||automaticActivity)return;
   locationBusy.current=true;
   try {
    const point=await recorder.currentPosition();
    if(!alive||!point||!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)||point.accuracy>100)return;
    const radians=Math.PI/180,dlat=(point.latitude-home.latitude)*radians,dlon=(point.longitude-home.longitude)*radians;
    const a=Math.sin(dlat/2)**2+Math.cos(point.latitude*radians)*Math.cos(home.latitude*radians)*Math.sin(dlon/2)**2;
    const within=6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))<=Math.max(50,Math.min(2000,Number(home.radius)||150));
    const next=within?'Home':null;
    if(next===lastPlace.current && (!within || Date.now()-lastPlaceSentAt.current<900000))return;
    if(!within&&lastPlace.current!=='Home'&&self?.activity_label!=='At home')return;
    const {error:failure}=await supabase.rpc('set_household_presence',{p_enabled:true,p_activity:within?'At home':null,p_place:next});
    if(!failure&&alive){lastPlace.current=next;lastPlaceSentAt.current=Date.now();void refresh();}
   }catch{/* GPS unavailable: never guess household presence. */}
   finally{locationBusy.current=false;}
  };
  void check();
  const timer=setInterval(()=>void check(),300000);
  const onVisible=()=>{if(document.visibilityState==='visible')void check();};
  document.addEventListener('visibilitychange',onVisible);
  return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);};
 },[owner,online,self?.sharing_enabled,self?.activity_label,automaticActivity,homeKey,refresh]);

 const refreshLive=useCallback(async()=>{
  if(!owner||!online||!supabase)return;
  const [settings,others]=await Promise.all([
   supabase.rpc('my_live_location_settings'),
   supabase.rpc('my_household_live_locations')
  ]);
  if(settings.error||others.error){setLiveError('Precise family location is not available. Apply the live-location migration.');return;}
  setLiveEnabled(settings.data?.[0]?.enabled===true);
  setLivePeople(others.data||[]);
  setLiveError('');
 },[owner,online]);
 useEffect(()=>{
  if(!online)return;
  const poll=()=>{if(document.visibilityState==='visible')void refreshLive();};
  const start=setTimeout(poll,0),timer=setInterval(poll,15000);
  document.addEventListener('visibilitychange',poll);
  return()=>{clearTimeout(start);clearInterval(timer);document.removeEventListener('visibilitychange',poll);};
 },[online,refreshLive]);
 const setLiveSharing=async enabled=>{
  if(!online||!supabase)throw new Error('Connect to change location sharing.');
  const {error:failure}=await supabase.rpc('set_my_live_location',{p_enabled:enabled});
  if(failure)throw new Error(failure.message||'Could not change location sharing.');
  setLiveEnabled(enabled);
  if(enabled)lastPlaceSentAt.current=0;
  await refreshLive();
 };
 useEffect(()=>{
  if(!owner||!online||!liveEnabled||!recorderAvailable())return;
  let alive=true;
  const send=async()=>{
   if(!alive||document.visibilityState==='hidden'||liveBusy.current)return;
   liveBusy.current=true;
   try{
    const position=await recorder.currentPosition();
    if(!alive||!position||!Number.isFinite(position.latitude)||!Number.isFinite(position.longitude)||
      !Number.isFinite(position.accuracy)||position.accuracy<0||position.accuracy>100)return;
    // The location API can expose speed in m/s; do not guess speed when absent.
    const speed=Number.isFinite(position.speed)&&position.speed>=0?
      Math.max(0,Math.min(250,position.speed*3.6)):null;
    const {error:failure}=await supabase.rpc('set_my_live_location',{
      p_enabled:true,p_latitude:position.latitude,p_longitude:position.longitude,
      p_accuracy:position.accuracy,p_speed:speed
    });
    if(failure&&alive)setLiveError('Unable to update live location.');
   }catch{/* Never replace the last confirmed location with a guess. */}
   finally{liveBusy.current=false;}
  };
  void send();
  const timer=setInterval(()=>void send(),30000);
  const visible=()=>{if(document.visibilityState==='visible')void send();};
  document.addEventListener('visibilitychange',visible);
  return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[owner,online,liveEnabled]);
 const update=async(enabled,activity=null,place=null)=>{
  if(!online||!supabase)throw new Error('Connect to change live visibility securely.');
  setBusy(true);
  try{
   const {error:failure}=await supabase.rpc('set_household_presence',{p_enabled:enabled,p_activity:activity,p_place:place});
   if(failure)throw new Error(failure.message||'Visibility update failed.');
   await refresh();
  }finally{setBusy(false);}
 };
 return {people,self,error,busy,refresh,update,liveEnabled,livePeople,liveError,setLiveSharing,refreshLive};
}
