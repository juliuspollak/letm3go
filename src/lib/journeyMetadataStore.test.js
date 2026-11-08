// The sync engine against a stand-in Supabase client. These tests describe what the
// user is promised: an upgrade uploads what the device already knows, a retry cannot
// duplicate anything, unreadable saved information is never replaced, and edits made
// while offline survive a restart.
import {describe,it,expect} from 'vitest';
import {emptyGrouping} from './journeyGrouping.js';
import {applyChanges,describeGrouping,groupingChanges,missingRecords} from './journeyMetadata.js';
import {APPLY_FUNCTION,REVISION_FUNCTION,SNAPSHOT_FUNCTION,createJourneySync,emptyStatus,encodeQueue,localMetadata,readQueue,readStatus,runJourneySync} from './journeyMetadataStore.js';
const OWNER='owner-1';
const EDGE=JSON.stringify(['a','b']);
function grouping(){
 const m=emptyGrouping(OWNER);
 m.links=[EDGE];m.titles={a:'Morning drive'};m.manualTags={a:['work']};m.enrichFrom=1699999999000;
 m.stopEdits={[`dwell:a:1700000000`]:{name:'Cafe',tags:['coffee'],replaceTags:true}};
 m.roads={['a:1700000000:1700000900']:{version:2,status:'route',distanceMeters:800,line:'abc',lookedUpAt:1700000000000}};
 return m;
}
const activity=(ref,title)=>({ref,title,enrichedAt:null,enrichmentState:'pending',enrichmentVersion:1,_fields:['title'],_base:{title:ref==='a'?'Morning drive':null}});
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
    if(name===SNAPSHOT_FUNCTION){
     if(args.p_refs){
      const refs=args.p_refs,described=describeGrouping(state.metadata),changes={};
      for(const name of ['activities','summaries','stops'])changes[name]=[...described[name].values()].filter(item=>refs.includes(item.ref));
      changes.pairs=[...described.pairs.values()].filter(item=>refs.includes(item.left)||refs.includes(item.right));
      changes.roads=args.p_detail_refs?.length?[...described.roads.values()].filter(item=>args.p_detail_refs.some(id=>item.ref.startsWith(id+':'))):[];
      changes.places=[...described.places.values()].filter(item=>(args.p_place_refs||[]).includes(item.ref));
      const metadata=applyChanges(emptyGrouping(OWNER),changes);metadata.enrichFrom=state.metadata.enrichFrom;
      return {data:{...metadata,scope:refs,details:args.p_detail_refs||[],complete:true,recordsExist:Object.values(described).some(value=>value instanceof Map&&value.size),activityRows:[],invalidations:[],next:null,atRevision:state.revision,revision:state.revision},error:null};
     }
     return {data:{...structuredClone(state.metadata),revision:state.revision,updatedAt:'2026-01-01T00:00:00.000Z'},error:null};
    }
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
 return {store,writes,read:()=>store,write:patch=>{const value=typeof patch==='function'?patch(store):patch;Object.assign(store,value);writes.push(value);}};
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
 it('preserves a competing same-field edit instead of overwriting it',async()=>{
  // Both devices renamed journey 'a'. The later write wins, because a record is a
  // value, but the device is told which record it replaced.
  const cloud=fakeCloud({metadata:grouping(),revision:6});
  cloud.state.metadata=applyChanges(cloud.state.metadata,{activities:[activity('a','Renamed on my iPad')]});
  const h=harness({metadata:grouping(),status:{...settled(),revision:5},
   queue:{activities:[activity('a','Renamed on this iPhone')]}});
  const result=await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write:h.write});
  expect(result.state).toBe('offline');
  expect(cloud.state.metadata.titles.a).toBe('Renamed on my iPad');
  expect(h.store.status.error).toContain('Conflicting journey fields');
  expect(h.store.queue.activities[0].title).toBe('Renamed on this iPhone');
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
function disk(){
 let rows={};let fail=false;
 return {get rows(){return rows;},set fail(value){fail=value;},
  async read(){return structuredClone(rows);},
  async commit(operations){if(fail)throw new Error('Disk full');const next=structuredClone(rows);for(const op of operations)if(op.remove)delete next[op.key];else next[op.key]=structuredClone(op.value);rows=next;}
 };
}
describe('transactional per-record device storage',()=>{
 const settled={...emptyStatus(OWNER),revision:3,migratedAt:1700000000000,state:'active'};
 it('migrates every legacy value before clearing preferences and survives restarts',async()=>{
  const storage=disk(),savePreferences=patch=>Object.assign(preferences,patch);
  const preferences={displayName:'Jules',journeyGrouping:JSON.stringify(grouping()),journeyMetadata:settled};
  const sync=createJourneySync({owner:OWNER,preferences,savePreferences,storage});
  await sync.ready();
  expect(preferences).toMatchObject({displayName:'Jules',journeyGrouping:null,journeyMetadataQueue:null});
  const next={...sync.read().metadata,titles:{a:'Offline rename'}};
  await sync.write({metadata:next,queue:groupingChanges(sync.read().metadata,next)});
  const restarted=createJourneySync({owner:OWNER,preferences,savePreferences,storage});await restarted.ready();
  expect(restarted.read().metadata.titles.a).toBe('Offline rename');
  expect(restarted.read().queue.activities[0].title).toBe('Offline rename');
 });
 it('never acknowledges a failed transaction and allows later recovery',async()=>{
  const storage=disk(),sync=createJourneySync({owner:OWNER,preferences:{journeyGrouping:JSON.stringify(grouping())},savePreferences:()=>{},storage});
  await sync.ready();const before=structuredClone(storage.rows);storage.fail=true;
  await expect(sync.write({queue:{activities:[activity('a','Not saved')]}})).rejects.toThrow('Disk full');
  expect(sync.read().queue).toEqual({});expect(storage.rows).toEqual(before);
  storage.fail=false;await sync.write({queue:{activities:[activity('a','Saved')]}});
  expect(sync.read().queue.activities[0].title).toBe('Saved');
 });
 it('keeps multi-megabyte reconstructed routes and all offline decisions across restart',async()=>{
  const storage=disk(),preferences={},savePreferences=patch=>Object.assign(preferences,patch);
  const sync=createJourneySync({owner:OWNER,preferences,savePreferences,storage});await sync.ready();
  const roads=Array.from({length:900},(_,i)=>({ref:`a:${i}:${i+1}`,record:{line:'x'.repeat(6000),status:'route',version:2}}));
  const pending={roads,activities:Array.from({length:5000},(_,i)=>activity(`a${i}`,'A permanent decision'))};
  await sync.write({metadata:applyChanges(emptyGrouping(OWNER),pending),queue:pending});
  expect(JSON.stringify(storage.rows).length).toBeGreaterThan(10000000);
  expect(JSON.stringify(preferences).length).toBeLessThan(1000);
  const restarted=createJourneySync({owner:OWNER,preferences,savePreferences,storage});await restarted.ready();
  expect(restarted.read().queue.roads).toHaveLength(900);expect(restarted.read().queue.activities).toHaveLength(5000);
  expect(Object.keys(restarted.read().metadata.roads)).toHaveLength(900);
  const cloud=fakeCloud();
  expect((await runJourneySync({client:cloud.client,owner:OWNER,...restarted})).state).toBe('active');
  await restarted.flush();
  expect(restarted.read().queue).toEqual({});expect(Object.keys(restarted.read().metadata.roads)).toHaveLength(900);
  expect(Object.keys(cloud.state.metadata.titles)).toHaveLength(5000);
  expect(Object.keys(restarted.read().metadata.titles).length).toBeLessThanOrEqual(200);
 },30000);
 it('serializes overlapping writes and preserves edits made during a commit',async()=>{
  const storage=disk(),sync=createJourneySync({owner:OWNER,preferences:{},savePreferences:()=>{},storage});await sync.ready();
  await Promise.all(['a','b','c'].map(ref=>sync.write(latest=>({queue:{activities:[...(latest.queue.activities||[]),activity(ref,ref)]}}))));
  expect(sync.read().queue.activities.map(item=>item.ref)).toEqual(['a','b','c']);
 });
 it('leaves the old preferences intact on failed migration and retries safely',async()=>{
  const storage=disk(),preferences={journeyGrouping:JSON.stringify(grouping())},savePreferences=patch=>Object.assign(preferences,patch);
  storage.fail=true;
  const sync=createJourneySync({owner:OWNER,preferences,savePreferences,storage});
  await expect(sync.ready()).rejects.toThrow('Disk full');expect(preferences.journeyGrouping).not.toBeNull();
  storage.fail=false;await sync.ready();expect(sync.read().metadata.titles.a).toBe('Morning drive');expect(preferences.journeyGrouping).not.toBeNull();
  const cloud=fakeCloud();await runJourneySync({client:cloud.client,owner:OWNER,...sync});
  expect(preferences.journeyGrouping).toBeNull();
 });
 it('refuses to erase a corrupt pending queue',async()=>{
  const storage=disk(),preferences={journeyMetadataQueue:'not JSON'},saves=[];
  const sync=createJourneySync({owner:OWNER,preferences,savePreferences:patch=>saves.push(patch),storage});
  await expect(sync.ready()).rejects.toThrow('could not be read');expect(saves).toEqual([]);expect(storage.rows).toEqual({});
 });
});

