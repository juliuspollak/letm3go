import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from './supabase.js';
import { enableNativePush } from './nativeNotifications.js';
import {newUUID} from './uuid.js';
let activeOwner=null,dispose=null;
// The last registration outcome on this phone, shown in Account & settings so a
// failure is visible. Never the device token.
const STATUS_KEY='letm3go-push-status';
export function pushStatus(){try{return JSON.parse(localStorage.getItem(STATUS_KEY)||'null');}catch{return null;}}
function recordStatus(owner,state,reason=''){try{localStorage.setItem(STATUS_KEY,JSON.stringify({owner,state,reason:String(reason).slice(0,120),at:Date.now()}));}catch{/* display only */}}
const installationID=()=>{let id=localStorage.getItem('letm3go-installation');if(!id){id=newUUID();localStorage.setItem('letm3go-installation',id);}return id;};
export async function enableAccountPush(owner,onError){
 if(activeOwner===owner&&dispose)return {enabled:true};
 if(dispose)await dispose();activeOwner=owner;
 // Apple refusing to issue a token (registrationError) is recorded too.
 const report=error=>{recordStatus(owner,'failed',error?.message||'Registration failed');onError(error);};
 const result=await enableNativePush({onError:report,persistToken:async({token,environment})=>{
  if(activeOwner!==owner)return;
  const {data,error:authError}=await supabase.auth.getUser();if(authError||data.user?.id!==owner)throw new Error('Sign in before registering notifications.');
  if(activeOwner!==owner)return;
  const {error}=await supabase.rpc('register_push_device',{p_installation:installationID(),p_token:token,p_environment:environment,p_owner:owner});
  if(error){recordStatus(owner,'failed',error.message);throw new Error('Notification registration needs backend configuration.');}
  recordStatus(owner,`registered (${environment})`);
 }});dispose=result.dispose;if(!result.enabled)recordStatus(owner,result.reason==='denied'?'declined':'unavailable');return result;
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
