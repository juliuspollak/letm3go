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
export function cachedDay(viewer,owner,date){
 const days=slot(viewer,owner),entry=days.get(date);
 if(entry){days.delete(date);days.set(date,entry);}
 return entry||null;
}
// Reading without touching the order, for use while rendering.
export const peekDay=(viewer,owner,date)=>store.get(`${viewer}|${owner}`)?.get(date)||null;
export function storeDay(viewer,owner,date,entry){
 const days=slot(viewer,owner);
 days.delete(date);days.set(date,entry);
 while(days.size>MAX_DAYS)days.delete(days.keys().next().value);
}
export function dropDay(viewer,owner,date){slot(viewer,owner).delete(date);}
export function clearPersonDays(viewer=null){
 for(const key of [...store.keys()])if(viewer==null||key.startsWith(viewer+'|'))store.delete(key);
}
// Rows the server sent as "unchanged" (points null) take their geometry from what we
// already hold, so a revalidation moves only what changed.
export function mergeRows(previous=[],incoming=[]){
 const known=new Map(previous.map(row=>[row.activity_id,row]));
 return incoming.map(row=>row.points==null?(known.get(row.activity_id)&&known.get(row.activity_id).etag===row.etag?known.get(row.activity_id):null):row).filter(Boolean);
}
