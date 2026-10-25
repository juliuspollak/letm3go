import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from './supabase.js';
export function useHouseholdPresence(owner,online,automaticActivity=null){
 const lastAutomatic=useRef(undefined);
 const [people,setPeople]=useState([]),[self,setSelf]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{
  if(!owner||!online||!supabase)return;
  const [mine,others]=await Promise.all([supabase.rpc('my_presence_settings'),supabase.rpc('my_household_presence')]);
  if(mine.error||others.error){setError('Social presence is unavailable. The database migration may not be deployed.');return;}
  setSelf(mine.data?.[0]||{sharing_enabled:false});setPeople(others.data||[]);setError('');
 },[owner,online]);
 useEffect(()=>{if(!online)return;const initial=setTimeout(()=>void refresh(),0);const timer=setInterval(()=>void refresh(),60000);return()=>{clearTimeout(initial);clearInterval(timer);};},[refresh,online]);
 useEffect(()=>{
  if(!owner||!online||!supabase||self?.sharing_enabled!==true){lastAutomatic.current=undefined;return;}
  if(lastAutomatic.current===automaticActivity)return;
  lastAutomatic.current=automaticActivity;
  let cancelled=false;
  const send=async()=>{
   const {error:failure}=await supabase.rpc('set_household_presence',{p_enabled:true,p_activity:automaticActivity,p_place:null});
   if(failure&&!cancelled)setError('Automatic activity sharing could not update.');
   if(!failure&&!cancelled)void refresh();
  };
  void send();
  return()=>{cancelled=true;};
 },[owner,online,self?.sharing_enabled,automaticActivity,refresh]);
 const update=async(enabled,activity=null,place=null)=>{
  if(!online||!supabase)throw new Error('Connect to change live visibility securely.');
  setBusy(true);
  try{
   const {error:failure}=await supabase.rpc('set_household_presence',{p_enabled:enabled,p_activity:activity,p_place:place});
   if(failure)throw new Error(failure.message||'Visibility update failed.');
   await refresh();
  }finally{setBusy(false);}
 };
 return {people,self,error,busy,refresh,update};
}
