import {describe,it,expect,vi} from 'vitest';
import {syncPublicSegments} from './cloudSync.js';
import {segmentReceipt} from './segmentSyncState.js';
import {receiptPatch} from './syncReceipts.js';
const id=n=>`AAAAAAAA-0000-4000-8000-${String(n).padStart(12,'0')}`;
const start=Date.parse('2026-10-28T09:00:00Z')/1000;
const persisted=(owner='athlete-a',count=4)=>JSON.parse(JSON.stringify({ownerID:owner,trips:[{id:'old-ride',source:'device',activity:'MTB',recordingMode:'manual',state:'finished',startedAt:start,endedAt:start+600,updatedAt:start+600,
 points:Array.from({length:100},(_,i)=>({latitude:-34+i*0.0001,longitude:151,timestamp:start+i*5,accuracy:5,speed:2,altitude:10})),
 details:{namedSegments:Array.from({length:count},(_,i)=>({id:id(i+1),name:['Climb','Zoonotica','Captain Table','The Looters Cabin'][i]||`Section ${i+1}`,startIndex:i,endIndex:i+15,createdAt:start,updatedAt:start,distanceMeters:166}))}}],deletedIDs:[]}));
function backend(){
 const rows=new Map(),calls=[],fail=new Set(),lost=new Set();
 function client(initialOwner){
  let sessionOwner=initialOwner;
  const request=action=>{const headers={};return {setHeader(name,value){headers[name]=value;return this;},then(resolve,reject){return Promise.resolve().then(()=>action(headers)).then(resolve,reject);}};};
  const viewer=h=>h.Authorization?.replace('Bearer ','').replace('-token','')||sessionOwner;
  const api={auth:{getSession:vi.fn(async()=>({data:{session:{access_token:`${sessionOwner}-token`}}})),getUser:vi.fn(async token=>({data:{user:{id:token?.replace('-token','')||sessionOwner}}}))},switchAccount:owner=>{sessionOwner=owner;},
   from:vi.fn(table=>{let selected;const builder={select(){return this;},eq(_key,value){selected=value.toLowerCase();return this;},maybeSingle(){return request(headers=>{if(table!=='mtb_segments')throw new Error('Private activity read attempted');const row=rows.get(selected),me=viewer(headers);return {data:row&&!row.deleted_at&&(row.creator_id===me||row.visibility==='public'&&row.status==='approved')?structuredClone(row):null};});}};return builder;}),
   rpc:vi.fn((name,args)=>request(headers=>{
    if(name!=='publish_segment')throw new Error('Private backup or effort RPC attempted');
    const me=viewer(headers),key=args.p_client_id.toLowerCase();calls.push({me,name,args:structuredClone(args)});
    if(fail.has(key))return {error:{code:'FETCH_ERROR',message:'Temporarily unavailable'}};
    const row=rows.get(key);
    if(row&&row.creator_id!==me)return {error:{message:'Segment ID belongs to another creator'}};
    if(!row)rows.set(key,{id:key,creator_id:me,name:args.p_name,activity:args.p_activity,geometry:args.p_geometry,version:1,visibility:'public',status:'approved',access:'unknown'});
    else if(!row.deleted_at&&!['hidden','rejected','retired','changes_requested'].includes(row.status)&&!['restricted','sensitive'].includes(row.access)){
     if(args.p_rename)row.name=args.p_name;
     if(args.p_reroute){row.geometry=args.p_geometry;row.version++;}
    }
    if(lost.delete(key))return {error:{message:'Acknowledgement lost'}};
    return {data:key};
   }))};return api;
 }
 return {rows,calls,fail,lost,client};
}
const publish=(api,state,receipts={},options={})=>syncPublicSegments(api,state,receipts,{owner:state.ownerID,...options});

