import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from './supabase.js';
import {keepIfSame} from './sameData.js';

const EMPTY=[];
const COLUMNS='id,household_id,owner_id,name,icon,latitude,longitude,radius,share_with_friends';

export function useHouseholdPlaces(owner,enabled){
 const [result,setResult]=useState(null);
 const version=useRef({latest:0});
 const refresh=useCallback(async()=>{
  if(!owner||!enabled||!supabase?.from)return;
  const sequence=version.current;
  const request=++sequence.latest;
  try{
   const {data,error}=await supabase.from('household_places').select(COLUMNS).order('id');
   if(error)throw error;
   if(request===sequence.latest)setResult(keepIfSame({owner,places:data.map(place=>({...place,shareWithFriends:place.share_with_friends}))}));
  }catch{
   if(request===sequence.latest)setResult(keepIfSame({owner,error:'Locations could not be loaded.'}));
  }
 },[owner,enabled]);

 useEffect(()=>{
  if(!owner||!enabled)return;
  const sequence=version.current;
  const load=()=>{if(!document.hidden)void refresh();};
  const initial=setTimeout(load,0);
  const poll=setInterval(load,30000);
  document.addEventListener('visibilitychange',load);
  return()=>{
   ++sequence.latest;
   clearTimeout(initial);
   clearInterval(poll);
   document.removeEventListener('visibilitychange',load);
  };
 },[owner,enabled,refresh]);

 const current=enabled&&result?.owner===owner?result:null;
 return {ready:Array.isArray(current?.places),places:current?.places||EMPTY,error:current?.error,refresh};
}
