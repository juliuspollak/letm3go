import {removeJourneyRecords} from './journeyDurableStorage.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
const secure=registerPlugin('SecureSession');
export const AUTH_STORAGE_KEY='letm3go-auth';
// The Supabase client reads its session from here before every request, and on a phone each read crosses to native code
// (about 70 a minute while the app was merely syncing). The answer cannot change without this module writing it, so it is
// kept for a few seconds, shared between reads that overlap, and dropped the moment anything is written or removed.
const READ_TTL_MS=3000;
const readCache=new Map(),readsInFlight=new Map(),writes=new Map();
const forget=key=>{writes.set(key,(writes.get(key)||0)+1);readCache.delete(key);readsInFlight.delete(key);};
async function readNative(key){
  const {value,signedOut}=await secure.get({key});
  if(signedOut){localStorage.removeItem(key);return null;}
  if(value!=null){localStorage.removeItem(key);return value;}
  // Upgrade only Supabase session/verifier keys; native binding still verifies identity.
  if(value==null){const old=localStorage.getItem(key);if(old!=null){await secure.set({key,value:old});localStorage.removeItem(key);return old;}}
  return value;
}
export const authStorage={
 async getItem(key){
  if(!Capacitor.isNativePlatform())return key===AUTH_STORAGE_KEY&&localStorage.getItem('letm3go-signed-out')?null:localStorage.getItem(key);
  const hit=readCache.get(key);
  if(hit&&Date.now()-hit.at<READ_TTL_MS)return hit.value;
  if(readsInFlight.has(key))return readsInFlight.get(key);
  const generation=writes.get(key)||0;
  const read=readNative(key).then(value=>{if((writes.get(key)||0)===generation)readCache.set(key,{value,at:Date.now()});return value;}).finally(()=>{if(readsInFlight.get(key)===read)readsInFlight.delete(key);});
  readsInFlight.set(key,read);
  return read;
 },
 async setItem(key,value){forget(key);if(Capacitor.isNativePlatform()){await secure.set({key,value});localStorage.removeItem(key);}else localStorage.setItem(key,value);forget(key);},
 async removeItem(key){forget(key);if(Capacitor.isNativePlatform())await secure.remove({key});localStorage.removeItem(key);forget(key);},
 // For tests, and for a sign-in that is about to replace the session.
 clearReadCache(){for(const key of new Set([...readCache.keys(),...readsInFlight.keys()]))writes.set(key,(writes.get(key)||0)+1);readCache.clear();readsInFlight.clear();},
};
const defaults=()=>({displayName:'',avatar:null,vehicles:[],onboardingStep:0,onboardingComplete:false,notificationsEnabled:false,distanceUnit:'km',demoOverrides:null,bookmarks:[]});
let webOwner=null;
export const accountStore={
 async beginSignIn(){
  authStorage.clearReadCache();
  if(Capacitor.isNativePlatform())await secure.beginSignIn();
  localStorage.removeItem(AUTH_STORAGE_KEY);localStorage.removeItem(`${AUTH_STORAGE_KEY}-user`);localStorage.removeItem('letm3go-signed-out');
 },
 async preserveLegacy(){
  if(!Capacitor.isNativePlatform())return;
  const keys=['letm3go-vehicles','letm3go-bookmarks','letm3go-demo-v1'];const values=Object.fromEntries(keys.map(key=>[key,localStorage.getItem(key)]).filter(([,value])=>value!=null));
  if(Object.keys(values).length){await secure.preserveLegacy({value:JSON.stringify(values)});keys.forEach(key=>localStorage.removeItem(key));}
 },
 async bind(session,apiKey,{offline=false}={}){
  authStorage.clearReadCache();   // a native account change must never be answered from a few-seconds-old read
  if(Capacitor.isNativePlatform()){
   const result=await secure.bindAccount({ownerID:session.user.id,accessToken:session.access_token,apiKey});
   if(result?.ownerID?.toLowerCase()!==session.user.id.toLowerCase()||result.storageReady!==true)throw new Error('Private activity storage did not open for this account.');
   return result;
  }
  const id=session.user.id;if(offline&&localStorage.getItem('letm3go-verified-user')!==id)throw new Error('Connect to verify this account before opening private data.');webOwner=id;localStorage.removeItem('letm3go-signed-out');localStorage.setItem('letm3go-verified-user',id);
  let preferences;try{preferences=JSON.parse(localStorage.getItem(`letm3go-account-${id}`));}catch{ /* Use safe defaults. */ }
  return {ownerID:id,preferences:{...defaults(),...preferences}};
 },
 // Hide private data after a failed verification without signing out: the native
 // recorder stays bound and keeps recording until the session is verified again.
 async suspend(){authStorage.clearReadCache();if(Capacitor.isNativePlatform())await secure.suspendInterface();webOwner=null;},
 async lock(){authStorage.clearReadCache();if(Capacitor.isNativePlatform())await secure.lockAccount();localStorage.setItem('letm3go-signed-out','1');webOwner=null;localStorage.removeItem('letm3go-verified-user');},
 async save(preferences,ownerID){
  // Match JSON persistence on the web: non-finite optional numbers become null,
  // and undefined keys are omitted before WebKit bridges values to Foundation.
  const serialised=JSON.stringify(preferences);
  const persisted=JSON.parse(serialised);
  if(Capacitor.isNativePlatform())return secure.savePreferences({preferences:persisted,ownerID});
  if(!webOwner||webOwner!==ownerID)throw new Error('Sign in to save settings.');localStorage.setItem(`letm3go-account-${webOwner}`,serialised);return {ownerID:webOwner,preferences:persisted};
 },
 async prepareDelete(){if(Capacitor.isNativePlatform())await secure.prepareDeletion();},
 async deleteLocal(){authStorage.clearReadCache();if(Capacitor.isNativePlatform())await secure.deleteLocalAccount({confirmation:'DELETE'});else if(webOwner){await removeJourneyRecords(webOwner);localStorage.removeItem(`letm3go-account-${webOwner}`);webOwner=null;}},
};
export const defaultPreferences=defaults;
