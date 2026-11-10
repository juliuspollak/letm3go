import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {emptyGrouping} from './journeyGrouping.js';
import {fakeSupabase,memoryStorage} from '../test/journeyServer.js';
import {APPLY_FUNCTION,OFFLINE_MESSAGE,REVISION_FUNCTION,SNAPSHOT_FUNCTION,chunkChanges,commitJourneyChanges,createJourneySync,ensureJourneyScope,journeyRows,refreshJourneyMetadata,stateFromJourneyRows} from './journeyMetadataStore.js';
// Supabase owns journey metadata. The store keeps a read-only cache of it and writes every
// change to Supabase first. A fake Supabase with the real RPC shapes stands in for it.
const owner='owner';
const context=(sync,client)=>({client,owner,read:sync.read,write:sync.write,ready:sync.ready,scope:sync.scope});
const setOnline=value=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>value});
beforeEach(()=>setOnline(true));
afterEach(()=>setOnline(true));

describe('the cache of Supabase metadata',()=>{
 it('starts empty, ignores rows from earlier builds, and clears the old preferences copy once',async()=>{
  const storage=memoryStorage({control:{format:2,status:{owner,migratedAt:1}},'["mirror","titles","a"]':'old local title','["queue","activities","a"]':{ref:'a',title:'old pending edit'}});
  const savePreferences=vi.fn(async()=>{});
  const sync=createJourneySync({owner,preferences:{journeyGrouping:'{}',journeyMetadataQueue:'{}',journeyMetadata:{},syncReceipts:{'mtb-segment:x':{uploaded:true}}},savePreferences,storage});
  await sync.ready();
  expect(sync.read().metadata.titles).toEqual({});
  expect(Object.keys(storage.rows).some(key=>key.includes('queue')||key.includes('old local title'))).toBe(false);
  expect(storage.rows.control.format).toBe(3);
  // Only the three legacy keys are cleared; receipts and every other preference are untouched.
  expect(savePreferences).toHaveBeenCalledTimes(1);
  expect(savePreferences).toHaveBeenCalledWith({journeyGrouping:null,journeyMetadataQueue:null,journeyMetadata:null});
 });
 it('does not touch preferences when there is nothing to clear',async()=>{
  const savePreferences=vi.fn(async()=>{});
  const sync=createJourneySync({owner,preferences:{syncReceipts:{}},savePreferences,storage:memoryStorage()});
  await sync.ready();
  expect(savePreferences).not.toHaveBeenCalled();
 });
 it('survives a restart: cached journeys are readable again without Supabase',async()=>{
  const storage=memoryStorage(),first=createJourneySync({owner,storage});
  await first.ready();
  await first.write(latest=>({metadata:{...latest.metadata,titles:{a:'Cached title'}},activityRows:{a:{id:'a'}},savedPlaces:[{id:'home'}]}));
  const restarted=createJourneySync({owner,storage});
  await restarted.ready();
  expect(restarted.read().metadata.titles).toEqual({a:'Cached title'});
  expect(restarted.read().activityRows.a).toEqual({id:'a'});
  expect(restarted.read().savedPlaces).toEqual([{id:'home'}]);
  expect(stateFromJourneyRows(journeyRows(restarted.read()),'someone-else')).toBeNull();
 });
 it('replaces a stale cached title with Supabase’s value and never competes with it',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  await sync.write(latest=>({metadata:{...latest.metadata,titles:{a:'Stale local title'}}}));
  const {rpc}=fakeSupabase({titles:{a:'Current Supabase title'}});
  await ensureJourneyScope(context(sync,{rpc}),['a'],[],{force:true});
  expect(sync.read().metadata.titles.a).toBe('Current Supabase title');
  expect(rpc.mock.calls.some(([name])=>name===APPLY_FUNCTION)).toBe(false);
 });
});

