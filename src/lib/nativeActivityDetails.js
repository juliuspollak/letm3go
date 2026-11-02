import {Capacitor,registerPlugin} from '@capacitor/core';

const native=registerPlugin('ActivityDetails');

// Chooses the whole screen before Activity Details opens, once per launch, so one
// session never mixes the two. `off` (the default) keeps the React screen for
// everyone; `testing` lets a tester opt in from Diagnostics; `on` is the cutover
// switch and is not set by any build yet.
export const NATIVE_DETAILS_OPT_IN='letm3go-native-activity-details';
export function nativeDetailsMode(env=import.meta.env){
 const mode=env?.VITE_NATIVE_ACTIVITY_DETAILS;
 return mode==='on'||mode==='testing'?mode:'off';
}
export function resolveNativeDetails({platform=Capacitor.getPlatform(),mode=nativeDetailsMode(),storage=globalThis.localStorage}={}){
 if(platform!=='ios'||mode==='off')return false;
 if(mode==='on')return true;
 try{return storage?.getItem(NATIVE_DETAILS_OPT_IN)==='1';}catch{return false;}
}
let decided=null;
export function nativeDetailsEnabled(){
 if(decided===null)decided=resolveNativeDetails();
 return decided;
}
// A build without the native plugin falls back for the rest of the launch.
export function disableNativeDetails(){decided=false;}
export function resetNativeDetailsDecision(){decided=null;}
export function setNativeDetailsOptIn(enabled,storage=globalThis.localStorage){
 if(enabled)storage?.setItem(NATIVE_DETAILS_OPT_IN,'1');else storage?.removeItem(NATIVE_DETAILS_OPT_IN);
}

export const nativeDetails={
 present:presentation=>native.present({presentation}),
 update:presentation=>native.update({presentation}),
 dismiss:options=>native.dismiss(options||{}),
 reset:()=>native.reset(),
 respond:reply=>native.respond(reply),
 addListener:(event,callback)=>native.addListener(event,callback),
};

// A page load owns no native screen: a web content reload runs no React cleanup,
// and a screen left open would wait for answers from a page that no longer exists.
if(Capacitor.getPlatform()==='ios')Promise.resolve().then(()=>native.reset()).catch(()=>{});
