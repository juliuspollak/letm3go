import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { syncPrivateActivities } from './cloudSync.js';
const trip={id:'trip',title:'Walk',activity:'Walking',source:'device',startedAt:100,endedAt:200,durationSeconds:100,distanceMeters:50,points:[]};
const state={ownerID:'owner',trips:[trip],places:[]};
function client(){
 const chain={};for(const name of ['delete','eq','upsert','select','maybeSingle'])chain[name]=vi.fn(()=>chain);
 chain.then=resolve=>resolve({error:null});
 const api={chain,auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:'owner'}}})},rpc:vi.fn().mockResolvedValue({data:1,error:null})};
 api.from=vi.fn(table=>{
  if(table!=='mtb_segments')return chain;
  let id;return {select(){return this;},eq(_key,value){id=value;return this;},async maybeSingle(){
   const sent=api.rpc.mock.calls.filter(([name,args])=>name==='publish_segment'&&args.p_client_id.toLowerCase()===id.toLowerCase()).at(-1)?.[1];
   return {data:sent?{id,creator_id:'owner',name:sent.p_name,status:'approved',visibility:'public',access:'unknown',version:1}:null,error:null};
  }};
 });return api;
}
const run=(api,s=state,receipts={},opts={})=>syncPrivateActivities(api,s,receipts,{cryptoImpl:webcrypto,...opts});
it('retries deletion without uploading deleted or simulator records',async()=>{const api=client();const result=await run(api,{...state,trips:[trip,{...trip,id:'sim',source:'simulator'}],deletedIDs:['trip']});expect(api.chain.delete).toHaveBeenCalled();expect(api.rpc).not.toHaveBeenCalled();expect(result.receipts.trip.deleted).toBe(true);});
it('rejects an account switch before uploading any GPS',async()=>{const api=client();await expect(run(api,{...state,ownerID:'different'})).rejects.toThrow('account');expect(api.from).not.toHaveBeenCalled();expect(api.rpc).not.toHaveBeenCalled();});
it('passes the expected owner to atomic backup and only checkpoints acknowledged operations',async()=>{const api=client(),checkpoint=vi.fn();const first=await run(api,state,{}, {checkpoint});expect(api.rpc).toHaveBeenCalledWith('backup_private_activity',expect.objectContaining({p_owner:'owner',p_expected_revision:null,p_fingerprint:expect.stringMatching(/^[a-f0-9]{64}$/)}));expect(checkpoint).toHaveBeenCalledOnce();api.rpc.mockClear();await run(api,state,first.receipts);expect(api.rpc).not.toHaveBeenCalled();});
it('preserves local retry state on failure without issuing unsafe upserts',async()=>{const api=client(),checkpoint=vi.fn();api.rpc.mockResolvedValue({error:{code:'PGRST202'}});await expect(run(api,state,{}, {checkpoint})).rejects.toThrow('local data is preserved');// Only the failure itself is kept (so it is retried later with its reason); no upload receipt is invented.
expect(Object.keys(checkpoint.mock.calls.at(-1)[0])).toEqual(['backup-failure:trip']);expect(api.from).not.toHaveBeenCalled();});
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

