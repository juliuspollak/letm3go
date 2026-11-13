import {expect,it} from 'vitest';
import {activityReceiptKey,normalizeActivityReceipts} from './activityReceiptKeys.js';
import {receiptPatch} from './syncReceipts.js';
const id='abcdef01-2345-4678-89ab-cdef01234567',upper=id.toUpperCase();
it('merges restored and native UUID aliases using the highest acknowledged revision',()=>{
 const normalized=normalizeActivityReceipts({[upper]:{owner:'me',revision:1},[id]:{owner:'me',revision:11}});
 expect(normalized).toEqual({[id]:{owner:'me',revision:11}});
 expect(activityReceiptKey('backup-failure:'+upper)).toBe('backup-failure:'+id);
});
it('does not let an older async checkpoint roll back a newer acknowledgement',()=>{
 const preferences={syncReceipts:{[id]:{owner:'me',revision:12,fingerprint:'new'}}};
 const saved=receiptPatch(preferences,{[upper]:{owner:'me',revision:2,fingerprint:'old'}});
 expect(saved.syncReceipts[id].revision).toBe(12);expect(saved.syncReceipts[upper]).toBeUndefined();
});
it('keeps deletion and cleared-failure acknowledgements when stale work completes',()=>{
 const preferences={syncReceipts:{[id]:{owner:'me',deleted:true,revision:12},['backup-failure:'+id]:{owner:'me',cleared:true,at:200}}};
 const saved=receiptPatch(preferences,{[upper]:{owner:'me',revision:11},['backup-failure:'+upper]:{owner:'me',message:'old',at:100}});
 expect(saved.syncReceipts[id].deleted).toBe(true);expect(saved.syncReceipts['backup-failure:'+id].cleared).toBe(true);
});
it('does not combine acknowledgements belonging to different accounts',()=>{
 expect(()=>normalizeActivityReceipts({[id]:{owner:'me',revision:1},[upper]:{owner:'other',revision:20}})).toThrow('another account');
});

it('does not replace the payload acknowledged at a revision with a conflicting same-revision receipt',()=>{
 const preferences={syncReceipts:{[id]:{owner:'me',revision:12,fingerprint:'confirmed'}}};
 expect(receiptPatch(preferences,{[upper]:{owner:'me',revision:12,fingerprint:'different'}}).syncReceipts[id].fingerprint).toBe('confirmed');
});

it('treats arbitrary bookkeeping keys as data rather than object prototypes',()=>{
 const receipts=JSON.parse('{"__proto__":{"owner":"me","revision":1}}');
 const result=normalizeActivityReceipts(receipts);
 expect(Object.getPrototypeOf(result)).toBeNull();
 expect(Object.hasOwn(result,'__proto__')).toBe(true);
 expect({}.owner).toBeUndefined();
});

it('accepts a later verified equivalent-content acknowledgement at the same cloud revision',()=>{
 const preferences={syncReceipts:{[id]:{owner:'me',revision:11,fingerprint:'old-serialization',confirmedAt:1}}};
 const acknowledged={owner:'me',revision:11,fingerprint:'new-serialization',baseFingerprint:'old-serialization',confirmedAt:2};
 expect(receiptPatch(preferences,{[upper]:acknowledged}).syncReceipts[id]).toEqual(acknowledged);
});
