// The sync engine against a stand-in Supabase client. These tests describe what the
// user is promised: an upgrade uploads what the device already knows, a retry cannot
// duplicate anything, unreadable saved information is never replaced, and edits made
// while offline survive a restart.
import {describe,it,expect} from 'vitest';
import {emptyGrouping} from './journeyGrouping.js';
import {JOURNEY_QUEUE_BYTES,applyChanges,missingRecords} from './journeyMetadata.js';
import {APPLY_FUNCTION,REVISION_FUNCTION,SNAPSHOT_FUNCTION,createJourneySync,emptyStatus,encodeQueue,journeyStatePatch,localMetadata,readJourneyState,readQueue,readStatus,runJourneySync} from './journeyMetadataStore.js';
const OWNER='owner-1';
const EDGE=JSON.stringify(['a','b']);
function grouping(){
 const m=emptyGrouping(OWNER);
 m.links=[EDGE];m.titles={a:'Morning drive'};m.manualTags={a:['work']};m.enrichFrom=1699999999000;
 m.stopEdits={[`dwell:a:1700000000`]:{name:'Cafe',tags:['coffee'],replaceTags:true}};
 m.roads={['a:1700000000:1700000900']:{version:2,status:'route',distanceMeters:800,line:'abc',lookedUpAt:1700000000000}};
 return m;
}
const activity=(ref,title)=>({ref,title,enrichedAt:null,enrichmentState:'pending',enrichmentVersion:1});
// The server's own report of what a write replaced, reduced to the fields this engine
// reads. It is what the migration and the device status are built from.
function overwritten(before,changes){
 const found=[];
 for(const item of changes?.activities||[])
  if(item.delete!==true&&typeof item.title==='string'&&before.titles[item.ref]!==undefined&&before.titles[item.ref]!==item.title)found.push({domain:'activities',ref:item.ref});
 for(const [name,map,key] of [['places','places','lookup'],['roads','roads','record'],['summaries','distanceSummaries','snapshot']])
  for(const item of changes?.[name]||[]){
   if(item.delete===true)continue;
   const existing=before[map]?.[item.ref];
   if(existing&&JSON.stringify(existing)!==JSON.stringify(item[key]))found.push({domain:name,ref:item.ref});
  }
 return found;
}
function fakeCloud({metadata=emptyGrouping(OWNER),revision=1,legacy=null}={}){
 const state={metadata,revision,legacy,requests:[],legacyReads:0};
 return {
  state,
  client:{
   async rpc(name,args){
    state.requests.push(name);
    if(name===REVISION_FUNCTION)return {data:state.revision,error:null};
    if(name===SNAPSHOT_FUNCTION)return {data:{...structuredClone(state.metadata),revision:state.revision,updatedAt:'2026-01-01T00:00:00.000Z'},error:null};
    if(name===APPLY_FUNCTION){
     if(args.p_expected_revision!==null&&args.p_expected_revision!==state.revision)return {data:null,error:{message:'Cloud settings conflict; reload before overwriting'}};
     const replaced=overwritten(state.metadata,args.p_changes);
     state.metadata=applyChanges(state.metadata,args.p_changes);state.revision+=1;
     return {data:{revision:state.revision,overwritten:replaced},error:null};
    }
    return {data:null,error:{message:'Unknown function'}};
   },
   from(){
    return {select(){return {eq(){return {async maybeSingle(){state.legacyReads+=1;return {data:state.legacy?{payload:{journeyGrouping:state.legacy}}:null,error:null};}};}};}};
   }
  }
 };
}
function harness({metadata=null,queue={},status=emptyStatus(OWNER)}={}){
 const store={metadata,queue,status};
 const writes=[];
 return {store,writes,read:()=>store,write:patch=>{Object.assign(store,patch);writes.push(patch);}};
}
describe('the queue that survives a restart',()=>{
 it('round trips and refuses another account',()=>{
  const changes={activities:[activity('a','Morning drive')]};
  const encoded=encodeQueue(changes,OWNER);
  expect(readQueue(encoded,OWNER).changes.activities).toHaveLength(1);
  expect(readQueue(encoded,'someone-else').changes).toEqual({});
  expect(readQueue('garbage',OWNER).changes).toEqual({});
  expect(encodeQueue({},OWNER)).toBe('');
 });
 it('reports an unreadable mirror instead of pretending it is empty',()=>{
  expect(localMetadata('{"version":1}',OWNER)).toEqual({metadata:null,state:'unreadable'});
  expect(localMetadata('',OWNER).state).toBe('empty');
  expect(localMetadata(JSON.stringify(grouping()),OWNER).state).toBe('ready');
 });
 it('forgets the saved status when another account signs in',()=>{
  expect(readStatus({journeyMetadata:{owner:'someone-else',revision:4}},OWNER)).toEqual(emptyStatus(OWNER));
  expect(readStatus({journeyMetadata:{owner:OWNER,revision:4,migratedAt:17,state:'active'}},OWNER))
   .toMatchObject({revision:4,migratedAt:17,state:'active'});
 });
});
describe('upgrading a device that already has journeys',()=>{
 it('uploads what the device knows and only then replaces the mirror',async()=>{
  const cloud=fakeCloud(),local=grouping(),h=harness({metadata:local});
  const result=await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write,now:()=>1700000000000});
  expect(result.state).toBe('active');
  expect(cloud.state.metadata.titles).toEqual({a:'Morning drive'});
  expect(cloud.state.metadata.links).toEqual([EDGE]);
  expect(cloud.state.metadata.stopEdits).toEqual(local.stopEdits);
  expect(cloud.state.metadata.enrichFrom).toBe(1699999999000);
  expect(h.store.status).toMatchObject({owner:OWNER,state:'active',migratedAt:1700000000000,revision:cloud.state.revision,error:null});
  expect(missingRecords(h.store.metadata,cloud.state.metadata)).toEqual([]);
  expect(h.store.queue).toEqual({});
 });
 it('does nothing at all the second time',async()=>{
  const cloud=fakeCloud(),h=harness({metadata:grouping()});
  await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write,now:()=>1700000000000});
  const settled=cloud.state.revision,before=h.writes.length;
  const result=await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write,now:()=>1700000001000});
  expect(result.state).toBe('active');
  expect(cloud.state.revision).toBe(settled);
  expect(h.writes.length).toBe(before);
 });
 it('recovers a device whose own mirror cannot be read from the cloud backup',async()=>{
  const cloud=fakeCloud({legacy:JSON.stringify(grouping())}),h=harness({metadata:null});
  const result=await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write,now:()=>1700000000000});
  expect(result.state).toBe('active');
  expect(cloud.state.metadata.titles).toEqual({a:'Morning drive'});
  expect(h.store.metadata.titles).toEqual({a:'Morning drive'});
  // The backup is a one-time source: once the records exist, later runs read them.
  expect(cloud.state.legacyReads).toBe(1);
  await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write,now:()=>1700000001000});
  expect(cloud.state.legacyReads).toBe(1);
  expect(h.store.status.state).toBe('active');
 });
 it('seeds a new phone from the backup an older build left, once',async()=>{
  // A first upgrade on a replacement device has an empty mirror and no records yet:
  // the only copy of those journeys is the settings backup.
  const cloud=fakeCloud({legacy:JSON.stringify(grouping())}),h=harness({metadata:emptyGrouping(OWNER)});
  const result=await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write,now:()=>1700000000000});
  expect(result.state).toBe('active');
  expect(cloud.state.metadata.titles).toEqual({a:'Morning drive'});
  expect(cloud.state.metadata.links).toEqual([EDGE]);
  expect(h.store.metadata.titles).toEqual({a:'Morning drive'});
  expect(cloud.state.legacyReads).toBe(1);
  await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write,now:()=>1700000001000});
  expect(cloud.state.legacyReads).toBe(1);
 });
 it('adopts the cloud copy instead of stalling when its own file cannot be read',async()=>{
  const cloud=fakeCloud({metadata:grouping(),revision:7,legacy:JSON.stringify(grouping())}),h=harness({metadata:null});
  const result=await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write,now:()=>1700000000000});
  expect(result.state).toBe('active');
  expect(h.store.metadata.titles).toEqual({a:'Morning drive'});
  expect(h.store.status.migratedAt).toBe(1700000000000);
  // The records already exist, so the backup was not needed and nothing was pushed.
  expect(cloud.state.legacyReads).toBe(0);
  expect(cloud.state.requests).toEqual([SNAPSHOT_FUNCTION,SNAPSHOT_FUNCTION]);
  expect(cloud.state.revision).toBe(7);
 });
 it('sends the values queued behind the mirror before it replaces it',async()=>{
  // An edit made before the first sync must not be left behind when the local mirror
  // is replaced by the cloud copy.
  const cloud=fakeCloud(),h=harness({metadata:emptyGrouping(OWNER),queue:{activities:[activity('a','Queued before the upgrade')]}});
  const result=await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write,now:()=>1700000000000});
  expect(result.state).toBe('active');
  expect(cloud.state.metadata.titles).toEqual({a:'Queued before the upgrade'});
  expect(h.store.metadata.titles).toEqual({a:'Queued before the upgrade'});
  expect(h.store.queue).toEqual({});
 });
 it('stops before stamping migratedAt when a record does not arrive',async()=>{
  // A store that silently drops a record must not be recorded as migrated: the run
  // reports what is missing, keeps the mirror, and tries again next time.
  const cloud=fakeCloud(),h=harness({metadata:grouping()});
  const lossy={async rpc(name,args){
   if(name===APPLY_FUNCTION)return {data:{revision:cloud.state.revision+1,overwritten:[]},error:null};
   return cloud.client.rpc(name,args);
  },from:cloud.client.from};
  const first=await runJourneySync({client:lossy,owner:OWNER,read:h.read,write:h.write,now:()=>1700000000000});
  expect(first).toMatchObject({state:'incomplete'});
  expect(h.store.status.migratedAt).toBe(null);
  expect(h.store.metadata).toEqual(grouping());
  // Nothing was lost on the device, and the next run still migrates.
  const second=await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write,now:()=>1700000000100});
  expect(second.state).toBe('active');
  expect(h.store.status.migratedAt).toBe(1700000000100);
  expect(cloud.state.metadata.titles).toEqual({a:'Morning drive'});
 });
 it('refuses to replace a mirror it cannot read when there is no copy anywhere',async()=>{
  const cloud=fakeCloud(),h=harness({metadata:null});
  const result=await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write,now:()=>1700000000000});
  expect(result.state).toBe('recoveryRequired');
  expect(h.store.status.state).toBe('recoveryRequired');
  // It may look - one cheap question - but it never writes.
  expect(cloud.state.requests).toEqual([SNAPSHOT_FUNCTION]);
  expect(h.writes.every(patch=>patch.metadata===undefined)).toBe(true);
 });
 it('leaves recoveryRequired once another device has uploaded the records',async()=>{
  // The stranded device keeps asking; when a working device finally uploads, this one
  // adopts the records instead of staying broken for ever.
  const cloud=fakeCloud(),h=harness({metadata:null,status:{...emptyStatus(OWNER),state:'recoveryRequired',error:'Saved journey information on this device could not be read.'}});
  expect((await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write,now:()=>1700000000000})).state).toBe('recoveryRequired');
  cloud.state.metadata=grouping();cloud.state.revision=3;
  const recovered=await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write,now:()=>1700000001000});
  expect(recovered.state).toBe('active');
  expect(h.store.metadata.titles).toEqual({a:'Morning drive'});
  expect(h.store.status).toMatchObject({state:'active',error:null,migratedAt:1700000001000});
 });
});