it('publishes only selected segment geometry, retries a lost acknowledgement, and restores private measurements separately',async()=>{
 const {rawActivityFromCloudRow}=await import('./cloudActivity.js');
 const api=client(),segmentID='a1b2c3d4-0000-4000-8000-000000000001';
 const points=Array.from({length:21},(_,i)=>({latitude:-34+i*0.0001,longitude:151,timestamp:100+i*5,accuracy:5,segment:0}));
 const ride={...trip,activity:'MTB',points,details:{namedSegments:[{id:segmentID,name:'Selected route',startIndex:5,endIndex:15}],heartRate:{samples:[{timestamp:130,bpm:140}]},energy:{active:100}}};
 let fail=true;
 api.rpc.mockImplementation(async(name,args)=>name==='backup_private_activity'?{data:1,error:null}:name==='segments_for_map'?{data:[],error:null}:fail?{error:{message:'lost acknowledgement'}}:{data:args.p_client_id,error:null});
 let saved={};await expect(run(api,{...state,trips:[ride]}, {},{checkpoint:async receipts=>{saved=receipts;}})).rejects.toThrow('publishing was not confirmed');
 // The failure is kept so the Segments view can say it will retry; it is not a refusal.
 expect(saved.trip.backupVersion).toBe(2);expect(saved['mtb-segment:'+segmentID]).toMatchObject({owner:'owner',failed:expect.stringMatching(/lost acknowledgement/)});
 expect(saved['mtb-segment:'+segmentID].uploaded).toBeUndefined();
 const privateRow=api.rpc.mock.calls.find(([name])=>name==='backup_private_activity')[1].p_payload;
 const proposal=api.rpc.mock.calls.find(([name])=>name==='publish_segment')[1];
 expect(proposal.p_geometry).toHaveLength(11);expect(proposal.p_geometry[0]).toEqual([points[5].latitude,151]);
 expect(Object.keys(proposal).sort()).toEqual(['p_activity','p_client_id','p_geometry','p_name','p_rename','p_reroute']);expect(proposal).toMatchObject({p_activity:'MTB',p_rename:false,p_reroute:false});
 expect(JSON.stringify(proposal)).not.toMatch(/timestamp|heartRate|energy|activity_id|bpm/);
 const restored=rawActivityFromCloudRow({...privateRow,owner_id:'owner'});
 expect(restored.details.heartRate).toEqual(ride.details.heartRate);expect(restored.details.energy).toEqual(ride.details.energy);expect(restored.details.namedSegments).toHaveLength(1);
 fail=false;const result=await run(api,{...state,trips:[ride]},saved);
 expect(result.receipts['mtb-segment:'+segmentID]).toMatchObject({owner:'owner',fingerprint:'Selected route|5|15',uploaded:true,sent:{name:'Selected route',start:5,end:15}});
 const count=api.rpc.mock.calls.length;await run(api,{...state,trips:[ride]},result.receipts);expect(api.rpc.mock.calls).toHaveLength(count);
});

it('submits segments from every activity that can have them',async()=>{
 const points=Array.from({length:21},(_,i)=>({latitude:-34+i*0.0001,longitude:151,timestamp:100+i*5,accuracy:5,segment:0}));
 const submitted=async activity=>{
  const api=client();api.rpc.mockImplementation(async(name,args)=>name==='backup_private_activity'?{data:1,error:null}:name==='segments_for_map'?{data:[],error:null}:{data:args.p_client_id,error:null});
  await run(api,{...state,trips:[{...trip,activity,points,details:{namedSegments:[{id:'a1b2c3d4-0000-4000-8000-000000000002',name:'Climb',startIndex:5,endIndex:15}]}}]});
  return api.rpc.mock.calls.some(([name])=>name==='publish_segment');
 };
 for(const activity of ['MTB','Cycling','Road cycling','Walking','Running','Hiking'])expect(await submitted(activity)).toBe(true);
 expect(await submitted('Driving')).toBe(false);
});

