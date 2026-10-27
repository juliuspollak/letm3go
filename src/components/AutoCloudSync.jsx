import {useEffect,useRef} from 'react';
import {useAuth} from '../lib/AuthContext.jsx';
import {supabase} from '../lib/supabase.js';
import {config} from '../lib/config.js';
import {syncPrivateActivities} from '../lib/cloudSync.js';
import {syncCollections} from '../lib/collectionSync.js';
import {syncAccountSettings} from '../lib/settingsSync.js';
// Foreground/offline-aware sync. Never deletes local photos or recorder files.
export default function AutoCloudSync({state}){
 const auth=useAuth(),latest=useRef(null),running=useRef(false),lastAttempt=useRef(0);
 useEffect(()=>{latest.current={auth,state};},[auth,state]);
 useEffect(()=>{
  if(!config.backupEnabled||!supabase)return;
  let alive=true;
  async function sync(){
   if(running.current||document.visibilityState!=='visible'||!navigator.onLine||Date.now()-lastAttempt.current<120000)return;
   const {auth:user,state:recordings}=latest.current;
   if(user.status!=='authenticated'||!recordings?.ownerID||recordings.ownerID.toLowerCase()!==user.session.user.id.toLowerCase())return;
   running.current=true;lastAttempt.current=Date.now();
   try{
    // Settings and the Collection are small and independent of the route upload,
    // so one failing photo must not block them. The first failure is re-thrown
    // after every stage has been attempted; nothing local is removed.
    let failure=null,receipts=user.preferences.syncReceipts||{};
    const attempt=async(step)=>{try{receipts=(await step(receipts)).receipts;}catch(error){failure=failure||error;}};
    await attempt(next=>syncAccountSettings(supabase,{owner:recordings.ownerID,preferences:user.preferences,receipts:next},{checkpoint:syncReceipts=>user.savePreferences({syncReceipts})}));
    await attempt(next=>syncCollections(supabase,{owner:recordings.ownerID,vehicles:user.preferences.vehicles,receipts:next},{checkpoint:syncReceipts=>user.savePreferences({syncReceipts})}));
    const trips=await syncPrivateActivities(supabase,recordings,receipts,{checkpoint:syncReceipts=>user.savePreferences({syncReceipts})});
    receipts=trips.receipts;
    if(alive)await user.savePreferences({syncReceipts:receipts,lastBackup:trips.lastSync});
    if(failure)throw failure;
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