it('preserves malformed legacy fields instead of migrating a truncated projection',async()=>{
 const storage=disk(),original={...grouping(),titles:{a:'x'.repeat(151)}},preferences={journeyGrouping:JSON.stringify(original)};
 const sync=createJourneySync({owner:OWNER,preferences,savePreferences:patch=>Object.assign(preferences,patch),storage});await sync.ready();
 const cloud=fakeCloud();expect((await runJourneySync({client:cloud.client,owner:OWNER,...sync})).state).toBe('offline');
 expect(sync.read().metadata.titles.a).toHaveLength(151);expect(cloud.state.requests).toEqual([]);
 const restarted=createJourneySync({owner:OWNER,preferences,savePreferences:()=>{},storage});await restarted.ready();
 expect(restarted.read().metadata.titles.a).toHaveLength(151);
});

it('does not mark migration complete when the legacy backup cannot be checked',async()=>{
 const cloud=fakeCloud(),h=harness({metadata:emptyGrouping(OWNER)});
 const client={...cloud.client,from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({error:{message:'network failed'}})})})})};
 expect((await runJourneySync({client,owner:OWNER,...h})).state).toBe('offline');
 expect(h.store.status.migratedAt).toBeNull();expect(cloud.state.requests).toEqual([SNAPSHOT_FUNCTION]);
 expect((await runJourneySync({client:cloud.client,owner:OWNER,...h})).state).toBe('active');
});

