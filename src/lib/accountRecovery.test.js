import {webcrypto,createHash} from 'node:crypto';
import {it,expect,vi,afterEach} from 'vitest';
import {recoverAccountPreferences} from './accountRecovery.js';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const row={id,category:'bicycle',name:'Cloud bike',make:'Trek',model:'X',attributes:{},source:'manual',archived:false,revision:5,sync_fingerprint:'a'.repeat(64)};
function setup({rows=[row],settings={payload:{distanceUnit:'mi',bookmarks:['cloud']},revision:3,sync_fingerprint:'b'.repeat(64)},preferences={distanceUnit:'km',vehicles:[],syncReceipts:{}},error=null}={}){
 let current=preferences;
 const client={from:vi.fn(table=>{const result={data:table==='collection_items'?rows:settings,error};const chain={select:()=>chain,eq:()=>chain,is:()=>chain,order:()=>chain,limit:()=>chain,maybeSingle:()=>chain,abortSignal:()=>Promise.resolve(result)};return chain;}),functions:{invoke:vi.fn(async()=>({data:{url:'https://example.test/private-photo'}}))}};
 const savePreferences=vi.fn(async patch=>{current={...current,...(typeof patch==='function'?patch(current):patch)};return current;});
 return {client,savePreferences,read:()=>current,run:extra=>recoverAccountPreferences(client,{owner,preferences,savePreferences,cryptoImpl:webcrypto,...extra})};
}
afterEach(()=>vi.unstubAllGlobals());
it('recovers cloud-only collection and settings before their first upload, retaining server baselines',async()=>{
 const s=setup();await s.run();
 expect(s.read().vehicles[0]).toMatchObject({id,name:'Cloud bike'});expect(s.read().distanceUnit).toBe('mi');expect(s.read().bookmarks).toEqual(['cloud']);
 expect(s.read().syncReceipts[`collection:${id}`]).toMatchObject({owner,revision:5});expect(s.read().syncReceipts.settings.revision).toBe(3);
});
it('preserves existing local items, unsent removals, notification permissions and newer settings',async()=>{
 const preferences={vehicles:[{id,name:'Local edit'}],distanceUnit:'km',notificationsEnabled:false,bookmarks:['local'],syncReceipts:{settings:{owner,revision:1}}};
 const s=setup({preferences});await s.run();expect(s.read().vehicles[0].name).toBe('Local edit');expect(s.read().distanceUnit).toBe('km');expect(s.read().bookmarks).toEqual(['local']);expect(s.read().notificationsEnabled).toBe(false);
 const removed=setup({preferences:{vehicles:[],syncReceipts:{[`collection:${id}`]:{owner,deleted:true}}}});await removed.run();expect(removed.read().vehicles).toEqual([]);
});
it('does not duplicate an existing native uppercase UUID or fabricate an acknowledgement for a conflicting edit',async()=>{
 const s=setup({preferences:{vehicles:[{id:id.toUpperCase(),name:'Local'}],syncReceipts:{}}});await s.run();expect(s.read().vehicles).toHaveLength(1);expect(s.read().syncReceipts[`collection:${id}`]).toBeUndefined();
});
it('withholds writes when reads fail or the owner changes before commit',async()=>{
 const failed=setup({error:{message:'offline'}});await expect(failed.run()).rejects.toThrow('retry');expect(failed.savePreferences).not.toHaveBeenCalled();
 const changed=setup();await expect(changed.run({isCurrent:()=>false})).rejects.toThrow('Account changed');expect(changed.savePreferences).not.toHaveBeenCalled();
});
it('keeps a failed photo download pending without erasing its private cloud object reference',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('offline');}));
 const s=setup({rows:[{...row,photo_object_key:`${owner}/collection/${id}.jpg`,photo_sha256:'c'.repeat(64)}]});
 expect((await s.run()).pending).toBe(true);
 expect(s.read().vehicles[0].photo).toBeUndefined();
 expect(s.read().syncReceipts[`collection-photo:${id}`]).toMatchObject({restorePending:true,objectKey:`${owner}/collection/${id}.jpg`});
});
it('downloads a missing photo automatically and stores it with its restored item',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer})));
 const s=setup({rows:[{...row,photo_object_key:`${owner}/collection/${id}.jpg`,photo_sha256:createHash('sha256').update('AQID').digest('hex')}]});expect((await s.run()).pending).toBe(false);
 expect(s.read().vehicles[0].photo).toBe('data:image/jpeg;base64,AQID');expect(s.read().syncReceipts[`collection-photo:${id}`].restorePending).toBe(false);
});
it('retries a held photo on the next automatic pass without duplicating the item',async()=>{
 const cloudRow={...row,photo_object_key:`${owner}/collection/${id}.jpg`,photo_sha256:createHash('sha256').update('AQID').digest('hex')};
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('offline');}));
 const first=setup({rows:[cloudRow]});expect((await first.run()).pending).toBe(true);
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer})));
 const retry=setup({rows:[cloudRow],preferences:first.read()});expect((await retry.run()).pending).toBe(false);expect(retry.read().vehicles).toHaveLength(1);expect(retry.read().vehicles[0].photo).toContain('AQID');
});
it('bounds photo downloads per pass and preserves the remaining cloud references',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer})));
 const rows=Array.from({length:6},(_,i)=>({...row,id:`22222222-2222-4222-8222-${String(i).padStart(12,'0')}`,photo_object_key:`${owner}/collection/${i}.jpg`,photo_sha256:createHash('sha256').update('AQID').digest('hex')}));
 const s=setup({rows});expect((await s.run()).pending).toBe(true);expect(fetch).toHaveBeenCalledTimes(4);expect(s.read().vehicles).toHaveLength(6);expect(s.read().syncReceipts[`collection-photo:${rows[5].id}`].restorePending).toBe(true);
});
it('rejects a photo whose bytes no longer match the read cloud version',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer})));
 const s=setup({rows:[{...row,photo_object_key:`${owner}/collection/${id}.jpg`,photo_sha256:'c'.repeat(64)}]});expect((await s.run()).pending).toBe(true);expect(s.read().vehicles[0].photo).toBeUndefined();
});
it('honours a removal or settings edit made while recovery was reading the cloud',async()=>{
 const s=setup();s.savePreferences.mockImplementationOnce(async patch=>{
  const latest={vehicles:[],distanceUnit:'mi',syncReceipts:{[`collection:${id}`]:{owner,deleted:true}}};
  const saved=patch(latest);expect(saved.vehicles).toEqual([]);expect(saved).not.toHaveProperty('distanceUnit');return {...latest,...saved};
 });await s.run();
});
