import 'fake-indexeddb/auto';
import {expect,it} from 'vitest';
import {journeyDurableStorage} from './journeyDurableStorage.js';
it('stores large records outside preferences, reopens them and isolates owners',async()=>{
 const a=journeyDurableStorage('idb-a'),b=journeyDurableStorage('idb-b');
 const operations=Array.from({length:100},(_,i)=>({key:`road-${i}`,value:{line:'x'.repeat(20000)}}));
 await a.commit(operations);await b.commit([{key:'road-0',value:{line:'other account'}}]);
 expect(Object.keys(await journeyDurableStorage('idb-a').read())).toHaveLength(100);
 expect((await a.read())['road-0'].line).toHaveLength(20000);
 expect((await b.read())['road-0'].line).toBe('other account');
});
it('aborts the entire transaction if a later record cannot be written',async()=>{
 const storage=journeyDurableStorage('idb-failure');await storage.commit([{key:'existing',value:'safe'}]);
 await expect(storage.commit([{key:'existing',value:'must roll back'},{key:'bad',value:()=>{}}])).rejects.toThrow();
 expect(await storage.read()).toEqual({existing:'safe'});
 await storage.commit([{key:'existing',value:'recovered'}]);expect(await storage.read()).toEqual({existing:'recovered'});
});

it('preserves existing records on quota exhaustion and recovers after capacity returns',async()=>{
 const storage=journeyDurableStorage('idb-quota');await storage.commit([{key:'old',value:'saved'}]);
 const original=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(){throw new DOMException('Storage full','QuotaExceededError');};
 try{await expect(storage.commit([{key:'old',value:'new'}])).rejects.toThrow('Storage full');}
 finally{IDBObjectStore.prototype.put=original;}
 expect(await journeyDurableStorage('idb-quota').read()).toEqual({old:'saved'});
 await storage.commit([{key:'old',value:'recovered'}]);expect(await storage.read()).toEqual({old:'recovered'});
});