describe('refreshing from Supabase',()=>{
 it('loads the account state on first run and sets the revision, uploading nothing',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  const {rpc,server}=fakeSupabase({revision:7,savedPlaces:[{id:'place-1'}]});
  server.metadata.enrichFrom=1700000000000;
  const result=await refreshJourneyMetadata(context(sync,{rpc}));
  expect(result.state).toBe('active');
  expect(sync.read().status).toMatchObject({revision:7,cursorRevision:7});
  expect(sync.read().savedPlaces).toEqual([{id:'place-1'}]);
  expect(sync.read().metadata.enrichFrom).toBe(1700000000000);
  expect(rpc.mock.calls.some(([name])=>name===APPLY_FUNCTION)).toBe(false);
 });
 it('on return to the app picks up what changed elsewhere and marks only those scopes stale',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  const {rpc,server}=fakeSupabase({titles:{a:'Before'}});
  sync.configureScope(['a']);
  await refreshJourneyMetadata(context(sync,{rpc}));
  expect(sync.read().metadata.titles.a).toBe('Before');
  server.metadata.titles.a='Renamed on another phone';server.revision=2;
  await refreshJourneyMetadata(context(sync,{rpc}));
  expect(sync.read().metadata.titles.a).toBe('Renamed on another phone');
  expect(sync.read().status.cursorRevision).toBe(2);
 });
 it('does nothing offline and keeps the cache readable',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  await sync.write(latest=>({metadata:{...latest.metadata,titles:{a:'Cached'}}}));
  setOnline(false);
  const {rpc}=fakeSupabase();
  expect(await refreshJourneyMetadata(context(sync,{rpc}))).toEqual({state:'idle'});
  expect(rpc).not.toHaveBeenCalled();
  expect(sync.read().metadata.titles.a).toBe('Cached');
 });
 it('follows an emptied Supabase account by clearing the cache, never by uploading it',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  await sync.write(latest=>({metadata:{...latest.metadata,titles:{a:'Cached'}},status:{...latest.status,revision:5,cursorRevision:5}}));
  const rpc=vi.fn(async name=>name===REVISION_FUNCTION?{data:null,error:null}:{data:null,error:{message:'unexpected'}});
  await refreshJourneyMetadata(context(sync,{rpc}));
  expect(sync.read().metadata.titles).toEqual({});
  expect(rpc.mock.calls.map(([name])=>name)).toEqual([REVISION_FUNCTION]);
 });
 it('a network failure rejects and leaves the cache as it was',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  await sync.write(latest=>({metadata:{...latest.metadata,titles:{a:'Cached'}}}));
  const rpc=vi.fn(async()=>({data:null,error:{message:'Failed to fetch'}}));
  await expect(refreshJourneyMetadata(context(sync,{rpc}))).rejects.toThrow('Failed to fetch');
  expect(sync.read().metadata.titles.a).toBe('Cached');
 });
});