// Community segments: device edits, refusals and efforts (20261126000000).
describe('community segments',()=>{
 const points=Array.from({length:41},(_,i)=>({latitude:-34+i*0.0001,longitude:151,timestamp:1000+i*5,accuracy:5,segment:0}));
 const segID='a1b2c3d4-0000-4000-8000-000000000010';
 const ride=(extra={})=>({...trip,activity:'MTB',points,updatedAt:1,details:{namedSegments:[{id:segID,name:'Climb',startIndex:5,endIndex:30}]},...extra});
 // A public segment on the server: the same road as the ride, from fix 10 to 30.
 const publicSegment={id:'b0000000-0000-4000-8000-000000000001',name:'Road climb',geometry:points.slice(10,31).map(p=>[p.latitude,p.longitude]),distance_meters:222,version:1};
 function server({segments=[publicSegment],publish=(args)=>({data:args.p_client_id,error:null}),effort=()=>({data:'e',error:null}),catalogue=()=>[],details={}}={}){
  const api=client();
  api.rpc.mockImplementation(async(name,args)=>name==='backup_private_activity'?{data:1,error:null}:name==='segments_for_map'?{data:segments,error:null}
   :name==='publish_segment'?publish(args):name==='record_segment_effort'?effort(args):name==='segment_catalogue_since'?{data:catalogue(args),error:null}
   :name==='segment_detail'?{data:details[args.p_id]??null,error:null}:{data:null,error:{message:'unexpected '+name}});
  return api;
 }
 const calls=(api,name)=>api.rpc.mock.calls.filter(([n])=>n===name).map(([,args])=>args);
 it('sends a segment renamed or re-sectioned on this device again, and nothing when unchanged',async()=>{
  const api=server({segments:[]});
  const first=await run(api,{...state,trips:[ride()]});
  const again=await run(api,{...state,trips:[ride()]},first.receipts);
  expect(calls(api,'publish_segment')).toHaveLength(1);
  await run(api,{...state,trips:[ride({updatedAt:2,details:{namedSegments:[{id:segID,name:'Climb (upper)',startIndex:5,endIndex:30}]}})]},again.receipts);
  expect(calls(api,'publish_segment').map(a=>a.p_name)).toEqual(['Climb','Climb (upper)']);
 });
 it('a resend applies only what this device changed, so a rename or correction made on the server is kept',async()=>{
  const api=server({segments:[]});
  const first=await run(api,{...state,trips:[ride()]});
  // Re-sectioned on the device, name unchanged: route only.
  await run(api,{...state,trips:[ride({updatedAt:2,details:{namedSegments:[{id:segID,name:'Climb',startIndex:6,endIndex:30}]}})]},first.receipts);
  expect(calls(api,'publish_segment').at(-1)).toMatchObject({p_rename:false,p_reroute:true});
  // A receipt from an earlier build (no record of what was sent) changes neither.
  const legacy=server({segments:[]});
  await run(legacy,{...state,trips:[ride()]},{['mtb-segment:'+segID]:{owner:'owner',uploaded:true}});
  expect(calls(legacy,'publish_segment')[0]).toMatchObject({p_rename:false,p_reroute:false});
 });
 it('keeps the server’s reason for a refusal, does not retry it, but retries a receipt from before fingerprints',async()=>{
  const api=server({segments:[],publish:()=>({error:{message:'Invalid segment proposal: GPS gap'}})});
  const result=await run(api,{...state,trips:[ride()]});
  expect(result.receipts['mtb-segment:'+segID]).toMatchObject({skipped:'refused',reason:expect.stringMatching(/GPS gap/)});
  await run(api,{...state,trips:[ride()]},result.receipts);
  expect(calls(api,'publish_segment')).toHaveLength(1);
  // Builds before this one stored {skipped:'refused'} when moderation blocked an edit: send once more.
  const legacy=server({segments:[]});
  await run(legacy,{...state,trips:[ride()]},{...result.receipts,['mtb-segment:'+segID]:{owner:'owner',skipped:'refused'}});
  expect(calls(legacy,'publish_segment')).toHaveLength(1);
 });
 it('records a matched effort with time only, once, under a one-way key',async()=>{
  const api=server();
  const first=await run(api,{...state,trips:[ride({details:{}})]});
  const efforts=calls(api,'record_segment_effort');
  expect(efforts).toHaveLength(1);
  expect(efforts[0]).toMatchObject({p_segment_id:publicSegment.id,p_elapsed_seconds:expect.any(Number),p_matcher_version:expect.any(Number)});
  expect(efforts[0].p_elapsed_seconds).toBeGreaterThan(80);expect(efforts[0].p_elapsed_seconds).toBeLessThan(120);
  expect(efforts[0].p_client_key).toMatch(/^[0-9a-f]{40}$/);
  expect(JSON.stringify(efforts[0])).not.toMatch(/trip|latitude|longitude|-34\./);
  // The area asked for is the ride's own, not the world.
  expect(calls(api,'segments_for_map')[0].p_min_lat).toBeGreaterThan(-34.01);
  await run(api,{...state,trips:[ride({details:{}})]},first.receipts);
  expect(calls(api,'record_segment_effort')).toHaveLength(1);
 });
 it('retries efforts after a network failure, but skips an implausible time or a deleted segment',async()=>{
  let fail='network down';
  const api=server({effort:()=>fail?{error:{message:fail}}:{data:'e',error:null}});
  await expect(run(api,{...state,trips:[ride({details:{}})]})).rejects.toThrow(/efforts were not all recorded/);
  fail=null;const ok=await run(api,{...state,trips:[ride({details:{}})]});
  expect(ok.receipts['segment-efforts:trip']).toBeDefined();
  const refused=server({effort:()=>({error:{message:'Invalid effort'}})});
  const result=await run(refused,{...state,trips:[ride({details:{}})]});
  expect(result.receipts['segment-efforts:trip']).toBeDefined();
 });
 it('matches only a few rides per sync, newest first',async()=>{
  const {EFFORT_TRIPS_PER_SYNC}=await import('./cloudSync.js');
  const api=server({segments:[]});
  const many=Array.from({length:EFFORT_TRIPS_PER_SYNC+3},(_,i)=>ride({id:`ride-${i}`,startedAt:100+i,details:{}}));
  const result=await run(api,{...state,trips:many});
  expect(calls(api,'segments_for_map')).toHaveLength(EFFORT_TRIPS_PER_SYNC);
  expect(result.receipts['segment-efforts:ride-0']).toBeUndefined();
  // The pass is unfinished, so the next sync continues with the older rides.
  expect(result.pending).toBe(true);
  const next=await run(api,{...state,trips:many},result.receipts);
  expect(next.receipts['segment-efforts:ride-0']).toBeDefined();expect(next.pending).toBe(false);
  expect(result.receipts[`segment-efforts:ride-${EFFORT_TRIPS_PER_SYNC+2}`]).toBeDefined();
 });
});

