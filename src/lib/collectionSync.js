import {COLLECTION_PHOTO_LIMIT,normaliseCollectionItem} from './collection.js';
// Collection items are still authored locally. This module is the only path to
// cloud: it is additive, incremental (one RPC per changed item) and never
// deletes a local item. A photo is uploaded to private R2 before its object key
// is written, so a database row can never reference a missing object.
const PHOTO_PREFIX='data:image/jpeg;base64,';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORY=/^[a-z][a-z0-9_-]{0,31}$/;

// Mirrors the CHECK constraint, so a client mistake fails locally instead of
// producing a row the server rejects after the photo has been uploaded.
export function collectionPhotoKey(owner,id){return `${String(owner).toLowerCase()}/collection/${id}.jpg`;}

export function collectionBackupRow(owner,item){
 // Ids created by builds before the category catalogue were free-form strings.
 // They cannot satisfy the uuid column, and renaming them would break the
 // equipment references already stored on trips, so they stay device-local until
 // the owner re-creates the item (trip labels survive through the fallback name).
 if(!owner||!UUID.test(String(item?.id||'')))return null;
 const clean=normaliseCollectionItem(item);
 const text=(value,limit)=>String(value||'').trim().slice(0,limit);
 const attributes={};
 for(const [key,value] of Object.entries(clean.attributes||{})){
  if(Object.keys(attributes).length>=24)break;
  if(!/^[a-z][a-z0-9_]{0,31}$/.test(key))continue;
  const entry=String(value??'').trim().slice(0,120);
  if(entry)attributes[key]=entry;
 }
 return {id:clean.id,owner_id:owner,category:CATEGORY.test(clean.category)?clean.category:'other',
  name:text(clean.name,60),make:text(clean.make,60),model:text(clean.model,60),attributes,
  source:clean.source==='tesla'?'tesla':'manual',tesla_vehicle_id:text(item?.teslaVehicleID,100)||null,
  archived:clean.archived===true};
}

// Local wins on an id collision. A Tesla item that already exists on this device
// is matched by provider id so a restore can never duplicate a car.
export function mergeRestoredCollection(localItems,cloudItems,limit=50){
 const local=Array.isArray(localItems)?localItems:[];const next=[...local];let restored=0,skipped=0;
 for(const item of Array.isArray(cloudItems)?cloudItems:[]){
  if(!item||!UUID.test(String(item.id||''))){skipped++;continue;}
  const duplicate=next.some(existing=>String(existing?.id)===String(item.id)
   ||(item.tesla_vehicle_id&&existing?.teslaVehicleID&&String(existing.teslaVehicleID)===String(item.tesla_vehicle_id)));
  if(duplicate){skipped++;continue;}
  if(next.length>=limit){skipped++;continue;}
  // The native preferences validator rejects an empty name, so a legacy item
  // without one falls back to brand + model and finally to a neutral label.
  const brandModel=[item.make,item.model].map(value=>String(value||'').trim()).filter(Boolean).join(' ');
  // Only local-shaped fields are stored: server bookkeeping (object key, hash,
  // revision) stays in the receipts, never in the preferences file.
  next.push({id:item.id,category:item.category,name:String(item.name||'').trim()||brandModel||'Equipment',
   make:String(item.make||'').trim(),model:String(item.model||'').trim(),attributes:item.attributes||{},
   source:item.source==='tesla'?'tesla':'manual',teslaVehicleID:item.tesla_vehicle_id||undefined,
   archived:item.archived===true,photo:item.photo||undefined});
  restored++;
 }
 return {vehicles:next,restored,skipped};
}

async function sha256(cryptoImpl,value){
 const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
 return Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
}

function base64Photo(photo){
 if(typeof photo!=='string'||!photo.startsWith(PHOTO_PREFIX))return null;
 if(photo.length>COLLECTION_PHOTO_LIMIT)return null;
 return photo.slice(PHOTO_PREFIX.length);
}


export async function syncCollections(client,{owner,vehicles,receipts={}},{checkpoint=async()=>{},cryptoImpl=crypto}={}){
 if(!owner)throw new Error('Sign in before backing up your Collection.');
 if(!cryptoImpl?.subtle)throw new Error('Secure backup hashing is unavailable on this device.');
 const updated={...receipts};let uploaded=0,photosUploaded=0,deleted=0;
 const acknowledge=async()=>checkpoint({...updated});
 const items=Array.isArray(vehicles)?vehicles:[];

 // Removals are explicit receipts written when the owner removes an item, never
 // inferred from a device that simply has not restored yet.
 for(const [key,receipt] of Object.entries(receipts)){
  if(!key.startsWith('collection:')||receipt?.deleted!==true)continue;
  if(receipt.owner?.toLowerCase()!==owner.toLowerCase())throw new Error('Collection receipts belong to another account.');
  const id=key.slice('collection:'.length);
  if(!UUID.test(id)||items.some(item=>String(item?.id)===id))continue;
  const {error}=await client.rpc('delete_collection_item',{p_owner:owner,p_id:id});
  if(error)throw new Error('A Collection removal could not be confirmed. Retry when connected.');
  updated[key]={owner,deleted:true};deleted++;await acknowledge();
 }

 for(const item of items){
  const row=collectionBackupRow(owner,item);
  if(!row)continue;
  const key=`collection:${row.id}`,photoReceiptKey=`collection-photo:${row.id}`;
  const previous=updated[key],photoReceipt=updated[photoReceiptKey];
  if(previous&&previous.owner!==owner)throw new Error('Collection backup belongs to another account.');
  if(photoReceipt&&photoReceipt.owner!==owner)throw new Error('Collection photo belongs to another account.');

  const photo=base64Photo(item.photo);
  const photoSha=photo?await sha256(cryptoImpl,photo):null;
  if(photo&&photoReceipt?.sha256!==photoSha){
   if(!client.functions?.invoke)throw new Error('Collection photo upload service is unavailable. Photos remain safely on this iPhone.');
   const {data:result,error:failure}=await client.functions.invoke('journeys',{body:{action:'collectionPhoto',itemID:row.id,base64:photo,sha256:photoSha}});
   if(failure||!String(result?.objectKey||'').endsWith(`/collection/${row.id}.jpg`))throw new Error('A Collection photo could not be uploaded. The local original is preserved.');
   updated[photoReceiptKey]={owner,uploaded:true,sha256:photoSha};photosUploaded++;await acknowledge();
  }
  const payload={...row,photo_object_key:photo?collectionPhotoKey(owner,row.id):null,photo_sha256:photoSha};
  const fingerprint=await sha256(cryptoImpl,JSON.stringify(payload));
  if(previous?.fingerprint===fingerprint&&!previous.deleted)continue;
  const {data:revision,error}=await client.rpc('backup_collection_item',{p_owner:owner,p_payload:payload,p_fingerprint:fingerprint,p_expected_revision:previous?.revision??null});
  if(error||!Number.isInteger(revision))throw new Error('Collection backup needs the approved backend migration, or this item changed in the cloud. Your local Collection is preserved.');
  updated[key]={owner,fingerprint,revision};uploaded++;await acknowledge();
 }
 return {receipts:updated,uploaded,photosUploaded,deleted};
}