describe('saving a change',()=>{
 const rename=title=>base=>({...base,titles:{...base.titles,a:title}});
 it('writes to Supabase first, then updates the cache with what Supabase confirmed',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  const {rpc,server}=fakeSupabase({titles:{a:'Old'},revision:3});
  await commitJourneyChanges(context(sync,{rpc}),rename('New title'));
  expect(server.metadata.titles.a).toBe('New title');
  expect(sync.read().metadata.titles.a).toBe('New title');
  expect(sync.read().status.revision).toBe(4);
  // The edit read the journey from Supabase at the current revision and wrote against it.
  const apply=rpc.mock.calls.find(([name])=>name===APPLY_FUNCTION)[1];
  expect(apply.p_expected_revision).toBe(3);
  expect(apply.p_changes.activities).toEqual([expect.objectContaining({ref:'a',title:'New title'})]);
 });
 it('builds the change on Supabase’s current value, so stale cached fields are never written back',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  await sync.write(latest=>({metadata:{...latest.metadata,titles:{a:'Stale local title'},manualTags:{a:['stale']}}}));
  const {rpc,server}=fakeSupabase({titles:{a:'Current title'}});
  server.metadata.manualTags={a:['current']};
  await commitJourneyChanges(context(sync,{rpc}),base=>({...base,manualTags:{...base.manualTags,a:[...base.manualTags.a,'added']}}));
  expect(server.metadata.titles.a).toBe('Current title');
  expect(server.metadata.manualTags.a).toEqual(['current','added']);
 });
 it('does not claim a save when Supabase refuses it, and leaves the cache unchanged',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  await sync.write(latest=>({metadata:{...latest.metadata,titles:{a:'Old'}}}));
  const {rpc}=fakeSupabase({titles:{a:'Old'},fail:{[APPLY_FUNCTION]:()=>({message:'Journey title is too long'})}});
  await expect(commitJourneyChanges(context(sync,{rpc}),rename('x'))).rejects.toThrow('Your change was not saved: Journey title is too long');
  expect(sync.read().metadata.titles.a).toBe('Old');
 });
 it('is unavailable offline: a clear message, no request, nothing queued',async()=>{
  const storage=memoryStorage(),sync=createJourneySync({owner,storage});await sync.ready();
  setOnline(false);
  const {rpc}=fakeSupabase();
  await expect(commitJourneyChanges(context(sync,{rpc}),rename('Offline edit'))).rejects.toThrow(OFFLINE_MESSAGE);
  expect(rpc).not.toHaveBeenCalled();
  expect(sync.read().metadata.titles).toEqual({});
  expect(Object.keys(storage.rows).some(key=>key.includes('queue'))).toBe(false);
 });
 it('turns a dropped connection into the same message instead of a technical error',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  const {rpc}=fakeSupabase({fail:{[APPLY_FUNCTION]:()=>({message:'TypeError: Failed to fetch'})}});
  await expect(commitJourneyChanges(context(sync,{rpc}),rename('x'))).rejects.toThrow(OFFLINE_MESSAGE);
  expect(sync.read().metadata.titles).toEqual({});
 });
 it('retries once when another device saved first, on Supabase’s newer state',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  let raced=false;
  const {rpc,server}=fakeSupabase({titles:{a:'Old'},revision:1,fail:{[APPLY_FUNCTION]:srv=>{if(!raced){raced=true;srv.metadata.manualTags={a:['from-phone-b']};srv.revision=2;}return null;}}});
  await commitJourneyChanges(context(sync,{rpc}),rename('Renamed'));
  expect(server.metadata.titles.a).toBe('Renamed');
  expect(server.metadata.manualTags.a).toEqual(['from-phone-b']);
  expect(rpc.mock.calls.filter(([name])=>name===APPLY_FUNCTION)).toHaveLength(2);
 });
 it('gives up with a plain message after a second conflict',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  const {rpc}=fakeSupabase({fail:{[APPLY_FUNCTION]:()=>({message:'changed on another device (conflict)'})}});
  await expect(commitJourneyChanges(context(sync,{rpc}),rename('x'))).rejects.toThrow('This journey was changed on another device. Try again.');
 });
 it('sends standalone device answers (places, roads, summaries) as plain values with no revision or journey fetch',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  const {rpc,server}=fakeSupabase({revision:9});
  await commitJourneyChanges(context(sync,{rpc}),base=>({...base,places:{...base.places,'1,2':{name:'Cafe'}},roads:{...base.roads,'a:1:2':{status:'route'}}}),{derived:true});
  expect(server.metadata.places['1,2']).toEqual({name:'Cafe'});
  expect(sync.read().metadata.places['1,2']).toEqual({name:'Cafe'});
  expect(rpc.mock.calls.filter(([name])=>name===SNAPSHOT_FUNCTION)).toHaveLength(0);
  expect(rpc.mock.calls.find(([name])=>name===APPLY_FUNCTION)[1].p_expected_revision).toBeNull();
 });
 it('writes the done marker on Supabase’s current copy, so a stale cached title or tag is never written back',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  await sync.write(latest=>({metadata:{...latest.metadata,titles:{a:'Stale cached title'},manualTags:{a:['stale']}}}));
  const {rpc,server}=fakeSupabase({titles:{a:'Renamed on another phone'},revision:4});
  server.metadata.manualTags={a:['from-phone-b']};
  await commitJourneyChanges(context(sync,{rpc}),base=>({...base,enriched:{...base.enriched,a:1700000000000}}),{derived:true});
  expect(server.metadata.titles.a).toBe('Renamed on another phone');
  expect(server.metadata.manualTags.a).toEqual(['from-phone-b']);
  expect(server.metadata.enriched.a).toBe(1700000000000);
  expect(rpc.mock.calls.find(([name])=>name===APPLY_FUNCTION)[1].p_expected_revision).toBe(4);
 });
 it('applies the confirmed change on top of the cache as it is now, and keeps the cache current after its own write',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  const {rpc}=fakeSupabase({titles:{a:'Old'},revision:3});
  await refreshJourneyMetadata(context(sync,{rpc}));
  // Another scope arrives from a refresh while the save is in flight.
  const slow=vi.fn(async(name,args)=>{
   const answer=await rpc(name,args);
   if(name===APPLY_FUNCTION)await sync.write(latest=>({metadata:{...latest.metadata,titles:{...latest.metadata.titles,other:'Loaded meanwhile'}}}));
   return answer;
  });
  await commitJourneyChanges(context(sync,{rpc:slow}),rename('New title'));
  expect(sync.read().metadata.titles).toMatchObject({a:'New title',other:'Loaded meanwhile'});
  // The cache was current before the write, so its own write does not look like a foreign change.
  expect(sync.read().status).toMatchObject({revision:4,cursorRevision:4});
 });
 it('an account with no journey records is looked at once, not on every refresh',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  const rpc=vi.fn(async(name,args)=>name===REVISION_FUNCTION?{data:null,error:null}:{data:{...emptyGrouping(owner),scope:args.p_refs,complete:true,details:[],activityRows:[],savedPlaces:[],unavailableRefs:[],revision:null},error:null});
  await refreshJourneyMetadata(context(sync,{rpc}));
  rpc.mockClear();
  await refreshJourneyMetadata(context(sync,{rpc}));
  expect(rpc.mock.calls.map(([name])=>name)).toEqual([REVISION_FUNCTION]);
 });
 it('a malformed revision answer is an error, never mistaken for an emptied account',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  await sync.write(latest=>({metadata:{...latest.metadata,titles:{a:'Cached'}},status:{...latest.status,revision:5,cursorRevision:5}}));
  const rpc=vi.fn(async()=>({data:undefined,error:null}));
  await expect(refreshJourneyMetadata(context(sync,{rpc}))).rejects.toThrow('revision could not be read');
  expect(sync.read().metadata.titles.a).toBe('Cached');
 });
 it('sends nothing when nothing changed',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  const {rpc}=fakeSupabase();
  expect(await commitJourneyChanges(context(sync,{rpc}),base=>base)).toEqual({changed:false});
  expect(rpc).not.toHaveBeenCalled();
 });
 it('splits a large batch into bounded requests',()=>{
  const activities=Array.from({length:450},(_,i)=>({ref:`a${i}`,title:`t${i}`}));
  const chunks=chunkChanges({activities,enrichFrom:5});
  expect(chunks.map(chunk=>chunk.activities.length)).toEqual([200,200,50]);
  expect(chunks[0].enrichFrom).toBe(5);
 });
});

