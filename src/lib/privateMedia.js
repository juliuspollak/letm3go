import { registerPlugin } from '@capacitor/core';
const native=registerPlugin('ManualRecorder');
let owner=null,ownerGeneration=0;
const deletedActivities=new Set();
const cache=new Map();
export function setPrivateMediaOwner(id){if(owner!==id){cache.clear();deletedActivities.clear();ownerGeneration+=1;owner=id;}}
export function forgetActivityPhotos(ids=[],forOwner=owner){
 if(!owner||!forOwner||owner.toLowerCase()!==forOwner.toLowerCase())return;
 for(const id of ids)deletedActivities.add(id.toLowerCase());
 for(const src of cache.keys())if(deletedActivities.has(src.slice('private-photo:'.length).split('/')[1]?.toLowerCase()))cache.delete(src);
}
export async function resolvePhoto(src){
 if(!src?.startsWith('private-photo:'))return src;
 const [account,tripID,photoID]=src.slice('private-photo:'.length).split('/');
 if(!owner||account.toLowerCase()!==owner.toLowerCase())throw new Error('Photo belongs to a locked account.');
 if(deletedActivities.has(tripID.toLowerCase()))throw new Error('Photo is no longer available.');
 const generation=ownerGeneration;
 if(!cache.has(src)&&cache.size>=50)cache.delete(cache.keys().next().value);
 if(!cache.has(src)){
  const pending=native.readPhoto({ownerID:account,tripID,photoID}).then(({url})=>{
   if(generation!==ownerGeneration||owner?.toLowerCase()!==account.toLowerCase())throw new Error('Account changed.');
   if(deletedActivities.has(tripID.toLowerCase()))throw new Error('Photo is no longer available.');
   return url;
  }).catch(error=>{if(cache.get(src)===pending)cache.delete(src);throw error;});
  cache.set(src,pending);
 }
 return cache.get(src);
}
