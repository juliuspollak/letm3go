import {useMemo} from 'react';
import {useAuth} from '../lib/AuthContext.jsx';
import {config} from '../lib/config.js';
import {backupHealth} from '../lib/cloudSync.js';
export default function PrivateBackup({state}){
 const auth=useAuth();
 const health=useMemo(()=>backupHealth(state,auth.preferences.syncReceipts||{}),[state,auth.preferences.syncReceipts]);
 return <section className="cloud-sync-settings"><h3>Automatic backup</h3>
 <p>Your activities, photos, Collection and settings are saved automatically. Your phone keeps local copies while uploads complete.</p>
 {!config.backupEnabled?<p className="notice">Automatic backup is unavailable in this build. Keep the app installed to preserve recordings stored on this phone.</p>:<p className="muted small-copy">Uploads run while the app is open and connected. Interrupted uploads are retried automatically.</p>}
 {health.total>0&&<p className={health.waiting?'notice':'muted small-copy'} role="status">{health.backedUp} of {health.total} recorded activities are backed up{health.waiting?` · ${health.waiting} waiting`:''}.{health.failing.map(f=><span key={f.id}><br/>Activity {f.id.slice(0,8)}: {f.message}. Your local recording is safe.</span>)}</p>}
 {auth.preferences.lastBackup&&<p className="muted small-copy">Last checked: {new Date(auth.preferences.lastBackup).toLocaleString('en-AU')}</p>}
 </section>;
}
