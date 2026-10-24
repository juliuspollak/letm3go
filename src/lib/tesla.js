import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { supabase } from './supabase.js';
import { config } from './config.js';
export async function teslaRequest(action,params={}){
 if(!config.teslaEnabled)throw new Error('Tesla setup is not configured. Manual vehicles and iPhone recording remain available.');
 const {data:user,error:authError}=await supabase.auth.getUser();if(authError||!user.user)throw new Error('Sign in to connect your own Tesla account.');
 const {data,error}=await supabase.functions.invoke('tesla',{body:{action,...params}});if(error||data?.error)throw new Error(data?.error||'Tesla connection needs operator configuration or renewed consent.');return data;
}
export async function openTeslaURL(url){
 const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.hostname!=='auth.tesla.com'||!['/oauth2/v3/authorize','/user/revoke/consent'].includes(parsed.pathname))throw new Error('Invalid Tesla authorization URL.');
 if(Capacitor.isNativePlatform())await Browser.open({url:parsed.href});else window.location.assign(parsed.href);
}