it('asks for segments only in the cells a ride passes through',async()=>{
 const {routeTiles}=await import('./cloudSync.js');
 // A long straight ride east: one row of cells, not the whole bounding box.
 const ride=Array.from({length:200},(_,i)=>({latitude:-34.05,longitude:150+i*0.01}));
 const cells=routeTiles(ride);
 expect(cells.length).toBe(20);
 for(const cell of cells){expect(cell.maxLat-cell.minLat).toBeLessThan(0.11);expect(cell.minLat).toBeLessThan(-34.05);expect(cell.maxLat).toBeGreaterThan(-34.05);}
 expect(routeTiles([])).toEqual([]);
});
it('never matches the part of a recording that was trimmed away, and keys efforts by route version',async()=>{
 const points=Array.from({length:41},(_,i)=>({latitude:-34+i*0.0001,longitude:151,timestamp:1000+i*5,accuracy:5,segment:0}));
 const geometry=points.slice(10,31).map(p=>[p.latitude,p.longitude]);
 const make=(version)=>{const api=client();api.rpc.mockImplementation(async name=>name==='backup_private_activity'?{data:1,error:null}:name==='segments_for_map'?{data:[{id:'b0000000-0000-4000-8000-000000000001',name:'S',geometry,distance_meters:222,version}],error:null}:{data:'e',error:null});return api;};
 const efforts=api=>api.rpc.mock.calls.filter(([n])=>n==='record_segment_effort').map(([,a])=>a);
 const ride={...trip,activity:'MTB',points,updatedAt:1,details:{}};
 const trimmed=make(1);await run(trimmed,{...state,trips:[{...ride,visibleRouteStart:0,visibleRouteEnd:15}]});
 expect(efforts(trimmed)).toHaveLength(0);
 const v1=make(1),v2=make(2);
 await run(v1,{...state,trips:[ride]});await run(v2,{...state,trips:[ride]});
 expect(efforts(v1)).toHaveLength(1);expect(efforts(v2)).toHaveLength(1);
 expect(efforts(v1)[0].p_client_key).not.toBe(efforts(v2)[0].p_client_key);
});
it('a refused re-section keeps what was last published, so the fix is sent as a change',async()=>{
 const points=Array.from({length:41},(_,i)=>({latitude:-34+i*0.0001,longitude:151,timestamp:1000+i*5,accuracy:5,segment:0}));
 const id='a1b2c3d4-0000-4000-8000-000000000011';
 const ride=(name,s,e2)=>({...trip,activity:'MTB',points,updatedAt:name+s,details:{namedSegments:[{id,name,startIndex:s,endIndex:e2}]}});
 let refuse=false;const api=client();
 api.rpc.mockImplementation(async(name,args)=>name==='backup_private_activity'?{data:1,error:null}:name==='segments_for_map'?{data:[],error:null}:refuse?{error:{message:'Invalid segment proposal: GPS gap'}}:{data:args.p_client_id,error:null});
 const first=await run(api,{...state,trips:[ride('A',5,30)]});
 refuse=true;const refused=await run(api,{...state,trips:[ride('A',2,38)]},first.receipts);
 expect(refused.receipts['mtb-segment:'+id]).toMatchObject({skipped:'refused',sent:{name:'A',start:5,end:30}});
 refuse=false;await run(api,{...state,trips:[ride('B',6,30)]},refused.receipts);
 expect(api.rpc.mock.calls.filter(([n])=>n==='publish_segment').at(-1)[1]).toMatchObject({p_name:'B',p_rename:true,p_reroute:true});
});

