import {receiptPatch} from './syncReceipts.js';

// Sync saves a receipt for every item it uploads so a killed app knows what already went up. Doing that with one preferences
// write per item meant a full encrypted rewrite of the settings file and a re-render of the whole app each time (a dozen
// per pass). The server treats a repeated upload of identical content as an acknowledgement only ("a lost acknowledgement
// needs no content write"), so a receipt that is lost in a crash costs one repeated request, never a duplicate or a loss.
//
// This collects receipts and writes them together: at most once per `delay`, and immediately on `flush()` (the end of a
// pass, a failure, the app going to the background). One write carries everything recorded since the last one.
export function createReceiptCheckpointer({savePreferences,delay=1500,onSaved=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){
 let pending=null,extra={},timer=null,chain=Promise.resolve();
 const persist=()=>{
  if(timer){clearTimer(timer);timer=null;}
  if(!pending)return chain;
  const batch={receipts:pending,extra};
  pending=null;extra={};
  const run=chain.catch(()=>{}).then(()=>savePreferences(previous=>receiptPatch(previous,batch.receipts,batch.extra)));
  chain=run.then(()=>{onSaved();},error=>{
   // Not lost: what was recorded joins whatever arrived meanwhile and goes out with the next write.
   pending=receiptPatch({syncReceipts:batch.receipts},pending||{}).syncReceipts;
   extra={...batch.extra,...extra};
   throw error;
  });
  chain.catch(()=>{});   // the caller of flush() sees the failure; the chain itself must not become an unhandled rejection
  return run.then(()=>undefined);
 };
 return {
  // `receipts` is the pass's whole map so far; it is merged with what is already waiting by the same rule the preferences use.
  record(receipts,more={}){
   pending=receiptPatch({syncReceipts:pending||{}},receipts).syncReceipts;
   extra={...extra,...more};
   if(!timer)timer=setTimer(()=>{timer=null;void persist().catch(()=>{});},delay);
  },
  flush:persist,
  hasPending:()=>pending!==null,
 };
}
