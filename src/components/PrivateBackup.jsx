import {useCallback,useRef,useState} from 'react';
import {useAuth} from '../lib/AuthContext.jsx';
import {supabase} from '../lib/supabase.js';
import {config} from '../lib/config.js';
import {syncPrivateActivities} from '../lib/cloudSync.js';
export default function PrivateBackup({state}){
 const auth=useAuth(),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const active=useRef(false),lastAttempt=useRef(0),current=useRef({state,auth});
 current.current={state,auth};
 const execute=useCallback(async()=>{
  const {state:latest,auth:user}=current.current;
  if(active.current||!config.backupEnabled||!supabase||user.status!=='authenticated'||!latest?.ownerID||latest.ownerID.toLowerCase()!==user.session.user.id.toLowerCase()||!navigator.onLine)return;
  active.current=true;lastAttempt.current=Date.now();setBusy(true);setError('');
  try{
   const result=await syncPrivateActivities(supabase,latest,user.preferences.syncReceipts||{},{checkpoint:syncReceipts=>user.savePreferences({syncReceipts})});
   await user.savePreferences({syncReceipts:result.receipts,lastBackup:result.lastSync});
   setMessage(`Cloud synchronised · ${result.uploaded} activities and ${result.photosUploaded||0} photos uploaded in this pass.`);
  }catch(err){setError(err.message||'Cloud sync failed; local recordings are preserved.');}
  finally{active.current=false;setBusy(false);}
 },[]);
 return <section className="cloud-sync-settings"><h3>Cloud sync</h3>
 <p>Completed iPhone recordings and GPS routes are synchronised privately to Supabase; compressed photos go to private Cloudflare R2. Your iPhone keeps offline copies while uploads complete.</p>
 {!config.backupEnabled?<p className="notice">Cloud sync is not activated in this build. Keep the app installed: locally recorded journeys and photos have not been verified in the cloud.</p>:<><p className="muted small-copy">Sync runs when the app is open and connected. Upload failures are retried, and local files are retained.</p><button type="button" className="secondary full" disabled={busy||auth.status!=='authenticated'||!state?.ownerID} onClick={()=>void execute()}>{busy?'Synchronising…':'Sync now'}</button></>}
 {auth.preferences.lastBackup&&<p className="muted small-copy">Last successful upload check: {new Date(auth.preferences.lastBackup).toLocaleString('en-AU')}</p>}
 {message&&<p role="status" className="notice">{message}</p>}
 {error&&<p role="alert" className="error">{error}</p>}
 <p className="muted small-copy">Restore to a replacement iPhone is not available yet. A cloud upload is not a verified recoverable backup until restore is implemented and tested.</p>
 </section>;
}
