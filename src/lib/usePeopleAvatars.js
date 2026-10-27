import {useCallback,useEffect,useState} from 'react';
import {supabase} from './supabase.js';

// One authorized photo source for all social views. The existing RPC only returns
// photos of the signed-in user's household; friend-only contacts keep initials.
export function usePeopleAvatars(owner,online,profileAvatar){
 const [result,setResult]=useState({owner:null,photos:{}}),[version,setVersion]=useState(0);
 const refresh=useCallback(()=>setVersion(value=>value+1),[]);
 useEffect(()=>{
  if(!owner||!online||!supabase)return;
  let alive=true;
  async function load(){
   try{
    const membership=await supabase.rpc('my_household');
    if(!alive)return;
    if(membership.error)throw membership.error;
    if(!membership.data?.length){setResult({owner,photos:{}});return;}
    const avatar=typeof profileAvatar==='string'&&profileAvatar.startsWith('data:image/jpeg;base64,')&&profileAvatar.length<=180000?profileAvatar:null;
    if(avatar){
     const saved=await supabase.rpc('save_my_household_avatar',{p_avatar:avatar});
     if(!alive)return;
     if(saved.error)throw saved.error;
    }
    const response=await supabase.rpc('my_household_member_avatars');
    if(!alive)return;
    if(response.error)throw response.error;
    const photos=Object.fromEntries((response.data||[]).filter(person=>person.avatar_data?.startsWith('data:image/jpeg;base64,')).map(person=>[person.user_id,person.avatar_data]));
    setResult({owner,photos});
   }catch{if(alive)setResult({owner,photos:{}});}
  }
  void load();
  const visible=()=>{if(document.visibilityState==='visible')refresh();};
  document.addEventListener('visibilitychange',visible);
  return()=>{alive=false;document.removeEventListener('visibilitychange',visible);};
 },[owner,online,profileAvatar,version,refresh]);
 return {photos:result.owner===owner?result.photos:{},refresh};
}