describe('review follow-ups',()=>{
 it('adopts the cutoff Supabase kept when another device had already set one',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  const {rpc,server}=fakeSupabase();server.metadata.enrichFrom=1000;
  const keep=rpc.getMockImplementation();
  rpc.mockImplementation(async(name,args)=>{const answer=await keep(name,args);if(name===APPLY_FUNCTION)server.metadata.enrichFrom=1000;return answer;});
  await commitJourneyChanges(context(sync,{rpc}),base=>({...base,enrichFrom:9999}),{derived:true});
  expect(sync.read().metadata.enrichFrom).toBe(1000);
 });
 it('keeps saved places when the cache follows an emptied account',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  await sync.write(latest=>({savedPlaces:[{id:'home'}],status:{...latest.status,revision:5,cursorRevision:5}}));
  const rpc=vi.fn(async name=>name===REVISION_FUNCTION?{data:null,error:null}:{data:null,error:{message:'unexpected'}});
  await refreshJourneyMetadata(context(sync,{rpc}));
  expect(sync.read().savedPlaces).toEqual([{id:'home'}]);
 });
 it('does not mistake an unrelated server error for a conflict or for being offline',async()=>{
  const sync=createJourneySync({owner,storage:memoryStorage()});await sync.ready();
  const {rpc}=fakeSupabase({fail:{[APPLY_FUNCTION]:()=>({message:'conflicting key value violates exclusion constraint on connection pool'})}});
  await expect(commitJourneyChanges(context(sync,{rpc}),base=>({...base,titles:{a:'x'}}))).rejects.toThrow('Your change was not saved: conflicting key value');
  expect(rpc.mock.calls.filter(([name])=>name===APPLY_FUNCTION)).toHaveLength(1);
 });
 it('does not wait for the old preferences cleanup before becoming ready',async()=>{
  const sync=createJourneySync({owner,preferences:{journeyGrouping:'{}'},savePreferences:()=>new Promise(()=>{}),storage:memoryStorage()});
  await expect(sync.ready()).resolves.toBeDefined();
 });
});
