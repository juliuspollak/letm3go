import {useCallback,useEffect,useState} from 'react';
import {supabase} from './supabase.js';
import {isAvatarImage,shareableAvatar} from './avatar.js';

// The shared photo list contains the signed-in user plus current household
// members and accepted friends. Cases where a person cannot be resolved (no
// household, a stranger) are handled by the RPC itself, not by the caller.
async function readSharedAvatars(client){
 const people=await client.rpc('my_people_avatars');
 if(!people.error)return people;
 // Older databases only expose the household-scoped helper.
 return client.rpc('my_household_member_avatars');
}

// One authorized photo source for all social views. The signed-in user is always
// merged from their own preferences by stable id, so the header, Friends and
// Household can never disagree — and a failed avatar upload or a slow RPC can no
// longer blank out every photo in the app.
export function usePeopleAvatars(owner,online,profileAvatar){
 const [result,setResult]=useState({owner:null,photos:{}}),[version,setVersion]=useState(0);
 const refresh=useCallback(()=>setVersion(value=>value+1),[]);
 useEffect(()=>{
  if(!owner||!online||!supabase)return;
  let alive=true;
  async function load(){
   const photos={};
   try{
    const membership=await supabase.rpc('my_household');
    if(!alive)return;
    // Only publish a photo once membership exists; reading is always attempted so
    // friend avatars still resolve for people without a household.
    if(!membership.error&&membership.data?.length){
     try{
      const shared=await shareableAvatar(profileAvatar);
      if(shared)await supabase.rpc('save_my_household_avatar',{p_avatar:shared});
     }catch{/* A rejected upload must never hide photos that already exist. */}
     if(!alive)return;
    }
    const response=await readSharedAvatars(supabase);
    if(!alive)return;
    for(const person of response.error?[]:response.data||[])
     if(isAvatarImage(person.avatar_data))photos[person.user_id]=person.avatar_data;
   }catch{/* Offline: the signed-in photo below still resolves. */}
   if(!alive)return;
   setResult({owner,photos});
  }
  void load();
  const visible=()=>{if(document.visibilityState==='visible')refresh();};
  document.addEventListener('visibilitychange',visible);
  return()=>{alive=false;document.removeEventListener('visibilitychange',visible);};
 },[owner,online,profileAvatar,version,refresh]);
 const selfPhoto=isAvatarImage(profileAvatar)?profileAvatar:null;
 const shared=result.owner===owner?result.photos:{};
 const photos=selfPhoto?{[owner]:selfPhoto,...shared}:shared;
 return {photos,refresh};
}

