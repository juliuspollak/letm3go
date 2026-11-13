// PostgreSQL UUIDs are lowercase; the recorder may return uppercase UUIDs.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function activityReceiptKey(key){
 const value=String(key);
 if(uuid.test(value))return value.toLowerCase();
 if(value.startsWith('backup-failure:')&&uuid.test(value.slice(15)))return 'backup-failure:'+value.slice(15).toLowerCase();
 return value;
}
export function chooseActivityReceipt(previous,next,key){
 if(!next||typeof next!=='object')return previous;
 if(!previous)return next;
 if(previous.owner&&next.owner&&previous.owner.toLowerCase()!==next.owner.toLowerCase())throw new Error('Backup receipts belong to another account.');
 if(uuid.test(key)){
  if(previous.deleted&&!next.deleted)return previous;
  if((previous.revision??0)>(next.revision??0))return previous;
  if(previous.revision===next.revision&&previous.fingerprint&&next.fingerprint&&previous.fingerprint!==next.fingerprint&&(next.confirmedAt??0)<=(previous.confirmedAt??0))return previous;
 }
 if(key.startsWith('backup-failure:')){
  if((previous.at??0)>(next.at??0))return previous;
  if(previous.at===next.at&&previous.cleared&&!next.cleared)return previous;
 }
 return next;
}
export function normalizeActivityReceipts(receipts={}){
 const next=Object.create(null);
 for(const [key,value] of Object.entries(receipts)){
  const canonical=activityReceiptKey(key);
  next[canonical]=chooseActivityReceipt(next[canonical],value,canonical);
 }
 return next;
}
