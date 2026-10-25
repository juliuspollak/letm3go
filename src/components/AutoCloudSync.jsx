import {useEffect,useRef} from 'react';
import {useAuth} from '../lib/AuthContext.jsx';
import {supabase} from '../lib/supabase.js';
import {config} from '../lib/config.js';
import {syncPrivateActivities} from '../lib/cloudSync.js';
// Foreground/offline-aware sync. Never deletes local photos or recorder files.
export default function AutoCloudSync({state}){
 const auth=useAuth(),latest=useRef(null),running=useRef(false),lastAttempt=useRef(0);
 latest.current={auth,state};
 useEffect(()=>{
  if(!config.backupEnabled||!supabase)return;
  let alive=true;
  async function sync(){
   if(running.current||document.visibilityState!=='visible'||!navigator.onLine||Date.now()-lastAttempt.current<120000)return;
   const {auth:user,state:recordings}=latest.current;
   if(user.status!=='authenticated'||!recordings?.ownerID||recordings.ownerID.toLowerCase()!==user.session.user.id.toLowerCase())return;
   running.current=true;lastAttempt.current=Date.now();
   try{
    const result=await syncPrivateActivities(supabase,recordings,user.preferences.syncReceipts||{},{checkpoint:syncReceipts=>user.savePreferences({syncReceipts})});
    if(alive)await user.savePreferences({syncReceipts:result.receipts,lastBackup:result.lastSync});
   }catch{
    // The Settings screen is the explicit retry/error surface. Nothing local is deleted.
   }finally{running.current=false;}
  }
  const starter=setTimeout(()=>void sync(),5000),periodic=setInterval(()=>void sync(),120000);
  const resume=()=>void sync();
  window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
  return()=>{alive=false;clearTimeout(starter);clearInterval(periodic);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);};
 },[]);
 return null;
}
