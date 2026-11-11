// Makes the activity being recorded private: its live trail stops at once and nobody can
// see it, however late a batch arrives, and the saved activity is never shared
// automatically. The phone is told first (it stops publishing and keeps telling the
// server while live sharing is on, even with the app closed). The server is also told
// directly, and if that cannot be done now it is remembered and retried (when the app
// opens, comes back or is online) before anything is auto-shared, because the server's
// record is what keeps the finished activity out of automatic sharing.
const read=name=>{try{return JSON.parse(localStorage.getItem(name)||'[]');}catch{return [];}};
const write=(name,list)=>{try{localStorage.setItem(name,JSON.stringify(list));}catch{/* the phone remembers it too */}};
const PENDING='letm3go.liveHide.pending';
const key=ref=>`letm3go.liveHidden.${String(ref).toLowerCase()}`;
export const isLiveHidden=ref=>{try{return localStorage.getItem(key(ref))==='1';}catch{return false;}};
export const rememberLiveHidden=ref=>{try{localStorage.setItem(key(ref),'1');}catch{/* the phone remembers it too */}};
async function tellServer(client,ref){
 try{const result=await client.rpc('end_live_trail',{p_ref:ref,p_hide:true});return !result?.error;}catch{return false;}
}
export async function hideLiveActivity(ref,{recorder,client}){
 if(!ref)throw new Error('No activity is being recorded.');
 await recorder.hideLiveTrail(ref);
 rememberLiveHidden(ref);
 if(!client||!(await tellServer(client,ref))){const list=read(PENDING);if(!list.includes(ref))write(PENDING,[...list,ref].slice(-50));}
}
export async function flushPendingHides(client){
 const list=read(PENDING);
 if(!client||!list.length)return;
 const told=new Set();
 for(const ref of list)if(await tellServer(client,ref))told.add(ref);
 // Re-read: a hide added while this was waiting on the network must not be lost.
 write(PENDING,read(PENDING).filter(ref=>!told.has(ref)));
}

// What is known about a hide, for the screen: nothing asked, stopped on this phone but the
// server has not confirmed (others may still see what was already sent), or confirmed.
export function hideStatus(ref){
 if(!isLiveHidden(ref))return 'none';
 return read(PENDING).includes(ref)?'pending':'confirmed';
}