describe('older rides meet newer segments',()=>{
 const points=Array.from({length:41},(_,i)=>({latitude:-34+i*0.0001,longitude:151,timestamp:1000+i*5,accuracy:5,segment:0}));
 const ride=(id,extra={})=>({...trip,id,activity:'MTB',points,updatedAt:1,startedAt:100,details:{},...extra});
 const geometry=points.slice(10,31).map(p=>[p.latitude,p.longitude]);
 const newSegment={id:'c0000000-0000-4000-8000-000000000001',version:1,changed_at:'2026-11-12T00:00:00Z',min_lat:-33.999,max_lat:-33.997,min_lon:150.9999,max_lon:151.0001};
 function backend({catalogue=[newSegment],detail={id:newSegment.id,name:'New',version:1,deleted:false,geometry},participation='anonymous',segmentsAround=[]}={}){
  const api=client();
  api.chain.then=resolve=>resolve({data:{segment_participation:participation},error:null});
  api.rpc.mockImplementation(async(name,args)=>name==='backup_private_activity'?{data:1,error:null}
   :name==='segments_for_map'?{data:segmentsAround,error:null}
   :name==='segment_catalogue_since'?{data:args.p_since?catalogue.filter(r=>r.changed_at>args.p_since):catalogue,error:null}
   :name==='segment_detail'?{data:args.p_id===detail?.id?detail:null,error:null}
   :name==='record_segment_effort'?{data:'e',error:null}:{data:null,error:{message:'unexpected '+name}});
  return api;
 }
 const calls=(api,name)=>api.rpc.mock.calls.filter(([n])=>n===name).map(([,a])=>a);
 it('a ride recorded before a segment existed is matched once it is published, without editing the ride',async()=>{
  // First sync: the segment does not exist yet.
  const before=backend({catalogue:[]});
  const first=await run(before,{...state,trips:[ride('old')]});
  expect(calls(before,'record_segment_effort')).toHaveLength(0);
  expect(first.receipts['segment-efforts:old'].area).toMatchObject({minLat:expect.any(Number)});
  // Later: someone publishes a segment along it. Same ride, unchanged.
  vi.useFakeTimers({now:Date.now()+11*60*1000,toFake:['Date']});
  try{
   const after=backend();
   const second=await run(after,{...state,trips:[ride('old')]},first.receipts);
   expect(calls(after,'record_segment_effort')).toHaveLength(1);
   expect(calls(after,'record_segment_effort')[0].p_segment_id).toBe(newSegment.id);
   expect(second.receipts['segment-catalogue']).toMatchObject({since:newSegment.changed_at,after:newSegment.id,queue:[]});
   expect(second.pending).toBe(false);
   // The cursor has moved past it: nothing is matched twice.
   vi.setSystemTime(Date.now()+11*60*1000);
   const third=backend();
   await run(third,{...state,trips:[ride('old')]},second.receipts);
   expect(calls(third,'record_segment_effort')).toHaveLength(0);
  }finally{vi.useRealTimers();}
 });
 it('works in bounded batches that resume across syncs, and checks only rides in the segment’s area',async()=>{
  const {BACKFILL_MATCHES_PER_SYNC}=await import('./cloudSync.js');
  const near=Array.from({length:BACKFILL_MATCHES_PER_SYNC+5},(_,i)=>ride(`near-${i}`));
  const far=ride('far',{points:points.map(p=>({...p,latitude:p.latitude+1}))});
  const receipts=Object.fromEntries([...near,far].map(t=>[`segment-efforts:${t.id}`,{owner:'owner',fingerprint:`1|1`}]));
  const {SEGMENT_MATCHER_VERSION}=await import('./segmentMatcher.js');
  for(const key of Object.keys(receipts))receipts[key].fingerprint=`${SEGMENT_MATCHER_VERSION}|1`;
  const api=backend();
  const first=await run(api,{...state,trips:[...near,far]},receipts);
  expect(calls(api,'record_segment_effort')).toHaveLength(BACKFILL_MATCHES_PER_SYNC);
  expect(first.pending).toBe(true);
  const queued=first.receipts['segment-catalogue'].queue[0].trips;
  expect(queued).toHaveLength(5);expect(queued).not.toContain('far');
  // Areas were worked out once for receipts that predate them, and kept.
  expect(first.receipts['segment-efforts:far'].area).toBeDefined();
  const api2=backend();
  const second=await run(api2,{...state,trips:[...near,far]},first.receipts);
  expect(calls(api2,'record_segment_effort')).toHaveLength(5);
  expect(second.pending).toBe(false);
  const keys=[...calls(api,'record_segment_effort'),...calls(api2,'record_segment_effort')].map(a=>a.p_client_key);
  expect(new Set(keys).size).toBe(keys.length);
 });
 it('drops a queued segment that was deleted or changed again, and does nothing with participation off',async()=>{
  const receipts={'segment-efforts:old':{owner:'owner',fingerprint:'x',area:{minLat:-34.01,maxLat:-33.99,minLon:150.99,maxLon:151.01}}};
  const {SEGMENT_MATCHER_VERSION}=await import('./segmentMatcher.js');receipts['segment-efforts:old'].fingerprint=`${SEGMENT_MATCHER_VERSION}|1`;
  const gone=backend({detail:{id:newSegment.id,deleted:true}});
  const result=await run(gone,{...state,trips:[ride('old')]},receipts);
  expect(calls(gone,'record_segment_effort')).toHaveLength(0);
  expect(result.receipts['segment-catalogue'].queue).toEqual([]);
  const off=backend({participation:'off',segmentsAround:[{id:'s',geometry,version:1}]});
  await run(off,{...state,trips:[ride('fresh')]});
  expect(calls(off,'record_segment_effort')).toHaveLength(0);
  expect(calls(off,'segment_catalogue_since')).toHaveLength(0);
  expect(calls(off,'segments_for_map')).toHaveLength(0);
 });
});

