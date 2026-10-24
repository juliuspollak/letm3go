import { expect, it, vi } from 'vitest';
import { syncPrivateActivities } from './cloudSync.js';
const trip={id:'trip',title:'Walk',activity:'Walking',source:'device',startedAt:100,endedAt:200,durationSeconds:100,distanceMeters:50,points:[]};
function client(){const result={error:null,data:{revision:1}};const chain={delete:vi.fn(),eq:vi.fn(),upsert:vi.fn(),select:vi.fn(),single:vi.fn(),maybeSingle:vi.fn()};for(const method of Object.keys(chain))chain[method].mockReturnValue(chain);chain.single.mockResolvedValue(result);chain.maybeSingle.mockResolvedValue(result);chain.then=(resolve)=>resolve(result);return {chain,auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:'owner'}}})},from:vi.fn().mockReturnValue(chain)};}
it('retries tombstone deletion without uploading deleted or simulator records',async()=>{
 const api=client();const result=await syncPrivateActivities(api,{trips:[trip,{...trip,id:'sim',source:'simulator'}],deletedIDs:['trip'],places:[]},{trip:{owner:'owner'}});
 expect(api.chain.delete).toHaveBeenCalled();expect(api.chain.upsert).not.toHaveBeenCalled();expect(result.receipts.trip.deleted).toBe(true);
});
it('does not upload a different account’s bound local activity',async()=>{
 const api=client();await syncPrivateActivities(api,{trips:[trip],places:[]},{trip:{owner:'other'}});
 expect(api.from).not.toHaveBeenCalled();
});
it('skips unchanged content to avoid invalidating existing publication',async()=>{
 const api=client();const first=await syncPrivateActivities(api,{trips:[trip],places:[]});api.chain.upsert.mockClear();
 await syncPrivateActivities(api,{trips:[trip],places:[]},first.receipts);expect(api.chain.upsert).not.toHaveBeenCalled();
});
it('keeps failed operations retryable by not acknowledging a failed upload',async()=>{
 const api=client();api.chain.single.mockResolvedValue({error:new Error('Offline')});
 await expect(syncPrivateActivities(api,{trips:[trip],places:[]})).rejects.toThrow('Offline');
});
