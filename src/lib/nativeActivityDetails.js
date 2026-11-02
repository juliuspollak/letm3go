import {Capacitor,registerPlugin} from '@capacitor/core';

const native=registerPlugin('ActivityDetails');

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
