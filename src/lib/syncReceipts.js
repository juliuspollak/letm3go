// Receipt checkpoints may finish while the independent publication stage runs.
// Resolve against the latest preferences inside AuthContext's existing queue.
export function receiptPatch(preferences,receipts,extra={},publicationOnly=false){
 const previous=preferences.syncReceipts||{},next={...previous};
 for(const [key,value] of Object.entries(receipts)){
  if(publicationOnly&&!key.startsWith('mtb-segment:'))continue;
  if(key.startsWith('mtb-segment:')&&(previous[key]?.publicationAt||0)>(value?.publicationAt||0))continue;
  if(key.startsWith('mtb-segment:')&&previous[key]?.confirmedAt&&!value?.confirmedAt&&previous[key]?.publicationAt===value?.publicationAt&&previous[key]?.fingerprint===value?.fingerprint)continue;
  next[key]=value;
 }
 return {...extra,syncReceipts:next};
}
export const saveSyncReceipts=(savePreferences,receipts,extra={},publicationOnly=false)=>
 savePreferences(previous=>receiptPatch(previous,receipts,extra,publicationOnly));