it('adopts the existing account cutoff instead of stalling on a new device provisional cutoff',async()=>{
 const cloud=fakeCloud({metadata:grouping(),revision:5});
 const local={...emptyGrouping(OWNER),enrichFrom:1800000000000};
 const h=harness({metadata:local,queue:{enrichFrom:1800000000000}});
 expect((await runJourneySync({client:cloud.client,owner:OWNER,...h})).state).toBe('active');
 expect(h.store.metadata.enrichFrom).toBe(1699999999000);expect(h.store.queue).toEqual({});
});

it('retains an edit committed while migration is finishing its durable write',async()=>{
 const cloud=fakeCloud(),h=harness({metadata:grouping()});
 const write=async patch=>{
  if(typeof patch==='function'){
   const next={...h.store.metadata,titles:{a:'Edited during migration'}};
   h.store.queue=groupingChanges(h.store.metadata,next);h.store.metadata=next;
  }
  h.write(patch);
 };
 expect((await runJourneySync({client:cloud.client,owner:OWNER,read:h.read,write})).state).toBe('active');
 expect(h.store.metadata.titles.a).toBe('Edited during migration');expect(h.store.queue.activities[0].title).toBe('Edited during migration');
 expect(cloud.state.metadata.titles.a).toBe('Morning drive');
 expect((await runJourneySync({client:cloud.client,owner:OWNER,...h})).state).toBe('active');
 expect(cloud.state.metadata.titles.a).toBe('Edited during migration');
});
