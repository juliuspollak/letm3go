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
it('backs up Watch provenance and private section references once, never simulator recordings',async()=>{
 const api=client();
 const watch={...trip,id:'w1',source:'watch',recordingMode:'watch',details:{namedSegments:[{id:'a1b2c3d4-0000-4000-8000-000000000001',name:'Climb',startIndex:1,endIndex:5,geometry:[[[1,2]]]}]}};
 const first=await run(api,{...state,trips:[watch,{...trip,id:'sim',source:'simulator'}]});
 expect(api.rpc).toHaveBeenCalledTimes(1);
 const payload=api.rpc.mock.calls[0][1].p_payload;
 expect(payload).toMatchObject({id:'w1',recording_mode:'watch'});
 // The branch requires the existing named-segment/watch schema migration.
 expect(payload.view_metadata.namedSegments).toHaveLength(1);
 // A second backup with the same content sends nothing: no duplicate revision.
 await run(api,{...state,trips:[watch]},first.receipts);
 expect(api.rpc).toHaveBeenCalledTimes(1);
});

it('backs up confirmed measurements privately but never quarantined ownership or overlap notes',async()=>{
 const sent=[];
 const client={rpc:async(name,args)=>{sent.push(args);return {data:1,error:null};},from:()=>({upsert:async()=>({error:null})}),auth:{getUser:async()=>({data:{user:{id:'u'}}})}};
 const trip={id:'7c9e6679-7425-40de-944b-e07fc1f90ae7',title:'Run',activity:'Running',source:'watch',recordingMode:'watch',state:'finished',startedAt:1,endedAt:900,accumulatedSeconds:899,distanceMeters:0,points:[],details:{energy:{schema:1,unit:'kcal',source:'healthkit',state:'final',active:400,total:500},unverifiedEnergy:{active:900},wholeWorkoutEnergy:{active:700},unverifiedWholeWorkoutEnergy:{active:800},indoor:true,unverifiedHeartRate:{samples:[{timestamp:6,bpm:121}]},overlaps:[{activityID:'a',title:'x',kind:'manual',seconds:90}],heartRate:{samples:[{timestamp:5,bpm:120}],pausePeriods:[],summary:{average:120,maximum:120,minimum:120,samples:1,gaps:0}}}};
 await syncPrivateActivities(client,{ownerID:'u',trips:[trip],places:[],deletedIDs:[]},{}).catch(()=>{});
 expect(sent.length).toBeGreaterThan(0);
 expect(sent[0].p_payload.classification.privateActivity).toMatchObject({heartRate:{samples:[{timestamp:5,bpm:120}]},energy:{active:400},wholeWorkoutEnergy:{active:700},indoor:true});
 expect(JSON.stringify(sent)).not.toMatch(/unverified|overlaps|bpm.{0,4}121|active.{0,4}900|active.{0,4}800/i);
});
it('does not resend a deletion the cloud already confirmed',async()=>{
 const api=client();
 await run(api,{...state,trips:[],deletedIDs:['gone']},{gone:{owner:'owner',deleted:true}});
 expect(api.chain.delete).not.toHaveBeenCalled();
});
it('does not serialise or hash an activity unchanged since its last backup',async()=>{
 const api=client(),edited={...trip,updatedAt:300};
 const first=await run(api,{...state,trips:[edited]});
 expect(api.rpc).toHaveBeenCalledTimes(1);expect(first.receipts.trip).toMatchObject({updatedAt:300});
 const digest=vi.fn((...args)=>webcrypto.subtle.digest(...args));
 await run(api,{...state,trips:[edited]},first.receipts,{cryptoImpl:{subtle:{digest}}});
 expect(digest).not.toHaveBeenCalled();expect(api.rpc).toHaveBeenCalledTimes(1);
 await run(api,{...state,trips:[{...edited,updatedAt:400,title:'Renamed'}]},first.receipts);
 expect(api.rpc).toHaveBeenCalledTimes(2);
});
it('a receipt from an earlier build learns updatedAt once, without uploading',async()=>{
 const api=client(),edited={...trip,updatedAt:300};
 const legacy=await run(api,{...state,trips:[edited]});
 const {updatedAt:_u,...old}=legacy.receipts.trip;void _u;
 const again=await run(api,{...state,trips:[edited]},{trip:old});
 expect(api.rpc).toHaveBeenCalledTimes(1);expect(again.receipts.trip).toMatchObject({...old,updatedAt:300});
});

it('submits only selected MTB geometry, retries a lost acknowledgement, and restores private measurements separately',async()=>{
 const {rawActivityFromCloudRow}=await import('./cloudActivity.js');
 const api=client(),segmentID='a1b2c3d4-0000-4000-8000-000000000001';
 const points=Array.from({length:21},(_,i)=>({latitude:-34+i*0.0001,longitude:151,timestamp:100+i*5,accuracy:5,segment:0}));
 const ride={...trip,activity:'MTB',points,details:{namedSegments:[{id:segmentID,name:'Selected route',startIndex:5,endIndex:15}],heartRate:{samples:[{timestamp:130,bpm:140}]},energy:{active:100}}};
 let fail=true;
 api.rpc.mockImplementation(async(name,args)=>name==='backup_private_activity'?{data:1,error:null}:fail?{error:{message:'lost acknowledgement'}}:{data:args.p_client_id,error:null});
 let saved={};await expect(run(api,{...state,trips:[ride]}, {},{checkpoint:async receipts=>{saved=receipts;}})).rejects.toThrow('submission was not confirmed');
 expect(saved.trip.backupVersion).toBe(2);expect(saved['mtb-segment:'+segmentID]).toBeUndefined();
 const privateRow=api.rpc.mock.calls.find(([name])=>name==='backup_private_activity')[1].p_payload;
 const proposal=api.rpc.mock.calls.find(([name])=>name==='create_mtb_segment')[1];
 expect(proposal.p_geometry).toHaveLength(11);expect(proposal.p_geometry[0]).toEqual([points[5].latitude,151]);
 expect(Object.keys(proposal).sort()).toEqual(['p_access','p_client_id','p_direction','p_distance_meters','p_geometry','p_name']);
 expect(JSON.stringify(proposal)).not.toMatch(/timestamp|heartRate|energy|activity_id|bpm/);
 const restored=rawActivityFromCloudRow({...privateRow,owner_id:'owner'});
 expect(restored.details.heartRate).toEqual(ride.details.heartRate);expect(restored.details.energy).toEqual(ride.details.energy);expect(restored.details.namedSegments).toHaveLength(1);
 fail=false;const result=await run(api,{...state,trips:[ride]},saved);
 expect(result.receipts['mtb-segment:'+segmentID]).toEqual({owner:'owner',uploaded:true});
 const count=api.rpc.mock.calls.length;await run(api,{...state,trips:[ride]},result.receipts);expect(api.rpc.mock.calls).toHaveLength(count);
});
