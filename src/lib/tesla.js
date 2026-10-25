import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { supabase } from './supabase.js';
export async function teslaRequest(action,params={}){
 if(!supabase)throw new Error('Sign in to connect your own Tesla account.');
 const {data:user,error:authError}=await supabase.auth.getUser();if(authError||!user.user)throw new Error('Sign in to connect your own Tesla account.');
 const {data,error}=await supabase.functions.invoke('tesla',{body:{action,...params}});if(error||data?.error)throw new Error(data?.error||'Tesla connection needs Letm3go server setup. Your vehicles and iPhone tracking remain available.');return data;
}
export async function openTeslaURL(url){
 const parsed=new URL(url);if(parsed.username||parsed.password||parsed.port||parsed.protocol!=='https:'||parsed.hostname!=='auth.tesla.com'||!['/oauth2/v3/authorize','/user/revoke/consent'].includes(parsed.pathname))throw new Error('Invalid Tesla authorization URL.');
 if(Capacitor.isNativePlatform())await Browser.open({url:parsed.href});else window.location.assign(parsed.href);
}

export async function teslaRecordingRequest(action,params={}){
 if(!supabase)throw new Error('Sign in to manage vehicle recording.');
 const {data,error}=await supabase.auth.getUser();if(error||!data.user)throw new Error('Sign in to manage vehicle recording.');
 const result=await supabase.functions.invoke('tesla-recording',{body:{action,...params}});if(result.error||result.data?.error)throw new Error(result.data?.error||'Tesla recording setup is not available yet.');return result.data;
}
export async function openTeslaPairingURL(url){
 const parsed=new URL(url);if(parsed.origin!=='https://tesla.com'||parsed.pathname!=='/_ak/letm3go.au'||parsed.searchParams.size!==1||!/^[A-HJ-NPR-Z0-9]{17}$/.test(parsed.searchParams.get('vin')||''))throw new Error('Invalid pairing link');
 if(Capacitor.isNativePlatform())await Browser.open({url:parsed.href});else window.location.assign(parsed.href);
}
