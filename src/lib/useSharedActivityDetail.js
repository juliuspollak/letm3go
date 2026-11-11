import {useEffect,useState} from 'react';
import {supabase} from './supabase.js';
import {sharedSnapshotActivity} from './sharedSnapshotActivity.js';
import {subscribeHouseholdSignals,throttled} from './householdRealtime.js';
import {REVALIDATE_MS} from './usePersonDay.js';

// The existing detail screen must obey the same access-change signals as its map.
// No route is cached here; every replacement comes through the authorised endpoint.
export function useSharedActivityDetail(activityID,token,ownerName='Friend',viewer=null){
 const key=`${viewer}|${activityID}|${token}`;
 const [result,setResult]=useState({key:null,trip:null,loading:false,error:''});
 useEffect(()=>{
  if(!activityID&&!token)return;
  let active=true,sequence=0,stop=()=>{},connectedOnce=false;
  const load=async()=>{
   const mine=++sequence;
   try{
    if(!supabase?.functions)throw new Error('This shared activity is unavailable or access has been revoked.');
    const source=activityID?'activity='+encodeURIComponent(activityID):'token='+encodeURIComponent(token);
    const {data,error}=await supabase.functions.invoke('journeys?'+source,{method:'GET'});
    if(!active||mine!==sequence)return;
    if(error||!data?.snapshot)throw new Error('This shared activity is unavailable or access has been revoked.');
    setResult({key,trip:sharedSnapshotActivity(data.snapshot,activityID||token,ownerName),loading:false,error:''});
   }catch(error){if(active&&mine===sequence)setResult({key,trip:null,loading:false,error:error?.message||'Shared activity unavailable.'});}
  };
  const revalidate=throttled(()=>void load());
  const changed=()=>{
   if(!active)return;
   ++sequence;setResult({key,trip:null,loading:true,error:''});revalidate();
  };
  void load();
  if(activityID&&viewer&&supabase?.channel)(async()=>{
   try{await supabase.realtime?.setAuth?.();}catch{/* polling recovers */}
   if(!active)return;
   stop=subscribeHouseholdSignals(supabase,[`user:${viewer}`],{event:'share',onSignal:changed,onState:connected=>{
    if(!active)return;if(connected){if(connectedOnce)changed();connectedOnce=true;}
   }});
  })();
  const visible=()=>{if(document.visibilityState!=='hidden')void load();};
  const online=()=>{void load();};
  const timer=setInterval(visible,REVALIDATE_MS);
  document.addEventListener('visibilitychange',visible);window.addEventListener('online',online);
  return()=>{active=false;++sequence;revalidate.cancel();stop();clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',online);};
 },[key,activityID,token,ownerName,viewer]);
 return activityID||token?(result.key===key?result:{trip:null,loading:true,error:''}):{trip:null,loading:false,error:''};
}