// Regression: sections saved in an old build must not wait for private backups.
describe('existing segments recover independently of private activity backup',()=>{
 const id='cccccccc-0000-4000-8000-000000000001';
 const points=Array.from({length:25},(_,i)=>({latitude:-34+i*0.0001,longitude:151,timestamp:100+i*5,accuracy:5,altitude:10,speed:2}));
 const oldRide={...trip,id:'old-unchanged-ride',activity:'MTB',updatedAt:1,points,details:{namedSegments:[{id,name:'Climb',startIndex:2,endIndex:20,createdAt:1,updatedAt:1}]}};
 it('publishes the original old segment before a failing private backup',async()=>{
  const api=client();api.rpc.mockImplementation(async(name,args)=>name==='publish_segment'?{data:args.p_client_id}:name==='segment_detail'?{data:{id,mine:true,status:'approved',visibility:'public',deleted:false}}:name==='backup_private_activity'?{error:{message:'backup unavailable'}}:{data:[]});
  await run(api,{...state,trips:[oldRide]}).catch(()=>{});
  expect(api.rpc).toHaveBeenCalledWith('publish_segment',expect.objectContaining({p_client_id:id,p_name:'Climb',p_geometry:points.slice(2,21).map(p=>[p.latitude,p.longitude])}));
  expect(api.rpc.mock.calls.findIndex(([name])=>name==='publish_segment')).toBeLessThan(api.rpc.mock.calls.findIndex(([name])=>name==='backup_private_activity'));
 });
 it('does not gate publication on a parent activity waiting beyond the backup batch',async()=>{
  const api=client();api.rpc.mockImplementation(async(name,args)=>name==='publish_segment'?{data:args.p_client_id}:name==='segment_detail'?{data:{id,mine:true,status:'approved',visibility:'public',deleted:false}}:{data:[]});
  await run(api,{...state,trips:[oldRide]}, {},{maxActivities:0});
  expect(api.rpc).toHaveBeenCalledWith('publish_segment',expect.objectContaining({p_client_id:id}));
  expect(api.rpc.mock.calls.some(([name])=>name==='backup_private_activity')).toBe(false);
 });
});

