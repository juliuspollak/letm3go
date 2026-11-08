// A transactional, per-record store separate from account preferences. Native
// values are encrypted in the account directory; web values use IndexedDB.
import {Capacitor,registerPlugin} from '@capacitor/core';
const native=registerPlugin('SecureSession');
export function journeyDurableStorage(owner){
 if(Capacitor.isNativePlatform())return {
  async read(){const result=await native.readJourneyRecords({ownerID:owner});return result.records;},
  async commit(operations){await native.commitJourneyRecords({ownerID:owner,operations});}
 };
 let opening;
 const open=()=>opening??=new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB){reject(new Error('Durable journey storage is unavailable. Nothing was saved.'));return;}
  const request=indexedDB.open('letm3go-journey-records',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('records',{keyPath:['owner','key']});
  request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Close the other app tab to open journey storage.'));
  request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
 }).catch(error=>{opening=null;throw error;});
 return {
  async read(){const db=await open();return new Promise((resolve,reject)=>{
   const tx=db.transaction('records','readonly'),rows={};
   const request=tx.objectStore('records').openCursor(IDBKeyRange.bound([owner,''],[owner,'\uffff']));
   request.onsuccess=()=>{const cursor=request.result;if(cursor){rows[cursor.value.key]=cursor.value.value;cursor.continue();}};
   tx.oncomplete=()=>resolve(rows);tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);
  });},
  async commit(operations){const db=await open();return new Promise((resolve,reject)=>{
   const tx=db.transaction('records','readwrite',{durability:'strict'}),store=tx.objectStore('records');
   try{for(const {key,value,remove} of operations)if(remove)store.delete([owner,key]);else store.put({owner,key,value});}
   catch(error){tx.abort();reject(error);}
   tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('Journey storage transaction failed.'));tx.onerror=()=>reject(tx.error);
  });}
 };
}

export async function removeJourneyRecords(owner){
 const storage=journeyDurableStorage(owner),rows=await storage.read();
 await storage.commit(Object.keys(rows).map(key=>({key,remove:true})));
}
