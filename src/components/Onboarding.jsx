import BrandMark from './BrandMark.jsx';
import {useState} from 'react';
import {ArrowRight,User} from 'lucide-react';
import {useAuth} from '../lib/AuthContext.jsx';
import {supabase} from '../lib/supabase.js';
import {saveProfileName} from '../lib/userProfile.js';
import {profileImage} from '../lib/profileImage.js';

export default function Onboarding(){
 const auth=useAuth();
 const [busy,setBusy]=useState(false),[photoBusy,setPhotoBusy]=useState(false),[error,setError]=useState('');
 async function finish(event){
  event.preventDefault();setBusy(true);setError('');
  try{
   const name=new FormData(event.currentTarget).get('displayName').trim();
   if(!name)throw new Error('Enter your name.');
   if(supabase&&auth.status!=='offline')await saveProfileName(supabase,auth.session.user,name);
   // Keep the existing completion marker compatible with returning installations.
   try{sessionStorage.setItem('letm3go:family-setup',auth.session.user.id);}catch{/* The app can still open without session storage. */}
   await auth.savePreferences({displayName:name,onboardingStep:5,onboardingComplete:true});
   if(supabase&&auth.status!=='offline'){
    // Account metadata is a best-effort cross-device hint; local completion is durable.
    void supabase.auth.updateUser({data:{letm3go_onboarding_v1:{step:5,complete:true,display_name:name}}}).catch(()=>{});
   }
  }catch(err){setError(err.message||'Your profile could not be saved.');}
  finally{setBusy(false);}
 }
 return <main className="onboarding"><header><span className="auth-wordmark">letm<span>3</span>go<BrandMark/></span><button className="text-button" onClick={()=>auth.signOut().catch(err=>setError(err.message))}>Sign out</button></header><div className="onboarding-content"><p className="eyebrow">LET’S GET YOU STARTED</p><h1>What should we call you?</h1><p className="muted">Add your name, then create or join your household. You can set up everything else later.</p><form onSubmit={finish}><label>Display name<input name="displayName" required maxLength={100} defaultValue={auth.preferences.displayName||auth.session.user.user_metadata?.full_name||auth.session.user.user_metadata?.name||''} autoComplete="nickname"/></label><label className="avatar-upload">{auth.preferences.avatar?<img src={auth.preferences.avatar} alt="Your profile"/>:<User size={28}/>}<span>Add a photo (optional)</span><input aria-label="Profile photo" type="file" accept="image/*" disabled={busy||photoBusy} onChange={async event=>{const file=event.target.files[0];if(!file)return;setPhotoBusy(true);setError('');try{await auth.savePreferences({avatar:await profileImage(file)});}catch(err){setError(err.message);}finally{setPhotoBusy(false);}}}/></label><button className="primary full" disabled={busy||photoBusy}>{busy?'Saving…':'Continue'}<ArrowRight size={17}/></button></form><p className="muted small-copy">Location sharing stays off until you choose to turn it on.</p>{error&&<p role="alert" className="error">{error}</p>}</div></main>;
}
