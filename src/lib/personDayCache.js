// A bounded cache of other people's days, per signed-in viewer. Switching account
// can never show the previous account's data because the viewer is part of the key,
// and a sign-out drops everything held for that viewer.
const MAX_OWNERS=6,MAX_DAYS=16;
const store=new Map(); // `${viewer}|${owner}` -> Map(date -> entry)
const slot=(viewer,owner)=>{
 const key=`${viewer}|${owner}`;
 let days=store.get(key);
 if(days)store.delete(key);else days=new Map();
 store.set(key,days);
 while(store.size>MAX_OWNERS)store.delete(store.keys().next().value);
 return days;
};
// Every person's data has an epoch that moves whenever access to it may have changed (a
// signal, the person being dropped, the viewer signing out). A response that started before
// the epoch moved may have been computed before the change, so it is never stored or shown.
const epochs=new Map();
export const epochOf=(viewer,owner)=>epochs.get(`${viewer}|${owner}`)||0;
const bump=key=>epochs.set(key,(epochs.get(key)||0)+1);
export function cachedDay(viewer,owner,date){
 const days=slot(viewer,owner),entry=days.get(date);
 if(entry){days.delete(date);days.set(date,entry);}
 return entry||null;
}
// Reading without touching the order, for use while rendering.
export const peekDay=(viewer,owner,date)=>store.get(`${viewer}|${owner}`)?.get(date)||null;
// A cached day may be SHOWN straight away only while it is recent. An older one waits
// for the server's answer first, so a permission that was withdrawn meanwhile (a friend
// removed, someone who left the household, an activity made private) is not displayed
// from memory. Revalidation always follows either way.
export const SHOW_CACHED_MS=5*60*1000;
export function peekFreshDay(viewer,owner,date,maxAge=SHOW_CACHED_MS){
 const entry=peekDay(viewer,owner,date);
 return entry&&Date.now()-entry.at<=maxAge?entry:null;
}
// The person is no longer someone I may see: forget everything held about them.
export function dropOwner(viewer,owner){store.delete(`${viewer}|${owner}`);bump(`${viewer}|${owner}`);}
// Access may have changed for anyone: nothing held counts as verified any more (it is not
// shown from memory until the server has confirmed it again), and responses already on
// their way are discarded.
export function invalidateViewer(viewer){
 for(const [key,days] of store)if(key.startsWith(viewer+'|')){for(const entry of days.values())entry.at=0;}
 for(const key of new Set([...store.keys(),...epochs.keys()]))if(key.startsWith(viewer+'|'))bump(key);
}
export function storeDay(viewer,owner,date,entry){
 const days=slot(viewer,owner);
 days.delete(date);days.set(date,entry);
 while(days.size>MAX_DAYS)days.delete(days.keys().next().value);
}
export function clearPersonDays(viewer=null){
 for(const key of new Set([...store.keys(),...epochs.keys()]))if(viewer==null||key.startsWith(viewer+'|')){store.delete(key);bump(key);}
}
// Rows the server sent as "unchanged" (points null) take their geometry from what we
// already hold, so a revalidation moves only what changed.
export function mergeRows(previous=[],incoming=[]){
 const known=new Map(previous.map(row=>[row.activity_id,row]));
 return incoming.map(row=>row.points==null?(known.get(row.activity_id)&&known.get(row.activity_id).etag===row.etag?known.get(row.activity_id):null):row).filter(Boolean);
}
