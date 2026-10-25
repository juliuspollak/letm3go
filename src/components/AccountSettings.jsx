import { useState } from 'react';
import ProfilePhotoCrop from './ProfilePhotoCrop.jsx';
import AccountActions from './AccountActions.jsx';
import PrivateBackup from './PrivateBackup.jsx';
import { Bell } from 'lucide-react';
import {distanceUnits} from '../lib/distanceUnits.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { config } from '../lib/config.js';
import { enableAccountPush } from '../lib/pushAccount.js';
import { supabase } from '../lib/supabase.js';
import { saveProfileName } from '../lib/userProfile.js';
export default function AccountSettings({recording,onTracking}){
 const auth=useAuth(),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[cropFile,setCropFile]=useState(null);
 return <><p className="eyebrow">YOUR ACCOUNT</p><h2>{auth.preferences.displayName||'Your private world.'}</h2><p className="muted">{auth.session.user.email}</p><form onSubmit={async e=>{e.preventDefault();setError('');const name=new FormData(e.currentTarget).get('name').trim();try{await auth.savePreferences({displayName:name});if(auth.status!=='offline'){const {error}=await supabase.auth.updateUser({data:{display_name:name}});if(error)throw error;await saveProfileName(supabase,auth.session.user,name);}setMessage('Profile saved.');}catch(err){setError(err.message);}}}><label>Display name<input name="name" defaultValue={auth.preferences.displayName} required maxLength={100}/></label><label>Profile photo (optional)<input type="file" accept="image/*" onChange={e=>{setError('');setCropFile(e.target.files?.[0]||null);e.target.value='';}}/></label>{cropFile&&<ProfilePhotoCrop file={cropFile} onSave={async avatar=>{await auth.savePreferences({avatar});setCropFile(null);setMessage('Profile photo updated.');}} onCancel={()=>setCropFile(null)}/>}{auth.preferences.avatar&&<img className="profile-photo" src={auth.preferences.avatar} alt="Your profile"/>}<button className="secondary full">Save profile</button></form><button className="secondary full" disabled={busy||!config.pushEnabled||auth.status==='offline'} onClick={async()=>{setBusy(true);setError('');try{const result=await enableAccountPush(auth.session.user.id,e=>setError(e.message));if(result.enabled)await auth.savePreferences({notificationsEnabled:true});setMessage(result.enabled?'Notification permission enabled. Device registration is confirmed separately by the backend.':result.reason==='denied'?'Notifications were declined. You can change this in iOS Settings.':'Notifications require native/APNs configuration.');}catch(err){setError(err.message);}finally{setBusy(false);}}}><Bell size={17}/> Enable notifications</button>{!config.pushEnabled&&<p className="muted small-copy">Notifications are not available in this build yet. You can enable them here later.</p>}<AccountActions disabled={busy}/>
 <button type="button" className="secondary full" onClick={onTracking}>Tracking & Permissions</button>
 <PrivateBackup state={recording?.state}/>
{message&&<p className="notice" role="status">{message}</p>}{error&&<p className="error" role="alert">{error}</p>}</>;
}
