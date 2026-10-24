import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from './supabase.js';
import { enableNativePush } from './nativeNotifications.js';
let activeOwner=null,dispose=null;
const installationID=()=>{let id=localStorage.getItem('letm3go-installation');if(!id){id=crypto.randomUUID();localStorage.setItem('letm3go-installation',id);}return id;};
export async function enableAccountPush(owner,onError){
 if(activeOwner===owner&&dispose)return {enabled:true};
 if(dispose)await dispose();activeOwner=owner;
 const result=await enableNativePush({onError,persistToken:async({token,environment})=>{
  if(activeOwner!==owner)return;
  const {data,error:authError}=await supabase.auth.getUser();if(authError||data.user?.id!==owner)throw new Error('Sign in before registering notifications.');
  if(activeOwner!==owner)return;
  const {error}=await supabase.rpc('register_push_device',{p_installation:installationID(),p_token:token,p_environment:environment,p_owner:owner});if(error)throw new Error('Notification registration needs backend configuration.');
 }});dispose=result.dispose;return result;
}
export async function stopAccountPush(){
 const previous=activeOwner;activeOwner=null;if(dispose){await dispose();dispose=null;}
 if(!Capacitor.isNativePlatform())return;
 // Stop local delivery even offline; server jobs must also validate session binding.
 await Promise.allSettled([PushNotifications.unregister(),PushNotifications.removeAllDeliveredNotifications()]);
 if(previous&&supabase){try{await supabase.rpc('unregister_push_device',{p_installation:installationID(),p_owner:previous});}catch{/* Retry registration assigns the installation to a fresh authenticated session. */}}
}

export async function resumeAccountPush(owner,onError){
 if(!Capacitor.isNativePlatform())return;
 const permission=await PushNotifications.checkPermissions();
 if(permission.receive==='granted')await enableAccountPush(owner,onError);
}
