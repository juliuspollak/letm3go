import { isDiscardedRefresh } from './authMessages.js';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase.js';
import { config } from './config.js';
import { authStorage, AUTH_STORAGE_KEY, accountStore, defaultPreferences } from './sessionStorage.js';
import { resolveIdentity, isTransientAuthError, definitiveIdentityFailure } from './authCore.js';
import { listenForNativeAuth, authRedirect } from './auth.js';
import { setPrivateMediaOwner } from './privateMedia.js';
import { stopAccountPush, resumeAccountPush } from './pushAccount.js';
import { ensureUserProfile, saveProfileAvatar } from './userProfile.js';
const Context=createContext(null);
export function AuthProvider({children}){
 const [identity,setIdentity]=useState({status:'restoring',session:null,preferences:defaultPreferences()}),[error,setError]=useState(''),[integrationWarning,setIntegrationWarning]=useState(''),[recovery,setRecovery]=useState(()=>new URLSearchParams(window.location.search).get('flow')==='recovery');
 const preferencesRef=useRef(defaultPreferences()),preferencesQueue=useRef(Promise.resolve());
 const [accountDeletionNotice,setAccountDeletionNotice]=useState(null);
 const boundOwner=useRef(null);
 const generation=useRef(0),explicitLogout=useRef(false),latestSession=useRef(null);
 const recorderRebind=useRef(null),lastRecorderRebind=useRef({owner:null,at:0});
 const invalidate=useCallback(()=>{generation.current+=1;},[]);
 const reconcile=useCallback(async(session)=>{
  const turn=++generation.current;latestSession.current=session;
  if(!session||boundOwner.current!==session.user.id){setIntegrationWarning('');setIdentity(old=>({...old,status:'restoring'}));setPrivateMediaOwner(null);}
  try{
   if(boundOwner.current&&boundOwner.current!==session?.user.id)await stopAccountPush();
   if(!session){await accountStore.lock();if(turn===generation.current)setIdentity({status:'signedOut',session:null,preferences:defaultPreferences()});return;}
   const next=await resolveIdentity({client:supabase,session,store:accountStore,apiKey:config.key,isCurrent:()=>turn===generation.current});
   if(turn!==generation.current)return;
   if(next.status==='authenticated'){
    next.verifiedAt=new Date().toISOString();
    try{
     const profile=await ensureUserProfile(supabase,next.session.user);
     if(turn!==generation.current)return;
     next.profileVerified=true;
     if(!next.preferences.displayName&&profile.display_name){const stored=await accountStore.save({...next.preferences,displayName:profile.display_name},next.session.user.id);next.preferences=stored.preferences;}
     // A replacement device has no local photo yet; the owner-only profile row
     // restores it before the first render that needs it.
     if(!next.preferences.avatar&&profile.avatar){const stored=await accountStore.save({...next.preferences,avatar:profile.avatar},next.session.user.id);next.preferences=stored.preferences;}
    }catch{if(turn!==generation.current)return;next.profileVerified=false;setIntegrationWarning('Signed in. Profile synchronization needs attention; reconnect and verify your account again.');}
   }
   if(turn!==generation.current)return;
   const remote=next.session?.user.user_metadata?.letm3go_onboarding_v1;
   if(next.status!=='deletionPending'&&next.preferences&&!next.preferences.onboardingComplete&&remote?.complete){
    const preferences={...next.preferences,onboardingComplete:true,onboardingStep:5,displayName:next.preferences.displayName||remote.display_name||''};
    const stored=await accountStore.save(preferences,next.session.user.id);next.preferences=stored.preferences;
   }
   if(turn!==generation.current)return;
   boundOwner.current=next.session?.user.id||null;
   preferencesRef.current=next.preferences||defaultPreferences();
   setPrivateMediaOwner(['authenticated','offline'].includes(next.status)?next.session.user.id:null);setIdentity(next);setError('');
  }catch(err){if(turn!==generation.current||isDiscardedRefresh(err))return;
   // Only a definitive identity failure signs the recorder out. A network,
   // timeout or bridge failure hides private data but must not end a journey
   // that native tracking is still recording.
   await (definitiveIdentityFailure(err)?accountStore.lock():(accountStore.suspend?.()??accountStore.lock())).catch(()=>{});if(turn!==generation.current)return;setError(err.message||'Sign in again to unlock your private data.');setIdentity({status:'reauth',session:null,preferences:defaultPreferences()});}
 },[]);
 useEffect(()=>{
  if(!supabase){const timer=setTimeout(()=>void reconcile(null),0);return()=>clearTimeout(timer);}
  let alive=true,stopNative,stopApp,restoring=false,discardedRetries=0;
  let restoreRetry;
  function retryDiscardedRefresh(){
   if(discardedRetries++<1)restoreRetry=setTimeout(()=>{if(alive&&!explicitLogout.current)void restore();},150);
   else if(!latestSession.current){setError('Please sign in again to continue. Your saved journeys are safe on this device.');setIdentity({status:'reauth',session:null,preferences:defaultPreferences()});}
  }
  async function restore(){
   if(restoring||explicitLogout.current)return;
   restoring=true;const startedGeneration=generation.current;
   try{
   await accountStore.preserveLegacy?.();
   let data,error,offlineOnly=false;
   try{({data,error}=await Promise.race([supabase.auth.getSession(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Session request timed out')),6000))]));}
   catch{offlineOnly=true;const cached=await authStorage.getItem(AUTH_STORAGE_KEY);if(!cached)throw new Error('No saved account session');data={session:JSON.parse(cached)};}
   if(!alive||explicitLogout.current||startedGeneration!==generation.current)return;
   if(isDiscardedRefresh(error)){retryDiscardedRefresh();return;}
   discardedRetries=0;
   if(error){if(!isTransientAuthError(error))throw error;const cached=await authStorage.getItem(AUTH_STORAGE_KEY);await reconcile(cached?JSON.parse(cached):null);}
   else if(offlineOnly&&data.session){const turn=++generation.current;const next=await resolveIdentity({client:supabase,session:data.session,store:accountStore,apiKey:config.key,isCurrent:()=>turn===generation.current,offlineOnly:true});if(turn===generation.current){latestSession.current=next.session;boundOwner.current=next.session.user.id;preferencesRef.current=next.preferences;setPrivateMediaOwner(next.session.user.id);setIdentity(next);setError('');}}
   else if(data.session||!latestSession.current)await reconcile(data.session);
  }catch(err){if(alive&&!explicitLogout.current&&startedGeneration===generation.current){if(isDiscardedRefresh(err)){retryDiscardedRefresh();return;}setError('Please sign in again to continue. Your saved journeys are safe on this device.');setIdentity({status:'reauth',session:null,preferences:defaultPreferences()});}}finally{restoring=false;}}
  const {data:listener}=supabase.auth.onAuthStateChange((event,session)=>{
   if(!alive||explicitLogout.current)return;
   if(event==='PASSWORD_RECOVERY')setRecovery(true);
   // Auth requests must run outside Supabase's callback/session lock.
   setTimeout(()=>{if(alive&&!explicitLogout.current)void reconcile(session);},0);
  });
  void restore();
  const report=()=>{if(alive)setError('The sign-in link could not be completed. Request a new link and retry.');};
  listenForNativeAuth(report,()=>setRecovery(true)).then(stop=>{if(alive)stopNative=stop;else stop();}).catch(report);
  const visible=()=>{if(document.visibilityState==='visible'&&!explicitLogout.current)void restore();};
  const warn=event=>{if(event.detail?.ownerID===latestSession.current?.user.id)setIntegrationWarning(event.detail.message);};
  const completed=event=>{if(event.detail?.session){explicitLogout.current=false;void reconcile(event.detail.session);}};
  const accountWarning=event=>{if(event.detail?.ownerID&&event.detail.ownerID===latestSession.current?.user.id)setAccountDeletionNotice({ownerID:event.detail.ownerID,message:event.detail.message});};
  window.addEventListener('letm3go:account-service-warning',accountWarning);
  window.addEventListener('letm3go:auth-completed',completed);
  window.addEventListener('letm3go:integration-warning',warn);
  document.addEventListener('visibilitychange',visible);
  if(Capacitor.isNativePlatform())NativeApp.addListener('appStateChange',({isActive})=>{if(isActive){supabase.auth.startAutoRefresh();void restore();}else supabase.auth.stopAutoRefresh();}).then(handle=>{if(alive)stopApp=handle;else void handle.remove();}).catch(report);
  return()=>{alive=false;clearTimeout(restoreRetry);invalidate();listener.subscription.unsubscribe();stopNative?.();void stopApp?.remove();document.removeEventListener('visibilitychange',visible);window.removeEventListener('letm3go:integration-warning',warn);window.removeEventListener('letm3go:account-service-warning',accountWarning);window.removeEventListener('letm3go:auth-completed',completed);};
 },[reconcile,invalidate]);
 useEffect(()=>{
  const owner=identity.session?.user.id;
  if(!owner||!['authenticated','offline'].includes(identity.status)||!identity.preferences?.notificationsEnabled||!config.pushEnabled)return;
  let alive=true;const report=()=>{if(alive)setIntegrationWarning('Notification registration needs attention. Review notification settings after reconnecting.');};
  void resumeAccountPush(owner,report).catch(report);return()=>{alive=false;};
 },[identity.session?.user.id,identity.status,identity.preferences?.notificationsEnabled]);
 async function signOut(){
  explicitLogout.current=true;++generation.current;setPrivateMediaOwner(null);
  try{await accountStore.lock();}
  catch(err){explicitLogout.current=false;setError(err.message);throw err;}
  // Once the native recorder is safely locked, auxiliary token/push cleanup must
  // not leave the UI apparently signed in. A later sign-in replaces these values.
  let cleanupFailed=false;
  try{await stopAccountPush();}catch{cleanupFailed=true;}
  supabase?.auth.stopAutoRefresh();
  try{const result=await supabase?.auth.signOut({scope:'local'});if(result?.error)cleanupFailed=true;}catch{cleanupFailed=true;}
  for(const key of [AUTH_STORAGE_KEY,`${AUTH_STORAGE_KEY}-code-verifier`,`${AUTH_STORAGE_KEY}-user`,'letm3go-oauth-pending']){
   try{await authStorage.removeItem(key);}catch{cleanupFailed=true;}
  }
  if(cleanupFailed)setIntegrationWarning('Signed out locally. Some session cleanup could not be confirmed.');
  latestSession.current=null;boundOwner.current=null;setIdentity({status:'signedOut',session:null,preferences:defaultPreferences()});setRecovery(false);setError('');
 }
 async function savePreferences(patch){
  const owner=identity.session?.user.id;
  const operation=async()=>{
   if(!owner||latestSession.current?.user.id!==owner)throw new Error('Account changed. Settings were not saved.');
   const preferences={...preferencesRef.current,...patch};const result=await accountStore.save(preferences,owner);
   if(latestSession.current?.user.id!==owner)throw new Error('Account changed.');
   preferencesRef.current=result.preferences;setIdentity(old=>({...old,preferences:result.preferences}));
   // The decrypted device copy stays authoritative. The owner-only profile copy
   // of the photo is best-effort, so a replacement device can still show it.
   if(supabase&&Object.hasOwn(patch,'avatar')&&latestSession.current?.user){
    try{await saveProfileAvatar(supabase,latestSession.current.user,result.preferences.avatar||null);}
    catch{setIntegrationWarning('Profile photo saved on this device but not yet in the cloud. Reconnect and choose it again if you replace this iPhone.');}
   }
   return result.preferences;
  };
  const task=preferencesQueue.current.then(operation,operation);preferencesQueue.current=task.catch(()=>{});return task;
 }
 async function deleteAccount(){
  if(identity.status==='offline')throw new Error('Reconnect before deleting your account.');
  explicitLogout.current=true;++generation.current;setPrivateMediaOwner(null);setIdentity(old=>({...old,status:'deleting'}));
  try{await accountStore.prepareDelete();await stopAccountPush();
   const {data,error}=await supabase.functions.invoke('account',{body:{action:'delete',confirmation:'DELETE'}});if(error||data?.deleted!==true)throw new Error('Deletion could not be confirmed. Please reconnect, sign in again and retry.');
   await accountStore.deleteLocal();await signOut();
  }catch(err){explicitLogout.current=false;await reconcile(latestSession.current);setError(err.message);throw err;}
 }
 const beginSignIn=async()=>{supabase?.auth.stopAutoRefresh();await accountStore.beginSignIn();explicitLogout.current=false;setError('');supabase?.auth.startAutoRefresh();};
 async function updatePassword(password){const {error}=await supabase.auth.updateUser({password});if(error)throw error;setRecovery(false);window.history.replaceState({},'',window.location.pathname);await reconcile(latestSession.current);}
 const rebindRecorder=useCallback(async ownerID=>{
  const session=latestSession.current;
  if(explicitLogout.current||!session||ownerID?.toLowerCase()!==session.user.id.toLowerCase())return false;
  if(recorderRebind.current)return recorderRebind.current;
  // A native recorder failure used to initiate full authentication every 2s.
  // This remounted the private app repeatedly and concealed the original error.
  const now=Date.now();
  if(lastRecorderRebind.current.owner===session.user.id&&now-lastRecorderRebind.current.at<30000)return false;
  lastRecorderRebind.current={owner:session.user.id,at:now};
  const operation=reconcile(session).then(()=>true).finally(()=>{if(recorderRebind.current===operation)recorderRebind.current=null;});
  recorderRebind.current=operation;return operation;
 },[reconcile]);
 return <Context.Provider value={{...identity,error,integrationWarning,accountDeletionNotice:accountDeletionNotice&&accountDeletionNotice.ownerID===identity.session?.user.id?accountDeletionNotice.message:'',recovery,setError,beginSignIn,cancelRecovery:()=>{setRecovery(false);window.history.replaceState({},'',window.location.pathname);},signOut,deleteAccount,savePreferences,updatePassword,rebindRecorder,retry:()=>reconcile(latestSession.current),redirect:authRedirect}}>{children}</Context.Provider>;
}
// One provider/session manager for the entire private application.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(){return useContext(Context);}
