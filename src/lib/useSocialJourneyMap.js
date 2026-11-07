import {useEffect,useState} from 'react';
import {supabase} from './supabase.js';
import {publicJourneyMap} from './publicJourneyMap.js';

// An explicit optional map layer: never fetch another person's private
// recordings. Read only the server-reviewed shared snapshots, through JWT RPC.
export function useSocialJourneyMap(enabled,ownerID) {
 const [data,setData]=useState({journeys:[],feed:[],error:'',loading:false});
 useEffect(()=>{
  if(!enabled||!ownerID||!supabase)return;
  let cancelled=false;
  async function load(){
   setData(previous=>({...previous,loading:true,error:''}));
   try{
    const {data:feed,error}=await supabase.rpc('my_social_journey_feed');
    if(error)throw new Error('Shared activities are unavailable until the social migration is applied.');
    // Bounded map layer. It never loads unshared activities or a person's raw GPS.
    const rows=(feed||[]).slice(0,20);
    const received=await Promise.all(rows.map(async row=>{
     try{
      const {data:shared,error:readError}=await supabase.functions.invoke('journeys?activity='+encodeURIComponent(row.activity_id),{method:'GET'});
      if(readError||!shared?.snapshot)return null;
      const mapped=publicJourneyMap(shared.snapshot);
      if(!mapped)return null;
      return {...mapped,id:'shared:'+row.activity_id,sharedActivityID:row.activity_id,title:shared.snapshot.title||row.title};
     }catch{return null;}
    }));
    if(!cancelled)setData({journeys:received.filter(Boolean),feed:rows,error:'',loading:false});
   }catch(error){if(!cancelled)setData(previous=>({...previous,error:error.message||'Unable to load friends’ activities.',loading:false}));}
  }
  void load();
  return()=>{cancelled=true;};
 },[enabled,ownerID]);
 return data;
}
