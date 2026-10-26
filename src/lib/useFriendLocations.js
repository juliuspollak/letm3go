import {useCallback,useEffect,useState} from 'react';
import {supabase} from './supabase.js';
import {recorder,recorderAvailable} from './recorder.js';

// Only friends see location, only after explicit consent. Positions expire after 90 seconds.
export function useFriendLocations(owner,online){
 const [people,setPeople]=useState([]),[enabled,setEnabled]=useState(false),[error,setError]=useState('');
 const refresh=useCallback(async()=>{
  if(!owner||!online||!supabase)return;
  try{
   const [setting,locations]=await Promise.all([supabase.rpc('my_friend_location_setting'),supabase.rpc('my_friend_locations')]);
   if(setting.error||locations.error)throw Error('Friend locations are unavailable until the database migration is applied.');
   setEnabled(setting.data===true);setPeople(locations.data||[]);setError('');
  }catch(e){setError(e.message);setPeople([]);}
 },[owner,online]);
 useEffect(()=>{if(!online)return;void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},15000);const visible=()=>{if(document.visibilityState==='visible')void refresh();};document.addEventListener('visibilitychange',visible);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[online,refresh]);
 const send=useCallback(async()=>{
  if(!enabled||!online||!recorderAvailable()||!supabase)return;
  try{
   const fix=await recorder.currentPosition();
   if(!Number.isFinite(fix?.latitude)||!Number.isFinite(fix?.longitude)||!Number.isFinite(fix?.accuracy)||fix.accuracy>100||Math.abs(Date.now()/1000-fix.timestamp)>30)return;
   const {error:e}=await supabase.rpc('set_friend_location',{p_enabled:true,p_latitude:fix.latitude,p_longitude:fix.longitude,p_accuracy:fix.accuracy});
   if(e)throw e;setError('');
  }catch{setError('Could not update friend location. Check location permission and connection.');}
 },[enabled,online]);
 useEffect(()=>{if(!enabled||!online)return;void send();const timer=setInterval(()=>{if(document.visibilityState==='visible')void send();},30000);const visible=()=>{if(document.visibilityState==='visible')void send();};document.addEventListener('visibilitychange',visible);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[enabled,online,send]);
 const setSharing=async next=>{
  if(!supabase||!online)throw Error('Connect to change friend sharing.');
  if(next){const fix=await recorder.currentPosition();if(!Number.isFinite(fix?.latitude)||!Number.isFinite(fix?.longitude)||!Number.isFinite(fix?.accuracy)||fix.accuracy>100||Math.abs(Date.now()/1000-fix.timestamp)>30)throw Error('A fresh accurate GPS position is needed before sharing.');
   const {error:e}=await supabase.rpc('set_friend_location',{p_enabled:true,p_latitude:fix.latitude,p_longitude:fix.longitude,p_accuracy:fix.accuracy});if(e)throw e;
  } else {const {error:e}=await supabase.rpc('set_friend_location',{p_enabled:false});if(e)throw e;}
  setEnabled(next);await refresh();
 };
 return {people,enabled,error,setSharing,refresh};
}
