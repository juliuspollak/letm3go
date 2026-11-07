import {useEffect,useState} from 'react';
import {supabase} from './supabase.js';

// Who can see each of my shared activities, for the Activities list indicators.
// Loaded when the list is shown and again after an activity's details close
// (where sharing changes); never polled. An unchanged answer keeps its identity,
// so the list does not re-render.
const EMPTY={};
export function useMySharing(enabled,ownerID,refreshKey){
 const [byID,setByID]=useState(EMPTY);
 useEffect(()=>{
  if(!enabled||!ownerID||!supabase)return;
  let active=true;
  (async()=>{
   try{
    const [mine,friends]=await Promise.all([supabase.rpc('my_social_publications'),supabase.rpc('my_friends')]);
    if(!active||mine.error)return;
    const names=Object.fromEntries((friends.data||[]).map(f=>[String(f.user_id),f.display_name||'Friend']));
    const next=Object.fromEntries((mine.data||[]).map(row=>[String(row.activity_id),{audience:row.audience,household:row.household===true,
     friends:(row.friend_ids||[]).map(id=>({id:String(id),name:names[String(id)]||'Friend'}))}]));
    setByID(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
   }catch{/* Indicators are optional; the list still works. */}
  })();
  return()=>{active=false;};
 },[enabled,ownerID,refreshKey]);
 return enabled&&ownerID?byID:EMPTY;
}
