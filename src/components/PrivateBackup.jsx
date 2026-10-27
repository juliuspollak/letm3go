import {useCallback,useEffect,useRef,useState} from 'react';
import {useAuth} from '../lib/AuthContext.jsx';
import {supabase} from '../lib/supabase.js';
import {config} from '../lib/config.js';
import {syncPrivateActivities} from '../lib/cloudSync.js';
import {restoreCloudJournal} from '../lib/cloudRestore.js';
import {mergeRestoredCollection,syncCollections} from '../lib/collectionSync.js';
import {mergeRestoredSettings,syncAccountSettings} from '../lib/settingsSync.js';
export default function PrivateBackup({state}){
 const auth=useAuth(),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const active=useRef(false),current=useRef({state,auth});
 useEffect(()=>{current.current={state,auth};},[state,auth]);
 const [restoring,setRestoring]=useState(false);
 const restore=async()=>{
  setRestoring(true);setError('');
  try{
   const outcome=await restoreCloudJournal();
   // Additive merge: an item or setting this device already holds always wins.
   const merged=mergeRestoredCollection(auth.preferences.vehicles||[],outcome.collection);
   const settings=mergeRestoredSettings(auth.preferences,outcome.settings);
   await auth.savePreferences({...settings,vehicles:merged.vehicles,syncReceipts:{...(auth.preferences.syncReceipts||{}),...outcome.receipts}});
   setMessage(`Recovered ${outcome.restored} journeys, ${outcome.photosRestored} trip photos, ${merged.restored} Collection items and ${outcome.collectionPhotos} Collection photos. Reopen Trips to refresh.`);
  }catch(err){setError(err.message);}
  finally{setRestoring(false);}
 };
 const execute=useCallback(async()=>{
  const {state:latest,auth:user}=current.current;
  if(active.current||!config.backupEnabled||!supabase||user.status!=='authenticated'||!latest?.ownerID||latest.ownerID.toLowerCase()!==user.session.user.id.toLowerCase()||!navigator.onLine)return;
  active.current=true;setBusy(true);setError('');
  try{
   let receipts=user.preferences.syncReceipts||{};
   const settings=await syncAccountSettings(supabase,{owner:latest.ownerID,preferences:user.preferences,receipts},{checkpoint:syncReceipts=>user.savePreferences({syncReceipts})});
   receipts=settings.receipts;
   const collection=await syncCollections(supabase,{owner:latest.ownerID,vehicles:user.preferences.vehicles,receipts},{checkpoint:syncReceipts=>user.savePreferences({syncReceipts})});
   receipts=collection.receipts;
   const result=await syncPrivateActivities(supabase,latest,receipts,{checkpoint:syncReceipts=>user.savePreferences({syncReceipts})});
   await user.savePreferences({syncReceipts:result.receipts,lastBackup:result.lastSync});
   setMessage(`Cloud synchronised · ${result.uploaded} activities, ${result.photosUploaded||0} trip photos, ${collection.uploaded} Collection items and ${collection.photosUploaded} Collection photos uploaded in this pass.`);
  }catch(err){setError(err.message||'Cloud sync failed; local recordings are preserved.');}
  finally{active.current=false;setBusy(false);}
 },[]);
 return <section className="cloud-sync-settings"><h3>Cloud sync</h3>
 <p>Completed iPhone recordings and GPS routes are synchronised privately to Supabase; compressed photos go to private Cloudflare R2. My Collection, its photos and your account settings are backed up the same way. Your iPhone keeps offline copies while uploads complete.</p>
 {!config.backupEnabled?<p className="notice">Cloud sync is not activated in this build. Keep the app installed: locally recorded journeys, photos and your Collection have not been verified in the cloud.</p>:<><p className="muted small-copy">Sync runs when the app is open and connected. Upload failures are retried, and local files are retained.</p><button type="button" className="secondary full" disabled={busy||auth.status!=='authenticated'||!state?.ownerID} onClick={()=>void execute()}>{busy?'Synchronising…':'Sync now'}</button></>}
 <button type="button" className="secondary full" disabled={restoring||busy||auth.status!=='authenticated'||!state?.ownerID} onClick={()=>void restore()}>{restoring?'Restoring…':'Restore journeys, Collection and photos from cloud'}</button>
 {auth.preferences.lastBackup&&<p className="muted small-copy">Last successful upload check: {new Date(auth.preferences.lastBackup).toLocaleString('en-AU')}</p>}
 {message&&<p role="status" className="notice">{message}</p>}
 {error&&<p role="alert" className="error">{error}</p>}
 <p className="muted small-copy">Restore only adds missing activities, Collection items and photos. It never overwrites existing local recordings. Cloud recovery must be tested before removing an old iPhone.</p>
 </section>;
}

