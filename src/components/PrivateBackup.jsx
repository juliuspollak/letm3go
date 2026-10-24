import { useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { config } from '../lib/config.js';
import { syncPrivateActivities } from '../lib/cloudSync.js';
export default function PrivateBackup({state}){
 const auth=useAuth(),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 async function backup(){setBusy(true);setError('');try{
  const result=await syncPrivateActivities(supabase,state,auth.preferences.syncReceipts||{},{checkpoint:syncReceipts=>auth.savePreferences({syncReceipts})});
  await auth.savePreferences({syncReceipts:result.receipts,lastBackup:result.lastSync});setMessage(`Backup confirmed: ${result.uploaded} activities saved, ${result.deleted} cloud deletions confirmed. Photos remain on this device.`);
 }catch(err){setError(err.message);}finally{setBusy(false);}}
 return <section><h3>Private backup</h3><p>Copy completed activities, exact routes and saved Home/Work places to your own private account. Photos stay on this device. This does not publish journeys or restore them to another device.</p>{!config.backupEnabled?<p className="notice">Private backup is not enabled yet. Your recordings remain on this iPhone.</p>:<><label className="checkbox-label"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> I agree to back up these private locations.</label><button className="secondary full" disabled={!consent||busy||auth.status==='offline'||!state?.ownerID} onClick={backup}>{busy?'Backing up…':'Back up now'}</button></>}{auth.preferences.lastBackup&&<p>Last confirmed backup: {new Date(auth.preferences.lastBackup).toLocaleString()}</p>}{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}</section>;
}
