import {useEffect,useState} from 'react';
import {supabase} from './supabase.js';

// Only lightweight metadata for the list. Never load GPS/photo snapshots here.
const EMPTY=[];
export function useSharedActivityFeed(enabled,ownerID){
 const [state,setState]=useState({items:EMPTY,error:'',loading:false});
 useEffect(()=>{
  if(!enabled||!ownerID||!supabase){
   setState({items:EMPTY,error:'',loading:false});
   return;
  }
  let active=true;
  const refresh=async()=>{
   if(!active)return;
   const {data,error}=await supabase.rpc('my_social_journey_feed');
   if(!active)return;
   if(error){setState({items:EMPTY,error:'Shared activities are unavailable. Please try again.',loading:false});return;}
   setState({items:data||EMPTY,error:'',loading:false});
  };
  setState({items:EMPTY,error:'',loading:true});
  void refresh();
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},30000);
  const onVisible=()=>{if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',onVisible);
  return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);};
 },[enabled,ownerID]);
 return state;
}