describe('editing while the cloud is unreachable',()=>{
 const settled=()=>({...emptyStatus(OWNER),revision:1,migratedAt:1700000000000,state:'active'});
 const offline={async rpc(){throw new Error('Network request failed');},from(){throw new Error('Network request failed');}};
 it('keeps the queued edit and sends it on the next run',async()=>{
  const cloud=fakeCloud({metadata:grouping()});
  const h=harness({metadata:grouping(),status:settled(),queue:{activities:[activity('a','Renamed offline')]}});
  const failed=await runJourneySync({client:offline,owner:OWNER,read:h.read,write:h.write});
  expect(failed).toMatchObject({state:'offline',error:'Network request failed'});
  expect(h.store.status.state).toBe('offline');
  expect(h.store.queue.activities).toHaveLength(1);
  const recovered=await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write});
  expect(recovered.state).toBe('active');
  expect(h.store.queue).toEqual({});
  expect(cloud.state.metadata.titles).toEqual({a:'Renamed offline'});
 });
 it('keeps an edit made on another device while this one was away',async()=>{
  const cloud=fakeCloud({metadata:grouping(),revision:5});
  cloud.state.metadata=applyChanges(cloud.state.metadata,{activities:[activity('b','Renamed on my iPad')]});
  cloud.state.revision=6;
  const h=harness({metadata:grouping(),status:{...settled(),revision:5},
   queue:{activities:[activity('a','Renamed on this iPhone')]}});
  const result=await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write});
  expect(result.state).toBe('active');
  expect(cloud.state.metadata.titles).toEqual({a:'Renamed on this iPhone',b:'Renamed on my iPad'});
  expect(h.store.metadata.titles).toEqual({a:'Renamed on this iPhone',b:'Renamed on my iPad'});
  expect(h.store.queue).toEqual({});
 });
 it('re-reads and re-sends once when both devices write at the same moment',async()=>{
  const cloud=fakeCloud({metadata:grouping(),revision:5});
  const h=harness({metadata:grouping(),status:{...settled(),revision:5},
   queue:{activities:[activity('a','Renamed on this iPhone')]}});
  const racing={async rpc(name,args){
   // The other device lands between our revision read and our write.
   if(name===APPLY_FUNCTION){cloud.state.metadata=applyChanges(cloud.state.metadata,{activities:[activity('b','Renamed on my iPad')]});cloud.state.revision=6;}
   return cloud.client.rpc(name,args);
  },from:cloud.client.from};
  const result=await runJourneySync({client:racing,owner:OWNER,read:h.read,write:h.write});
  expect(result.state).toBe('active');
  expect(cloud.state.metadata.titles).toEqual({a:'Renamed on this iPhone',b:'Renamed on my iPad'});
  expect(h.store.status.state).toBe('active');
  expect(h.store.queue).toEqual({});
 });
 it('reports a same-record race instead of hiding it',async()=>{
  // Both devices renamed journey 'a'. The later write wins, because a record is a
  // value, but the device is told which record it replaced.
  const cloud=fakeCloud({metadata:grouping(),revision:6});
  cloud.state.metadata=applyChanges(cloud.state.metadata,{activities:[activity('a','Renamed on my iPad')]});
  const h=harness({metadata:grouping(),status:{...settled(),revision:6},
   queue:{activities:[activity('a','Renamed on this iPhone')]}});
  const result=await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write});
  expect(result.state).toBe('active');
  expect(cloud.state.metadata.titles.a).toBe('Renamed on this iPhone');
  expect(h.store.status.conflicts).toEqual({activities:1,total:1});
  expect(h.store.queue).toEqual({});
 });
 it('asks one cheap question when nothing has changed',async()=>{
  const cloud=fakeCloud({metadata:grouping(),revision:4});
  const h=harness({metadata:grouping(),status:{...settled(),revision:4}});
  await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write});
  // No snapshot download and no write for an idle pass.
  expect(cloud.state.requests).toEqual([REVISION_FUNCTION]);
  expect(h.writes).toEqual([]);
 });
 it('uploads what the device knows when the cloud copy has gone',async()=>{
  // A restored project or a cleared table returns nothing at all; pulling that empty
  // answer over the mirror would throw away every title and merge on the device.
  const cloud=fakeCloud({revision:null});
  const h=harness({metadata:grouping(),status:{...settled(),revision:9}});
  const result=await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write,now:()=>1700000000000});
  expect(result.state).toBe('active');
  expect(cloud.state.metadata.titles).toEqual({a:'Morning drive'});
  expect(h.store.metadata.titles).toEqual({a:'Morning drive'});
  expect(h.store.status).toMatchObject({state:'active',revision:cloud.state.revision});
 });
});
describe('the preferences-backed store the app reads',()=>{
 const settled={...emptyStatus(OWNER),revision:3,migratedAt:1700000000000,state:'active'};
 const queued={activities:[activity('a','Renamed offline')]};
 function device(preferences={}){
  const saves=[],value={...preferences};
  return {value,saves,sync:createJourneySync({owner:OWNER,preferences:value,savePreferences:patch=>{saves.push(patch);Object.assign(value,patch);}})};
 }
 it('reads the mirror, the queue and the status of this account only',()=>{
  const preferences={journeyGrouping:JSON.stringify(grouping()),journeyMetadataQueue:encodeQueue(queued,OWNER),journeyMetadata:settled};
  const state=readJourneyState(preferences,OWNER);
  expect(state.metadata.titles).toEqual({a:'Morning drive'});
  expect(state.queue.activities).toHaveLength(1);
  expect(state.status).toMatchObject({revision:3,state:'active'});
  const other=readJourneyState(preferences,'someone-else');
  expect(other.queue).toEqual({});expect(other.status).toEqual(emptyStatus('someone-else'));
  // Another account's file is reported as unreadable rather than adopted or replaced.
  expect(other.metadata).toBe(null);
 });
 it('writes only the keys that changed, never the whole preferences file',()=>{
  const state={metadata:grouping(),queue:queued,status:settled};
  expect(journeyStatePatch(state,OWNER,new Set(['queue']))).toEqual({journeyMetadataQueue:encodeQueue(queued,OWNER)});
  expect(journeyStatePatch({...state,metadata:null},OWNER,new Set(['metadata']))).toEqual({});
 });
 it('turns an edit and the status into one preferences save',async()=>{
  const {value,saves,sync}=device({displayName:'Jules',journeyMetadata:settled});
  sync.write({metadata:grouping(),queue:queued,status:{...settled,state:'offline'}});
  expect(sync.read().queue.activities).toHaveLength(1);
  expect(saves).toHaveLength(0);
  await sync.flush();
  expect(saves).toHaveLength(1);
  expect(Object.keys(saves[0]).sort()).toEqual(['journeyGrouping','journeyMetadata','journeyMetadataQueue']);
  expect(JSON.parse(value.journeyGrouping).titles).toEqual({a:'Morning drive'});
  expect(value.journeyMetadata.state).toBe('offline');
  expect(value.displayName).toBe('Jules');
 });
 it('keeps an edit queued when the device refuses the write',async()=>{
  let fail=true;const saves=[];
  const sync=createJourneySync({owner:OWNER,preferences:{},savePreferences:patch=>{if(fail)throw new Error('Sign in to change account settings.');saves.push(patch);}});
  sync.write({queue:queued});
  await sync.flush().catch(()=>{});
  expect(saves).toEqual([]);
  fail=false;
  await sync.flush();
  expect(saves).toHaveLength(1);
  expect(readQueue(saves[0].journeyMetadataQueue,OWNER).changes.activities).toHaveLength(1);
 });
 it('recovers the account file when it is handed an empty one first',async()=>{
  // The adapter is created before the account file has been read: without this the
  // first edit would be written from an empty mirror over the real one.
  const preferences={displayName:'Jules',journeyGrouping:JSON.stringify(grouping()),
   journeyMetadataQueue:encodeQueue(queued,OWNER),journeyMetadata:settled};
  const saves=[];
  const sync=createJourneySync({owner:OWNER,preferences:{},savePreferences:patch=>saves.push(patch)});
  expect(sync.read().metadata.titles).toEqual({});
  sync.reseed(preferences);
  expect(sync.read().metadata.titles).toEqual({a:'Morning drive'});
  expect(sync.read().queue.activities).toHaveLength(1);
  expect(sync.read().status).toMatchObject({revision:3,migratedAt:settled.migratedAt});
  expect(saves).toEqual([]);
 });
 it('never lets a late hydration undo an edit this device already made',async()=>{
  const sync=createJourneySync({owner:OWNER,preferences:{},savePreferences:()=>{}});
  sync.write({metadata:grouping(),queue:queued});
  sync.reseed({journeyGrouping:JSON.stringify(emptyGrouping(OWNER)),
   journeyMetadata:{owner:OWNER,revision:2,migratedAt:5,state:'active'}});
  expect(sync.read().metadata.titles).toEqual({a:'Morning drive'});
  expect(sync.read().queue.activities).toHaveLength(1);
  expect(sync.read().status.migratedAt).toBe(null);
  await sync.flush();
 });
});
describe('a device that has been offline long enough to fill its queue',()=>{
 const road=index=>({ref:`a:${1700000000+index}:${1700000060+index}`,
  record:{version:2,status:'route',distanceMeters:800,line:'x'.repeat(2000),lookedUpAt:1700000000000+index}});
 const place=index=>({ref:`${index}.0000,13.0000`,lookup:{nearbyName:`Place ${index}`,categories:['park'],detail:'y'.repeat(1500)}});
 const decisions={activities:[activity('a','Morning drive')],pairs:[{relation:'link',left:'a',right:'b'}],
  stops:[{ref:'dwell:a:1700000000',name:'Cafe',tags:['coffee']}]};
 function device(){const saves=[],value={};return {value,saves,sync:createJourneySync({owner:OWNER,preferences:{},
  savePreferences:patch=>{saves.push(patch);Object.assign(value,patch);}})};}
 it('gives up recomputable answers first, counts them, and never a decision',async()=>{
  const backlog={...decisions,roads:Array.from({length:300},(_,index)=>road(index)),
   places:Array.from({length:60},(_,index)=>place(index))};
  // The demonstration: two days of road reconstruction and place lookups is far more
  // than the device will ever accept in one preference value.
  expect(JSON.stringify(backlog).length).toBeGreaterThan(JOURNEY_QUEUE_BYTES*1.5);
  const {value,saves,sync}=device();
  sync.write({queue:backlog});
  await sync.flush();
  expect(saves).toHaveLength(1);
  const stored=readQueue(value.journeyMetadataQueue,OWNER);
  // Every decision survives, unchanged and complete.
  expect(stored.changes.activities).toEqual(decisions.activities);
  expect(stored.changes.pairs).toEqual(decisions.pairs);
  expect(stored.changes.stops).toEqual(decisions.stops);
  // The recomputable half is bounded by the queue budget and reports what it gave up.
  expect(JSON.stringify(stored.changes).length).toBeLessThanOrEqual(JOURNEY_QUEUE_BYTES);
  expect(stored.dropped.roads).toBeGreaterThan(0);
  expect(JSON.stringify(stored.dropped)).not.toContain('undefined');
  // Oldest first, so the road the device rebuilt last is the one it still sends.
  expect(stored.changes.roads.at(-1)).toEqual(road(299));
  // One preference value, well inside the 1 MB the native store accepts, so the
  // save that carries it (and every unrelated setting) still succeeds.
  expect(value.journeyMetadataQueue.length).toBeLessThan(900000);
 });
 it('forgets the count once the queue has been sent',async()=>{
  const sync=createJourneySync({owner:OWNER,preferences:{},savePreferences:()=>{}});
  sync.write({queue:{...decisions,roads:Array.from({length:300},(_,index)=>road(index))}});
  expect(Object.keys(sync.read().dropped)).not.toEqual([]);
  sync.write({queue:{}});
  await sync.flush();
  expect(sync.read().dropped).toEqual({});
 });
});


