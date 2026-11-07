import {useEffect,useState} from 'react';
import {supabase} from './supabase.js';
import {sharedSnapshotActivity} from './sharedSnapshotActivity.js';

// This fetch supplies the *existing* ActivityDetailScreen. It never loads
// the owner's private activity table or reconstructs historical GPS.
export function useSharedActivityDetail(activityID,token,ownerName='Friend'){
 const [result,setResult]=useState({trip:null,loading:false,error:''});
 useEffect(()=>{
  if(!activityID&&!token)return;
  // `settled` stops the deferred loading state from replacing an answer that
  // already arrived (an immediate failure would otherwise show Loading forever).
  let active=true,settled=false;
  const load=async()=>{
   try{
    if(!supabase?.functions)throw new Error('This shared activity is unavailable or access has been revoked.');
    const source=activityID?'activity='+encodeURIComponent(activityID):'token='+encodeURIComponent(token);
    const {data,error}=await supabase.functions.invoke('journeys?'+source,{method:'GET'});
    if(error||!data?.snapshot)throw new Error('This shared activity is unavailable or access has been revoked.');
    const trip=sharedSnapshotActivity(data.snapshot,activityID||token,ownerName);
    settled=true;if(active)setResult({trip,loading:false,error:''});
   }catch(error){settled=true;if(active)setResult({trip:null,loading:false,error:error?.message||'Shared activity unavailable.'});}
  };
  queueMicrotask(()=>{if(active&&!settled)setResult({trip:null,loading:true,error:''});});
  void load();
  return()=>{active=false;};
 },[activityID,token,ownerName]);
 return activityID||token?result:{trip:null,loading:false,error:''};
}
