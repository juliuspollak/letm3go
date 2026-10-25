import { Capacitor, registerPlugin } from '@capacitor/core';
const secure=registerPlugin('SecureSession');
export const AUTH_STORAGE_KEY='letm3go-auth';
export const authStorage={
 async getItem(key){
  if(!Capacitor.isNativePlatform())return key===AUTH_STORAGE_KEY&&localStorage.getItem('letm3go-signed-out')?null:localStorage.getItem(key);
  const {value,signedOut}=await secure.get({key});
  if(signedOut){localStorage.removeItem(key);return null;}
  if(value!=null){localStorage.removeItem(key);return value;}
  // Upgrade only Supabase session/verifier keys; native binding still verifies identity.
  if(value==null){const old=localStorage.getItem(key);if(old!=null){await secure.set({key,value:old});localStorage.removeItem(key);return old;}}
  return value;
 },
 async setItem(key,value){if(Capacitor.isNativePlatform()){await secure.set({key,value});localStorage.removeItem(key);}else localStorage.setItem(key,value);},
 async removeItem(key){if(Capacitor.isNativePlatform())await secure.remove({key});localStorage.removeItem(key);},
};
const defaults=()=>({displayName:'',avatar:null,vehicles:[],onboardingStep:0,onboardingComplete:false,notificationsEnabled:false,distanceUnit:'km',demoOverrides:null,bookmarks:[]});
let webOwner=null;
export const accountStore={
 async beginSignIn(){
  if(Capacitor.isNativePlatform())await secure.beginSignIn();
  localStorage.removeItem(AUTH_STORAGE_KEY);localStorage.removeItem(`${AUTH_STORAGE_KEY}-user`);localStorage.removeItem('letm3go-signed-out');
 },
 async preserveLegacy(){
  if(!Capacitor.isNativePlatform())return;
  const keys=['letm3go-vehicles','letm3go-bookmarks','letm3go-demo-v1'];const values=Object.fromEntries(keys.map(key=>[key,localStorage.getItem(key)]).filter(([,value])=>value!=null));
  if(Object.keys(values).length){await secure.preserveLegacy({value:JSON.stringify(values)});keys.forEach(key=>localStorage.removeItem(key));}
 },
 async bind(session,apiKey,{offline=false}={}){
  if(Capacitor.isNativePlatform())return secure.bindAccount({ownerID:session.user.id,accessToken:session.access_token,apiKey});
  const id=session.user.id;if(offline&&localStorage.getItem('letm3go-verified-user')!==id)throw new Error('Connect to verify this account before opening private data.');webOwner=id;localStorage.removeItem('letm3go-signed-out');localStorage.setItem('letm3go-verified-user',id);
  let preferences;try{preferences=JSON.parse(localStorage.getItem(`letm3go-account-${id}`));}catch{ /* Use safe defaults. */ }
  return {ownerID:id,preferences:{...defaults(),...preferences}};
 },
 async lock(){if(Capacitor.isNativePlatform())await secure.lockAccount();localStorage.setItem('letm3go-signed-out','1');webOwner=null;localStorage.removeItem('letm3go-verified-user');},
 async save(preferences,ownerID){
  if(Capacitor.isNativePlatform())return secure.savePreferences({preferences,ownerID});
  if(!webOwner||webOwner!==ownerID)throw new Error('Sign in to save settings.');localStorage.setItem(`letm3go-account-${webOwner}`,JSON.stringify(preferences));return {ownerID:webOwner,preferences};
 },
 async prepareDelete(){if(Capacitor.isNativePlatform())await secure.prepareDeletion();},
 async deleteLocal(){if(Capacitor.isNativePlatform())await secure.deleteLocalAccount({confirmation:'DELETE'});else if(webOwner){localStorage.removeItem(`letm3go-account-${webOwner}`);webOwner=null;}},
};
export const defaultPreferences=defaults;
