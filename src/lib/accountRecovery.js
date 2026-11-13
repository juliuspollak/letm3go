import {mergeRestoredCollection,COLLECTION_RECOVERY_BATCH} from './collectionSync.js';
import {mergeRestoredSettings} from './settingsSync.js';
import {receiptPatch} from './syncReceipts.js';
import {COLLECTION_PHOTO_LIMIT} from './collection.js';

// Read before upload on each signed-in launch. Only missing local data is added;
// existing receipts/edits and explicit local removals keep their authority.
export async function recoverAccountPreferences(client,{owner,preferences,savePreferences,isCurrent=()=>true,cryptoImpl=crypto}){
 const check=()=>{if(!isCurrent())throw new Error('Account changed during cloud recovery.');};
 const readController=new AbortController(),readTimer=setTimeout(()=>readController.abort(),10000);
 let items,settings;
 try{[items,settings]=await Promise.all([
  client.from('collection_items').select('id,category,name,make,model,attributes,source,tesla_vehicle_id,archived,photo_object_key,photo_sha256,revision,sync_fingerprint').eq('owner_id',owner).is('deleted_at',null).order('id').limit(200).abortSignal(readController.signal),
  client.from('account_settings').select('payload,revision,sync_fingerprint').eq('owner_id',owner).maybeSingle().abortSignal(readController.signal),
 ]);}finally{clearTimeout(readTimer);}
 check();
 if(items.error||settings.error)throw new Error('Cloud Collection and settings recovery will retry when connected.');
 const receipts=preferences.syncReceipts||{},local=preferences.vehicles||[],rows=items.data||[];
 const candidates=rows.filter(row=>!receipts[`collection:${row.id}`]?.deleted);
 const cloud=[];let downloads=0,pending=false;
 for(const row of candidates){
  check();
  const existing=local.find(item=>item.id.toLowerCase()===row.id.toLowerCase());
  const photoReceipt=receipts[`collection-photo:${row.id}`];
  let photo=existing?.photo||null;
  // An existing local item is never rewritten merely because the cloud has one.
  if(row.photo_object_key&&!photo&&(!existing||photoReceipt?.restorePending)){
   if(downloads>=COLLECTION_RECOVERY_BATCH)pending=true;
   else {
    downloads++;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try {
     const {data:link,error}=await client.functions.invoke('journeys',{body:{action:'collectionDownload',itemID:row.id},signal:controller.signal});check();
     if(error||!link?.url)throw new Error('Photo unavailable');
     const response=await fetch(link.url,{signal:controller.signal});check();
     if(!response.ok)throw new Error('Photo unavailable');
     const bytes=await response.arrayBuffer();check();
     if(bytes.byteLength>5_000_000)throw new Error('Photo too large');
     const data=new Uint8Array(bytes);let binary='';
     for(let index=0;index<data.length;index+=8192)binary+=String.fromCharCode(...data.subarray(index,index+8192));
     photo=`data:image/jpeg;base64,${btoa(binary)}`;
     if(photo.length>COLLECTION_PHOTO_LIMIT)throw new Error('Photo too large');
     const digest=[...new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(photo.split(',')[1])))].map(value=>value.toString(16).padStart(2,'0')).join('');check();
     if(digest!==row.photo_sha256)throw new Error('Cloud photo changed; retry its current version');
    }catch {check();photo=null;pending=true;}finally{clearTimeout(timer);}
   }
  }
  cloud.push({...row,photo});
 }
 check();
 const saved=await savePreferences(previous=>{
  check();
  const previousReceipts=previous.syncReceipts||{},nextReceipts={};
  const allowed=cloud.filter(row=>!previousReceipts[`collection:${row.id}`]?.deleted);
  const merged=mergeRestoredCollection(previous.vehicles,allowed);
  const vehicles=merged.vehicles.map(item=>{
   const row=allowed.find(row=>row.id.toLowerCase()===item.id.toLowerCase());
   const key=row&&`collection:${row.id}`,photoKey=row&&`collection-photo:${row.id}`;
   const wasLocal=(previous.vehicles||[]).some(value=>value.id.toLowerCase()===item.id.toLowerCase());
   if(row&&!wasLocal&&row.sync_fingerprint&&!previousReceipts[key])nextReceipts[key]={owner,fingerprint:row.sync_fingerprint,revision:row.revision};
   if(row?.photo_object_key&&(!wasLocal||previousReceipts[photoKey]?.restorePending)){
    nextReceipts[photoKey]={owner,uploaded:true,sha256:row.photo_sha256,objectKey:row.photo_object_key,restorePending:!row.photo};
    // Preserve a local photo chosen while the download was in flight.
    if(!item.photo&&row.photo)return {...item,photo:row.photo};
   }
   return item;
  });
  const setting=settings.data;
  const patch=!previousReceipts.settings&&setting?mergeRestoredSettings(previous,setting.payload):{};
  if(previous.distanceUnit!==preferences.distanceUnit)delete patch.distanceUnit;
  if(!previousReceipts.settings&&setting?.sync_fingerprint)nextReceipts.settings={owner,fingerprint:setting.sync_fingerprint,revision:setting.revision};
  return receiptPatch(previous,nextReceipts,{...patch,vehicles});
 });
 check();
 return {preferences:saved,pending};
}
