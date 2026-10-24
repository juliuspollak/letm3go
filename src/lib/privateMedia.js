import { registerPlugin } from '@capacitor/core';
const native=registerPlugin('ManualRecorder');
let owner=null;
const cache=new Map();
export function setPrivateMediaOwner(id){if(owner!==id){cache.clear();owner=id;}}
export async function resolvePhoto(src){
 if(!src?.startsWith('private-photo:'))return src;
 const [account,tripID,photoID]=src.slice('private-photo:'.length).split('/');
 if(!owner||account.toLowerCase()!==owner.toLowerCase())throw new Error('Photo belongs to a locked account.');
 if(!cache.has(src))cache.set(src,native.readPhoto({ownerID:account,tripID,photoID}).then(({url})=>{if(owner?.toLowerCase()!==account.toLowerCase())throw new Error('Account changed.');return url;}).catch(error=>{cache.delete(src);throw error;}));
 return cache.get(src);
}
