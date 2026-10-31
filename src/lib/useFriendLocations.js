import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from './supabase.js';
import {recorder,recorderAvailable} from './recorder.js';
import {config} from './config.js';
import {sharedPosition} from './sharedPosition.js';

// Only friends see location, only after explicit consent. Locations are visible for up to 30 minutes with timestamps.
const revokeKey=owner=>`letm3go-friend-revoke:${owner}`;
const hasPendingRevoke=owner=>{try{return localStorage.getItem(revokeKey(owner))==='1';}catch{return false;}};
const setPendingRevoke=(owner,on)=>{try{on?localStorage.setItem(revokeKey(owner),'1'):localStorage.removeItem(revokeKey(owner));}catch{return;}};
export function useFriendLocations(owner,online){
 const [people,setPeople]=useState([]),[enabled,setEnabled]=useState(false),[error,setError]=useState('');
 const [revokePending,setRevokePending]=useState(()=>hasPendingRevoke(owner));
 const enabledRef=useRef(false);useEffect(()=>{enabledRef.current=enabled;},[enabled]);
 // True once the server has answered, so the switch never shows Off before the
 // real setting is known. Display only; sharing itself is unchanged.
 const [ready,setReady]=useState(false);
 // When a position was last accepted by the server from this app, so the UI
 // never treats the sharing setting alone as live delivery. Display only.
 const [lastSentAt,setLastSentAt]=useState(0);
 const refresh=useCallback(async()=>{
  if(!owner||!online||!supabase)return;
  try{
   const [setting,locations]=await Promise.all([supabase.rpc('my_friend_location_setting'),supabase.rpc('my_friend_locations')]);
   if(setting.error||locations.error)throw Error('Friend locations are unavailable until the database migration is applied.');
   setEnabled(setting.data===true&&!hasPendingRevoke(owner));setPeople(locations.data||[]);setError('');setReady(true);
  }catch(e){setError(e.message);setPeople([]);}
 },[owner,online]);
 useEffect(()=>{if(!online)return;const initial=setTimeout(()=>void refresh(),0);const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},15000);const visible=()=>{if(document.visibilityState==='visible')void refresh();};document.addEventListener('visibilitychange',visible);return()=>{clearTimeout(initial);clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[online,refresh]);
 const send=useCallback(async()=>{
  if(!enabled||!online||!recorderAvailable()||!supabase)return;
  try{
   const fix=await recorder.currentPosition();
   if(!Number.isFinite(fix?.latitude)||!Number.isFinite(fix?.longitude)||!Number.isFinite(fix?.accuracy)||fix.accuracy>100||Math.abs(Date.now()/1000-fix.timestamp)>30)return;
   const {error:e}=await supabase.rpc('set_friend_location',{p_enabled:true,p_latitude:fix.latitude,p_longitude:fix.longitude,p_accuracy:fix.accuracy});
   if(e)throw e;setError('');setLastSentAt(Date.now());
  }catch{setError('Could not update friend location. Check location permission and connection.');}
 },[enabled,online]);
 useEffect(()=>{if(!enabled||!online)return;const initial=setTimeout(()=>void send(),0);const timer=setInterval(()=>{if(document.visibilityState==='visible')void send();},30000);const visible=()=>{if(document.visibilityState==='visible')void send();};document.addEventListener('visibilitychange',visible);return()=>{clearTimeout(initial);clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[enabled,online,send]);
 useEffect(()=>{
  if(!owner||!recorderAvailable())return;
  let alive=true;
  const arm=async()=>{
   if(!enabled||!online||!supabase){
    await recorder.configureLiveSharing({enabled:false,channel:'friends'}).catch(()=>{});
    return;
   }
   try{
    const {data:{session},error:e}=await supabase.auth.getSession();
    if(!alive||e||session?.user?.id!==owner||!session?.expires_at)return;
    await recorder.configureLiveSharing({
     enabled:true,channel:'friends',accessToken:session.access_token,
     expiresAt:session.expires_at,endpoint:config.url+'/rest/v1/rpc/set_friend_location',
     apiKey:config.key
    });
   }catch{if(alive)setError('Background friend location could not be enabled. Foreground updates remain available.');}
  };
  void arm();
  const interval=setInterval(()=>void arm(),120000);
  const visible=()=>{if(document.visibilityState==='visible')void arm();};
  document.addEventListener('visibilitychange',visible);
  return()=>{alive=false;clearInterval(interval);document.removeEventListener('visibilitychange',visible);};
 },[owner,online,enabled]);
 const setSharing=async next=>{
  if(!next){
   // Privacy first, exactly as household sharing: stop native friend
   // publishing even when the server cannot be reached.
   setEnabled(false);enabledRef.current=false;setLastSentAt(0);setPendingRevoke(owner,true);setRevokePending(true);
   await recorder.configureLiveSharing({enabled:false,channel:'friends'}).catch(()=>{});
   let failure;
   if(online&&supabase){try{({error:failure}=await supabase.rpc('set_friend_location',{p_enabled:false}));}catch(e){failure=e;}}
   else failure=new Error('The server revoke will retry when you are online.');
   if(!failure){setPendingRevoke(owner,false);setRevokePending(false);}
   await refresh();
   if(failure)throw failure;
   return;
  }
  if(!supabase||!online)throw Error('Connect to change friend sharing.');
  const fix=await sharedPosition();
  const {error:e}=await supabase.rpc('set_friend_location',{p_enabled:true,p_latitude:fix.latitude,p_longitude:fix.longitude,p_accuracy:fix.accuracy});if(e)throw e;
  setLastSentAt(Date.now());
  setPendingRevoke(owner,false);setRevokePending(false);
  setEnabled(true);await refresh();
 };
 // Retry an offline friend revoke while the local switch is still off.
 useEffect(()=>{
  if(!owner||!online||!supabase||!revokePending||enabledRef.current)return;
  let alive=true;
  const retry=async()=>{
   if(!alive||enabledRef.current)return;
   const {error}=await supabase.rpc('set_friend_location',{p_enabled:false});
   if(!alive||error)return;
   setPendingRevoke(owner,false);setRevokePending(false);await refresh();
  };
  void retry();
  const timer=setInterval(()=>void retry(),30000);
  window.addEventListener('online',retry);
  return()=>{alive=false;clearInterval(timer);window.removeEventListener('online',retry);};
 },[owner,online,revokePending,refresh]);
 return {people,enabled,ready,lastSentAt,error,setSharing,refresh};
}