// One activity the cloud refuses used to end the whole pass at that activity, every time, so nothing recorded after it was
// ever backed up. Each activity now stands alone: it is remembered, retried later with a growing delay, and never blocks or
// uses the budget of the others.
describe('an activity that cannot be backed up',()=>{
 const trips=['a','b','c','d'].map((id,i)=>({...trip,id,startedAt:100+i*1000,endedAt:200+i*1000}));
 const refuse=(...ids)=>async(_name,args)=>ids.includes(args.p_payload.id)?{data:null,error:{code:'P0001',message:'Cloud activity conflict; reload before overwriting'}}:{data:1,error:null};
 it('does not hold back the activities around it, and is reported with the cloud\'s reason',async()=>{
  const api=client();api.rpc.mockImplementation(refuse('b'));
  const checkpoint=vi.fn();
  const error=await run(api,{...state,trips},{}, {checkpoint,now:1000}).catch(e=>e);
  expect(error.message).toContain('1 activity could not be backed up');
  expect(error.message).toContain('Cloud activity conflict');expect(error.message).toContain('activity b');
  expect(api.rpc.mock.calls.map(([,args])=>args.p_payload.id)).toEqual(['a','b','c','d']);
  const saved=checkpoint.mock.calls.at(-1)[0];
  expect(saved.a.revision).toBe(1);expect(saved.c.revision).toBe(1);expect(saved.d.revision).toBe(1);expect(saved.b).toBeUndefined();
  expect(saved['backup-failure:b']).toMatchObject({attempts:1,message:expect.stringContaining('conflict'),nextAt:1000+60000});
 });
 it('stays pending with its error: not retried before its time, then retried with a longer delay, and cleared when it succeeds',async()=>{
  const api=client();api.rpc.mockImplementation(refuse('b'));
  const first=await run(api,{...state,trips},{}, {now:1000}).catch(e=>e.receipts);
  const calls=()=>api.rpc.mock.calls.filter(([,args])=>args.p_payload.id==='b').length;
  expect(calls()).toBe(1);
  // Too early: b is not tried, and the failure is not reported again as new.
  await run(api,{...state,trips},first,{now:30000});
  expect(calls()).toBe(1);
  // Due: tried, fails again, the delay doubles.
  const second=await run(api,{...state,trips},first,{now:62000}).catch(e=>e.receipts);
  expect(calls()).toBe(2);expect(second['backup-failure:b']).toMatchObject({attempts:2,nextAt:62000+120000});
  // The cloud accepts it: uploaded, and the failure is cleared.
  api.rpc.mockImplementation(refuse());
  const healed=await run(api,{...state,trips},second,{now:200000});
  expect(healed.receipts.b.revision).toBe(1);expect(healed.receipts['backup-failure:b'].cleared).toBe(true);
 });
 it('lets a person retry now, ignoring the wait',async()=>{
  const api=client();api.rpc.mockImplementation(refuse('b'));
  const first=await run(api,{...state,trips},{}, {now:1000}).catch(e=>e.receipts);
  api.rpc.mockImplementation(refuse());
  const result=await run(api,{...state,trips},first,{now:2000,retryFailed:true});
  expect(result.receipts.b.revision).toBe(1);
 });
 it('failing activities do not use up the pass, so the ones behind them are still backed up',async()=>{
  const api=client();api.rpc.mockImplementation(refuse('a','b','c'));
  const first=await run(api,{...state,trips},{}, {now:1000,maxActivities:3}).catch(e=>e.receipts);
  expect(first.d).toBeUndefined();                        // the budget of 3 went on the three that fail
  const second=await run(api,{...state,trips},first,{now:2000,maxActivities:3});
  expect(second.receipts.d.revision).toBe(1);             // next pass: a, b, c wait their turn, d goes up
 });
 it('does not mark anyone, and stops, when the network is down',async()=>{
  const api=client();api.rpc.mockResolvedValue({data:null,error:{message:'Failed to fetch'}});
  const error=await run(api,{...state,trips},{}, {now:1000}).catch(e=>e);
  expect(api.rpc).toHaveBeenCalledTimes(1);
  expect(error.network).toBe(true);
  expect(Object.keys(error.receipts).filter(k=>k.startsWith('backup-failure'))).toEqual([]);
 });
 it('stops on a sign-in problem instead of marking every activity',async()=>{
  const api=client();api.rpc.mockResolvedValue({data:null,error:{status:401,message:'JWT expired'}});
  await expect(run(api,{...state,trips},{}, {now:1000})).rejects.toThrow('Sign in again');
  expect(api.rpc).toHaveBeenCalledTimes(1);
 });
 it('pushes no segment efforts or photos for an activity whose own row failed',async()=>{
  const api=client();api.rpc.mockImplementation(refuse('b'));
  const withPhoto={...trips[1],details:{photos:[{id:'11111111-1111-4111-8111-111111111111'}]}};
  api.functions={invoke:vi.fn()};
  await run(api,{...state,trips:[trips[0],withPhoto]},{}, {now:1000}).catch(()=>{});
  expect(api.functions.invoke).not.toHaveBeenCalled();
 });
 it('says how much is backed up, waiting and failing',async()=>{
  const { backupHealth }=await import('./cloudSync.js');
  const api=client();api.rpc.mockImplementation(refuse('b'));
  const receipts=await run(api,{...state,trips},{}, {now:1000}).catch(e=>e.receipts);
  expect(backupHealth({...state,trips},receipts,1000)).toEqual({total:4,backedUp:3,waiting:1,failing:[{id:'b',message:expect.stringContaining('conflict'),attempts:1,retryInSeconds:60}]});
 });
 it('treats a 403 on one activity as that activity\'s refusal, not as a reason to stop everything',async()=>{
  const api=client();api.rpc.mockImplementation(async(_n,args)=>args.p_payload.id==='b'?{data:null,error:{status:403,code:'42501',message:'permission denied'}}:{data:1,error:null});
  const error=await run(api,{...state,trips},{}, {now:1000}).catch(e=>e);
  expect(api.rpc).toHaveBeenCalledTimes(4);
  expect(error.receipts['backup-failure:b']).toMatchObject({attempts:1});
 });
 it('does not mistake a server message that merely contains a network word for being offline',async()=>{
  const api=client();api.rpc.mockImplementation(async(_n,args)=>args.p_payload.id==='b'?{data:null,error:{message:'Failed to fetch revision for activity'}}:{data:1,error:null});
  const error=await run(api,{...state,trips},{}, {now:1000}).catch(e=>e);
  expect(error.network).toBe(false);expect(api.rpc).toHaveBeenCalledTimes(4);
 });
 it('can return the partial result instead of throwing, with when to come back to the refused one, and says when each one is backed up',async()=>{
  const api=client();api.rpc.mockImplementation(refuse('b'));
  const done=[];
  const result=await run(api,{...state,trips},{}, {now:1000,throwOnFailure:false,onBackedUp:()=>done.push(1)});
  expect(result.uploaded).toBe(3);expect(done).toHaveLength(3);
  expect(result.problem.message).toContain('1 activity could not be backed up');
  expect(result.nextRetryAt).toBe(61000);
  // Only the held one is left: nothing new to report, and no outstanding work.
  const quiet=await run(api,{...state,trips},result.receipts,{now:2000,throwOnFailure:false});
  expect(quiet.problem).toBeNull();expect(quiet.pending).toBe(false);expect(quiet.nextRetryAt).toBe(61000);
 });
 it('shows a refusal of an edited, already backed-up activity, and ignores another account\'s records',async()=>{
  const { backupHealth }=await import('./cloudSync.js');
  const receipts={a:{owner:'owner',revision:1},'backup-failure:a':{owner:'OWNER',message:'conflict',attempts:2,nextAt:61000},'backup-failure:b':{owner:'someone-else',message:'x',attempts:9,nextAt:1}};
  const health=backupHealth({...state,trips:trips.slice(0,2)},receipts,1000);
  expect(health).toMatchObject({total:2,backedUp:1,waiting:1});
  expect(health.failing.map(f=>f.id)).toEqual(['a']);
 });
 it('recognises a wrapped fetch failure as being offline, and reads the sign-in status from the response',async()=>{
  const api=client();api.rpc.mockResolvedValue({data:null,error:{message:'TypeError: Failed to fetch'}});
  const down=await run(api,{...state,trips},{}, {now:1000}).catch(e=>e);
  expect(down.network).toBe(true);expect(api.rpc).toHaveBeenCalledTimes(1);
  const out=client();out.rpc.mockResolvedValue({data:null,status:401,error:{message:'No API key found in request'}});
  await expect(run(out,{...state,trips},{}, {now:1000})).rejects.toThrow('Sign in again');
 });
 it('retries an activity as soon as it is edited, even inside its wait, and forgets a refusal once the cloud already matches',async()=>{
  const api=client();api.rpc.mockImplementation(refuse('b'));
  const edited=version=>trips.map(t=>t.id==='b'?{...t,updatedAt:version}:t);
  const first=await run(api,{...state,trips:edited(1)},{}, {now:1000}).catch(e=>e.receipts);
  const bCalls=()=>api.rpc.mock.calls.filter(([,args])=>args.p_payload.id==='b').length;
  await run(api,{...state,trips:edited(1)},first,{now:2000});
  expect(bCalls()).toBe(1);                                 // inside its wait, unchanged: not tried
  api.rpc.mockImplementation(refuse());
  const fixed=await run(api,{...state,trips:edited(2)},first,{now:3000});
  expect(bCalls()).toBe(2);                                 // edited: tried now
  expect(fixed.receipts['backup-failure:b'].cleared).toBe(true);
 });
 it('drops the record of a refused activity that has since been deleted',async()=>{
  const api=client();api.rpc.mockImplementation(refuse('b'));
  const first=await run(api,{...state,trips},{}, {now:1000}).catch(e=>e.receipts);
  const after=await run(api,{...state,trips:trips.filter(t=>t.id!=='b')},first,{now:2000});
  expect(after.receipts['backup-failure:b'].cleared).toBe(true);
 });
});