describe('persisted old sections',()=>{
 it.each([undefined,{backupVersion:1,updatedAt:start+600},{backupVersion:2,updatedAt:start+600}])('recovers all four unchanged sections independently of parent receipt %j',async parent=>{
  const server=backend(),api=server.client('athlete-a'),state=persisted(),before=structuredClone(state),checkpoints=[];
  const result=await publish(api,state,parent?{'old-ride':{owner:state.ownerID,...parent}}:{},{checkpoint:async receipts=>checkpoints.push(structuredClone(receipts))});
  expect(result.published).toBe(4);expect(server.rows.size).toBe(4);expect(state).toEqual(before);
  expect(server.calls.map(x=>x.args.p_name)).toEqual(['Climb','Zoonotica','Captain Table','The Looters Cabin']);
  for(let i=0;i<4;i++){
   const args=server.calls[i].args,section=state.trips[0].details.namedSegments[i];
   expect(args.p_client_id).toBe(section.id.toLowerCase());
   expect(args.p_geometry).toEqual(state.trips[0].points.slice(section.startIndex,section.endIndex+1).map(p=>[p.latitude,p.longitude]));
   expect(JSON.stringify(args)).not.toMatch(/timestamp|heartRate|activity_id|owner_id/);
   expect(segmentReceipt(checkpoints.at(-1),section.id)).toMatchObject({uploaded:true,confirmedAt:expect.any(Number)});
  }
  const calls=server.calls.length;await publish(api,state,result.receipts);expect(server.calls).toHaveLength(calls);
 });
 it('reconciles an old uppercase receipt without overwriting admin corrections',async()=>{
  const server=backend(),api=server.client('athlete-a'),state=persisted('athlete-a',1);
  server.rows.set(id(1).toLowerCase(),{id:id(1).toLowerCase(),creator_id:'athlete-a',name:'Admin correction',activity:'Hiking',geometry:[[9,8]],version:4,status:'approved',visibility:'public',access:'unknown'});
  const r=await publish(api,state,{['mtb-segment:'+id(1)]:{owner:'ATHLETE-A',uploaded:true}});
  expect(r.published).toBe(1);expect(server.rows.get(id(1).toLowerCase())).toMatchObject({name:'Admin correction',activity:'Hiking',geometry:[[9,8]],version:4});
  expect(server.calls[0].args).toMatchObject({p_rename:false,p_reroute:false,p_activity:null});
 });
 it('survives a lost acknowledgement and restart without duplicating or rerouting',async()=>{
  const server=backend(),api=server.client('athlete-a'),state=persisted('athlete-a',1);server.lost.add(id(1).toLowerCase());
  const first=await publish(api,state);expect(first.failure).toBeTruthy();expect(server.rows.size).toBe(1);
  const next=await publish(server.client('athlete-a'),JSON.parse(JSON.stringify(state)),JSON.parse(JSON.stringify(first.receipts)));
  expect(next.published).toBe(1);expect(server.rows.size).toBe(1);expect(server.rows.get(id(1).toLowerCase()).version).toBe(1);
 });
 it('applies later explicit local edits using the last confirmed client baseline',async()=>{
  const server=backend(),api=server.client('athlete-a'),state=persisted('athlete-a',1),first=await publish(api,state);
  state.trips[0].details.namedSegments[0].name='Climb upper';state.trips[0].details.namedSegments[0].startIndex=3;
  await publish(api,state,first.receipts);
  expect(server.rows.get(id(1).toLowerCase())).toMatchObject({name:'Climb upper',version:2});
 });
 it.each([{deleted_at:'2026-11-01',status:'retired'}, {status:'hidden'},{status:'rejected'},{access:'restricted'},{access:'sensitive'}])('never resurrects or modifies unavailable server section %j',async flags=>{
  const server=backend(),api=server.client('athlete-a'),state=persisted('athlete-a',1),key=id(1).toLowerCase();
  server.rows.set(key,{id:key,creator_id:'athlete-a',name:'Server version',status:'approved',visibility:'public',access:'unknown',version:3,...flags});
  const before=structuredClone(server.rows.get(key)),result=await publish(api,state);
  expect(result.published).toBe(0);expect(segmentReceipt(result.receipts,id(1)).blocked).toBe(true);expect(server.rows.get(key)).toEqual(before);
 });
 it('bounds work and lets later sections progress past a failing first batch',async()=>{
  const server=backend(),api=server.client('athlete-a'),state=persisted('athlete-a',14);server.fail.add(id(1).toLowerCase());
  const first=await publish(api,state,{}, {maxSegments:3,now:()=>100});expect(first.pending).toBe(true);expect(server.calls).toHaveLength(3);expect(first.published).toBe(2);
  const next=await publish(api,state,first.receipts,{maxSegments:3,now:()=>200});expect(next.published).toBe(3);expect(server.calls.slice(3).map(x=>x.args.p_client_id)).toEqual([4,5,6].map(n=>id(n).toLowerCase()));
 });
 it('pins publication requests to the verified account even if the app switches accounts',async()=>{
  const server=backend(),api=server.client('athlete-a'),state=persisted('athlete-a',1);
  api.auth.getUser.mockImplementation(async()=>{api.switchAccount('athlete-b');return {data:{user:{id:'athlete-a'}}};});
  const r=await publish(api,state);expect(r.published).toBe(1);expect(server.rows.get(id(1).toLowerCase()).creator_id).toBe('athlete-a');
  await expect(publish(server.client('athlete-b'),state)).rejects.toThrow(/Sign in/);
 });
 it('does not publish a tombstoned parent recording',async()=>{
  const state=persisted(),server=backend();state.deletedIDs=['old-ride'];const r=await publish(server.client('athlete-a'),state);expect(r.published).toBe(0);expect(server.calls).toEqual([]);
 });
});

it('merges publication and private-backup checkpoints without dropping either',()=>{
 const key='mtb-segment:'+id(1).toLowerCase(),fresh={publicationAt:200,confirmedAt:200,uploaded:true};
 let preferences={syncReceipts:{trip:{revision:2},[key]:fresh}};
 preferences={...preferences,...receiptPatch(preferences,{trip:{revision:3},[key]:{publicationAt:100,failed:'old'}})};
 expect(preferences.syncReceipts).toMatchObject({trip:{revision:3},[key]:fresh});
 preferences={...preferences,...receiptPatch(preferences,{trip:{revision:1},[key]:{...fresh,publicationAt:300}}, {},true)};
 expect(preferences.syncReceipts.trip.revision).toBe(3);
});

it('keeps an auth outage diagnosable and retries safely instead of silently losing old sections',async()=>{
 const server=backend(),api=server.client('athlete-a'),state=persisted('athlete-a',1),checkpoint=vi.fn();
 api.auth.getUser.mockResolvedValueOnce({error:{message:'Network offline'}});
 const result=await publish(api,state,{}, {checkpoint});
 expect(segmentReceipt(result.receipts,id(1))).toMatchObject({failed:expect.any(String),errorCode:'AUTH_UNAVAILABLE',attempts:1});
 expect(checkpoint).toHaveBeenCalled();expect(server.rows.size).toBe(0);
 const retried=await publish(api,state,result.receipts);expect(retried.published).toBe(1);
});
