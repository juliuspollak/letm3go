import {receiptPatch,saveSyncReceipts} from '../lib/syncReceipts.js';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useAuth} from '../lib/AuthContext.jsx';
import {supabase} from '../lib/supabase.js';
import {config} from '../lib/config.js';
import {backupHealth,syncPrivateActivities} from '../lib/cloudSync.js';
import {restoreCloudJournal} from '../lib/cloudRestore.js';
import {mergeRestoredCollection,syncCollections} from '../lib/collectionSync.js';
import {mergeRestoredSettings,syncAccountSettings} from '../lib/settingsSync.js';
export default function PrivateBackup({state}){
 const auth=useAuth(),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const active=useRef(false),current=useRef({state,auth});
 useEffect(()=>{current.current={state,auth};},[state,auth]);
 const [restoring,setRestoring]=useState(false);
 const health=useMemo(()=>backupHealth(state,auth.preferences.syncReceipts||{}),[state,auth.preferences.syncReceipts]);
 const restore=async()=>{
  setRestoring(true);setError('');
  try{
   const outcome=await restoreCloudJournal();
   // Additive merge: an item or setting this device already holds always wins.
   let merged;
   await auth.savePreferences(previous=>{
    merged=mergeRestoredCollection(previous.vehicles||[],outcome.collection);
    const settings=mergeRestoredSettings(previous,outcome.settings);
    return receiptPatch(previous,outcome.receipts,{...settings,vehicles:merged.vehicles});
   });
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
   const settings=await syncAccountSettings(supabase,{owner:latest.ownerID,preferences:user.preferences,receipts},{checkpoint:syncReceipts=>saveSyncReceipts(user.savePreferences,syncReceipts)});
   receipts=settings.receipts;
   const collection=await syncCollections(supabase,{owner:latest.ownerID,vehicles:user.preferences.vehicles,receipts},{checkpoint:syncReceipts=>saveSyncReceipts(user.savePreferences,syncReceipts)});
   receipts=collection.receipts;
   // A person asking for a sync means now: activities the cloud refused earlier are tried again without waiting.
   const result=await syncPrivateActivities(supabase,latest,receipts,{retryFailed:true,throwOnFailure:false,checkpoint:syncReceipts=>saveSyncReceipts(user.savePreferences,syncReceipts)});
   await saveSyncReceipts(user.savePreferences,result.receipts,{lastBackup:result.lastSync});
   if(result.problem)setError(result.problem.message);
   setMessage(result.problem?`${result.uploaded} activities uploaded in this pass; the rest are listed above and will be tried again.`:`Cloud synchronised · ${result.uploaded} activities, ${result.photosUploaded||0} trip photos, ${collection.uploaded} Collection items and ${collection.photosUploaded} Collection photos uploaded in this pass.`);
  }catch(err){setError(err.message||'Cloud sync failed; local recordings are preserved.');}
  finally{active.current=false;setBusy(false);}
 },[]);
 return <section className="cloud-sync-settings"><h3>Cloud sync</h3>
 <p>Completed iPhone recordings and GPS routes are synchronised privately to Supabase; compressed photos go to private Cloudflare R2. My Collection, its photos and your account settings are backed up the same way. Your iPhone keeps offline copies while uploads complete.</p>
 {!config.backupEnabled?<p className="notice">Cloud sync is not activated in this build. Keep the app installed: locally recorded journeys, photos and your Collection have not been verified in the cloud.</p>:<><p className="muted small-copy">Sync runs when the app is open and connected. Upload failures are retried, and local files are retained.</p><button type="button" className="secondary full" disabled={busy||auth.status!=='authenticated'||!state?.ownerID} onClick={()=>void execute()}>{busy?'Synchronising…':'Sync now'}</button></>}
 <button type="button" className="secondary full" disabled={restoring||busy||auth.status!=='authenticated'||!state?.ownerID} onClick={()=>void restore()}>{restoring?'Restoring…':'Restore journeys, Collection and photos from cloud'}</button>
 {health.total>0&&<p className={health.waiting?'notice':'muted small-copy'} role="status">{health.backedUp} of {health.total} recorded activities are backed up{health.waiting?` · ${health.waiting} waiting`:''}.{health.failing.map(f=><span key={f.id}><br/>Activity {f.id.slice(0,8)} was refused: {f.message} (tried {f.attempts} {f.attempts===1?'time':'times'}; next try {f.retryInSeconds>0?`in ${Math.ceil(f.retryInSeconds/60)} min`:'at the next sync'}).</span>)}</p>}
 {auth.preferences.lastBackup&&<p className="muted small-copy">Last successful upload check: {new Date(auth.preferences.lastBackup).toLocaleString('en-AU')}</p>}
 {message&&<p role="status" className="notice">{message}</p>}
 {error&&<p role="alert" className="error">{error}</p>}
 <p className="muted small-copy">Restore only adds missing activities, Collection items and photos. It never overwrites existing local recordings. Cloud recovery must be tested before removing an old iPhone.</p>
 </section>;
}

