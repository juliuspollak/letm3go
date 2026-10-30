import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { syncPrivateActivities } from './cloudSync.js';
const trip={id:'trip',title:'Walk',activity:'Walking',source:'device',startedAt:100,endedAt:200,durationSeconds:100,distanceMeters:50,points:[]};
const state={ownerID:'owner',trips:[trip],places:[]};
function client(){const chain={};for(const name of ['delete','eq','upsert'])chain[name]=vi.fn(()=>chain);chain.then=resolve=>resolve({error:null});return {chain,auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:'owner'}}})},from:vi.fn(()=>chain),rpc:vi.fn().mockResolvedValue({data:1,error:null})};}
const run=(api,s=state,receipts={},opts={})=>syncPrivateActivities(api,s,receipts,{cryptoImpl:webcrypto,...opts});
it('retries deletion without uploading deleted or simulator records',async()=>{const api=client();const result=await run(api,{...state,trips:[trip,{...trip,id:'sim',source:'simulator'}],deletedIDs:['trip']});expect(api.chain.delete).toHaveBeenCalled();expect(api.rpc).not.toHaveBeenCalled();expect(result.receipts.trip.deleted).toBe(true);});
it('rejects an account switch before uploading any GPS',async()=>{const api=client();await expect(run(api,{...state,ownerID:'different'})).rejects.toThrow('account');expect(api.from).not.toHaveBeenCalled();expect(api.rpc).not.toHaveBeenCalled();});
it('passes the expected owner to atomic backup and only checkpoints acknowledged operations',async()=>{const api=client(),checkpoint=vi.fn();const first=await run(api,state,{}, {checkpoint});expect(api.rpc).toHaveBeenCalledWith('backup_private_activity',expect.objectContaining({p_owner:'owner',p_expected_revision:null,p_fingerprint:expect.stringMatching(/^[a-f0-9]{64}$/)}));expect(checkpoint).toHaveBeenCalledOnce();api.rpc.mockClear();await run(api,state,first.receipts);expect(api.rpc).not.toHaveBeenCalled();});
it('preserves local retry state on failure without issuing unsafe upserts',async()=>{const api=client(),checkpoint=vi.fn();api.rpc.mockResolvedValue({error:{code:'PGRST202'}});await expect(run(api,state,{}, {checkpoint})).rejects.toThrow('local data is preserved');expect(checkpoint).not.toHaveBeenCalled();expect(api.from).not.toHaveBeenCalled();});
it('writes places with an explicit owner and ignores unfinished recordings',async()=>{const api=client();await run(api,{...state,trips:[{...trip,endedAt:null}],places:[{id:'home',name:'Home',kind:'home',latitude:1,longitude:2,radius:150}]});expect(api.chain.upsert).toHaveBeenCalledWith(expect.objectContaining({owner_id:'owner'}));expect(api.rpc).not.toHaveBeenCalled();});
it('backs up a published stop only after the recorder finalises it',async()=>{
 const api=client();
 const stopped={...trip,details:{provisional:true,continuationEndsAt:1300}};
 const first=await run(api,{...state,trips:[stopped]});
 expect(api.rpc).not.toHaveBeenCalled();expect(first.uploaded).toBe(0);expect(first.receipts.trip).toBeUndefined();
 const finalised=await run(api,{...state,trips:[{...trip}]});
 expect(finalised.uploaded).toBe(1);
});
it('backs up Apple Watch recordings once, as manual until the schema allows watch, and never simulator ones',async()=>{
 const api=client();
 const watch={...trip,id:'w1',source:'watch',recordingMode:'watch',details:{namedSegments:[{id:'a1b2c3d4-0000-4000-8000-000000000001',name:'Climb',startIndex:1,endIndex:5,geometry:[[[1,2]]]}]}};
 const first=await run(api,{...state,trips:[watch,{...trip,id:'sim',source:'simulator'}]});
 expect(api.rpc).toHaveBeenCalledTimes(1);
 const payload=api.rpc.mock.calls[0][1].p_payload;
 expect(payload).toMatchObject({id:'w1',recording_mode:'manual'});
 // Segments stay on the iPhone until NAMED_SEGMENT_BACKUP is enabled.
 expect(payload.view_metadata.namedSegments).toBeUndefined();
 // A second backup with the same content sends nothing: no duplicate revision.
 await run(api,{...state,trips:[watch]},first.receipts);
 expect(api.rpc).toHaveBeenCalledTimes(1);
});
