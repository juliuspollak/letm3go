// Makes the activity being recorded private: its live trail stops at once and nobody can
// see it, however late a batch arrives, and the saved activity is never shared
// automatically. The phone is told first (it stops publishing and keeps telling the
// server until the server confirms, even with the app closed); the server is also told
// directly when online so viewers lose it without waiting.
export async function hideLiveActivity(ref,{recorder,client}){
 if(!ref)throw new Error('No activity is being recorded.');
 await recorder.hideLiveTrail(ref);
 if(client){try{await client.rpc('end_live_trail',{p_ref:ref,p_hide:true});}catch{/* the phone retries */}}
}
const key=ref=>`letm3go.liveHidden.${String(ref).toLowerCase()}`;
export const isLiveHidden=ref=>{try{return localStorage.getItem(key(ref))==='1';}catch{return false;}};
export const rememberLiveHidden=ref=>{try{localStorage.setItem(key(ref),'1');}catch{/* the phone remembers it too */}};
