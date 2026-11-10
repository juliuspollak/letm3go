import {renderHook,waitFor,cleanup,act} from '@testing-library/react';
import {useSyncExternalStore} from 'react';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const mock=vi.hoisted(()=>({lookup:vi.fn(),road:vi.fn(),supabase:{rpc:(...args)=>mock.rpc(...args)},rpc:null}));
vi.mock('./recorder.js',()=>({recorderAvailable:()=>true,recorder:{recogniseTripPlace:mock.lookup,roadRoute:mock.road}}));
vi.mock('./supabase.js',()=>({supabase:mock.supabase}));
import {useJourneyGrouping} from './useJourneyGrouping.js';
import {placeKey} from './journeyGrouping.js';
import {createJourneySync,APPLY_FUNCTION,OFFLINE_MESSAGE} from './journeyMetadataStore.js';
import {fakeSupabase,memoryStorage} from '../test/journeyServer.js';
// Journey metadata lives in Supabase: the hook reads its cache and every change, from a
// person's edit to a place the device has just recognised, is written to Supabase first.
const trip={id:'a',ownerID:'owner',activity:'Walking',state:'finished',source:'device',endedAt:200,startedAt:100,points:[{latitude:1,longitude:2,timestamp:100,accuracy:5}],tags:[]};
let online=true;
const applies=server=>server.calls.filter(([name])=>name===APPLY_FUNCTION).map(([,args])=>args.p_changes);
// `cache` is what the device already holds (as after a refresh) before the screen mounts.
async function setup({enrichFrom=0,storage=memoryStorage(),server=null,cache=null,...overrides}={}){
 const backend=server?{rpc:server.rpc,server:server.server}:fakeSupabase();
 if(enrichFrom!==null)backend.server.metadata.enrichFrom=enrichFrom;
 mock.rpc=backend.rpc;
 const sync=createJourneySync({owner:'owner',preferences:{},savePreferences:async()=>{},storage});
 await sync.ready();
 // The device's cache already holds the account's cutoff, as after a normal refresh.
 if(enrichFrom!==null||cache)await sync.write(latest=>({metadata:{...latest.metadata,...(enrichFrom!==null?{enrichFrom}:{}),...(cache?.metadata||{})},cache:{...latest.cache,...(cache?.cache||{})}}));
 const props={owner:'owner',activities:[trip],places:[],vehicles:[],sync,...overrides};
 const view=renderHook(current=>{useSyncExternalStore(sync.subscribe,sync.getSnapshot);return useJourneyGrouping({...current,metadataValue:sync.read().metadata});},{initialProps:props});
 return {...backend,sync,props,view,storage};
}
beforeEach(()=>{mock.lookup.mockReset();mock.road.mockReset();online=true;vi.spyOn(navigator,'onLine','get').mockImplementation(()=>online);});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});

it('enriches only completed recordings belonging to this account, saving each answer to Supabase',async()=>{
 mock.lookup.mockResolvedValue({candidates:[],source:'apple-geocoder-mapkit'});
 const {server}=await setup({activities:[trip,{...trip,id:'foreign',ownerID:'other'},{...trip,id:'active',state:'recording',endedAt:null}]});
 await waitFor(()=>expect(server.metadata.enriched).toEqual({a:expect.any(Number)}));
 expect(mock.lookup).toHaveBeenCalledTimes(1);expect(mock.lookup.mock.calls[0][0]).toBe('a');
 expect(server.metadata.places[placeKey(trip.points[0])]).not.toHaveProperty('expiresAt');
 // Standalone answers (places) go as plain values; the done marker shares a record with the
 // title and tags, so it is written against Supabase's current revision.
 const writes=server.calls.filter(([name])=>name===APPLY_FUNCTION).map(([,args])=>args);
 expect(writes.filter(args=>!args.p_changes.activities).every(args=>args.p_expected_revision===null)).toBe(true);
 expect(writes.filter(args=>args.p_changes.activities).every(args=>args.p_expected_revision!==null)).toBe(true);
});
it('discards a late provider result after an account change',async()=>{
 let finish;mock.lookup.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const {server,view,props}=await setup();
 await waitFor(()=>expect(mock.lookup).toHaveBeenCalledTimes(1));
 view.rerender({...props,owner:'other',activities:[]});
 await act(async()=>finish({candidates:[],source:'apple-geocoder-mapkit'}));
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,50));});
 expect(applies(server)).toEqual([]);
});
it('never looks up an answered place again, however old, and marks the activity done',async()=>{
 const key=placeKey(trip.points[0]),saved={candidates:[{name:'Previously recognised park',placeID:'apple:park'}],expiresAt:1,lookupVersion:1};
 const backend=fakeSupabase();backend.server.metadata.places[key]=saved;
 const {server}=await setup({server:backend,cache:{metadata:{places:{[key]:saved}}}});
 await waitFor(()=>expect(server.metadata.enriched).toEqual({a:expect.any(Number)}));
 expect(mock.lookup).not.toHaveBeenCalled();expect(server.metadata.places[key]).toEqual(saved);
});
it('a done activity is not read again: no lookups, no requests',async()=>{
 const backend=fakeSupabase();backend.server.metadata.enriched={a:1};
 const {server}=await setup({server:backend,cache:{metadata:{enriched:{a:1}}}});
 await new Promise(resolve=>setTimeout(resolve,300));
 expect(mock.lookup).not.toHaveBeenCalled();expect(applies(server)).toEqual([]);
});
it('offline provider failure: the place is retried later and the activity is not marked done until it is answered',async()=>{
 mock.lookup.mockRejectedValue(new Error('offline'));
 const {server}=await setup();
 await waitFor(()=>expect(server.metadata.places[placeKey(trip.points[0])]).toMatchObject({attempts:1,retryAfter:expect.any(Number)}));
 expect(server.metadata.enriched).toEqual({});
});
it('enriches the native stop before generic route samples and upgrades a route-only cache',async()=>{
 const home={latitude:-34.545,longitude:150.865,timestamp:10000,accuracy:5,segment:0};
 const shop={latitude:-34.55,longitude:150.87,timestamp:10600,accuracy:5,segment:0};
 const t={id:'shopping',ownerID:'owner',activity:'Driving',recordingMode:'automatic',state:'finished',
  source:'device',startedAt:10000,endedAt:12000,points:[home,shop,{...shop,timestamp:11291,segment:1},{...home,timestamp:12000,segment:1}],
  details:{stops:[{start:10600,end:11291,verdict:'ambiguous'}]}};
 const key=placeKey(shop),cached={source:'apple-geocoder-mapkit',lookupVersion:2,expiresAt:Date.now()+86400000,candidates:[]};
 const backend=fakeSupabase();backend.server.metadata.places[key]=cached;
 mock.lookup.mockResolvedValue({source:'apple-geocoder-mapkit',candidates:[{name:'Warilla Grove',category:'shoppingCentre',latitude:shop.latitude+.0003,longitude:shop.longitude}]});
 const {server}=await setup({server:backend,activities:[t],cache:{metadata:{places:{[key]:cached}}}});
 await waitFor(()=>expect(mock.lookup).toHaveBeenCalled());
 expect(mock.lookup.mock.calls[0]).toEqual(['shopping',1,null,true]);
 await waitFor(()=>expect(server.metadata.places[key]?.stopLookup).toBe(2),{timeout:6000});
 expect(server.metadata.places[key].candidates[0].name).toBe('Warilla Grove');
});
it('a recording in progress does not restart enrichment on every poll',async()=>{
 mock.lookup.mockImplementation(()=>new Promise(()=>{}));
 const live={...trip,id:'live',state:'recording',endedAt:null,points:[{latitude:5,longitude:5,timestamp:1,accuracy:5}]};
 const {view,props}=await setup({activities:[trip,live]});
 await waitFor(()=>expect(mock.lookup).toHaveBeenCalledTimes(1));
 for(let i=2;i<5;i++)view.rerender({...props,activities:[trip,{...live,points:[...live.points,{latitude:5,longitude:5+i*1e-4,timestamp:i,accuracy:5}]}]});
 await new Promise(resolve=>setTimeout(resolve,100));
 expect(mock.lookup).toHaveBeenCalledTimes(1);
});
it('history is never looked up: the first run only records the cutoff in Supabase',async()=>{
 const {server}=await setup({enrichFrom:null});
 await waitFor(()=>expect(server.metadata.enrichFrom).toBeGreaterThan(Date.now()-5000));
 expect(server.metadata.places).toEqual({});expect(mock.lookup).not.toHaveBeenCalled();
});
it('an activity that finished before the cutoff is history: never looked up',async()=>{
 const {server}=await setup({enrichFrom:trip.endedAt*1000+1});
 await new Promise(resolve=>setTimeout(resolve,300));
 expect(mock.lookup).not.toHaveBeenCalled();expect(applies(server)).toEqual([]);
});

const batchActivities=()=>Array.from({length:8},(_,i)=>({...trip,id:`batch-${i}`,points:[{latitude:1+i*.01,longitude:2,timestamp:100,accuracy:5}]}));
it('offline, answers are retained and no error is shown; they are saved, once, when Supabase is reachable again',async()=>{
 vi.useFakeTimers();online=false;
 mock.lookup.mockResolvedValue({candidates:[],source:'apple-geocoder-mapkit'});
 const {server,view}=await setup({activities:batchActivities()});
 await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
 expect(applies(server)).toEqual([]);
 // No technical notice for being offline: the work is simply waiting.
 expect(view.result.current.error).toBe('');
 const lookups=mock.lookup.mock.calls.length;
 online=true;
 await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});
 for(const activity of batchActivities()){
  expect(server.metadata.places[placeKey(activity.points[0])]).toMatchObject({source:'apple-geocoder-mapkit'});
  expect(server.metadata.enriched[activity.id]).toEqual(expect.any(Number));
 }
 // Retained answers were not looked up a second time.
 expect(mock.lookup).toHaveBeenCalledTimes(Math.max(lookups,8));
 expect(view.result.current.error).toBe('');
 const writes=applies(server).length;
 await act(async()=>{await vi.advanceTimersByTimeAsync(24*3600000);});
 expect(applies(server)).toHaveLength(writes);expect(mock.lookup).toHaveBeenCalledTimes(8);
});
it('keeps unsaved answers when changing activities restarts enrichment',async()=>{
 vi.useFakeTimers();online=false;
 mock.lookup.mockResolvedValue({candidates:[],source:'apple-geocoder-mapkit'});
 const {server,view,props}=await setup({activities:batchActivities()});
 await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
 const next={...trip,id:'new',points:[{latitude:8,longitude:8,timestamp:100,accuracy:5}]};
 view.rerender({...props,activities:[...props.activities,next]});
 online=true;
 await act(async()=>{await vi.advanceTimersByTimeAsync(70000);});
 for(const activity of [...batchActivities(),next]){
  expect(server.metadata.places[placeKey(activity.points[0])]).toBeDefined();
  expect(server.metadata.enriched[activity.id]).toEqual(expect.any(Number));
 }
 expect(mock.lookup).toHaveBeenCalledTimes(9);
});
it('never sends one account’s retained answers to another account',async()=>{
 vi.useFakeTimers();online=false;
 mock.lookup.mockResolvedValue({candidates:[],source:'apple-geocoder-mapkit'});
 const {server,view,props}=await setup({activities:batchActivities()});
 await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
 view.rerender({...props,owner:'other',activities:[]});online=true;
 await act(async()=>{await vi.advanceTimersByTimeAsync(120000);});
 expect(server.calls.filter(([name])=>name===APPLY_FUNCTION).some(([,args])=>args.p_owner==='other')).toBe(false);
});
it('retries the initial cutoff without moving the first-run boundary',async()=>{
 vi.useFakeTimers();const now=Date.now();online=false;
 const {server}=await setup({enrichFrom:null});
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
 expect(applies(server)).toEqual([]);
 online=true;
 await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});
 expect(server.metadata.enrichFrom).toBe(now);expect(mock.lookup).not.toHaveBeenCalled();
});

it('saves a person’s edit to Supabase and only then shows it',async()=>{
 const backend=fakeSupabase({titles:{a:'Old'}});
 backend.server.metadata.enriched={a:1};
 const {server,view}=await setup({server:backend,cache:{metadata:{enriched:{a:1},titles:{a:'Old'}}}});
 let saved;await act(async()=>{saved=await view.result.current.act({type:'rename',anchor:'a',title:'Durable title'});});
 expect(saved).toBe(true);
 expect(server.metadata.titles.a).toBe('Durable title');
 expect(view.result.current.metadata.titles.a).toBe('Durable title');
 expect(applies(server).at(-1).activities[0]).toMatchObject({ref:'a',title:'Durable title'});
});
it('does not claim a save when Supabase refuses it',async()=>{
 const backend=fakeSupabase({fail:{[APPLY_FUNCTION]:()=>({message:'Title is not allowed'})}});
 backend.server.metadata.enriched={a:1};
 const {server,view}=await setup({server:backend,cache:{metadata:{enriched:{a:1}}}});
 let saved;await act(async()=>{saved=await view.result.current.act({type:'rename',anchor:'a',title:'Rejected'});});
 expect(saved).toBe(false);
 expect(view.result.current.error).toBe('Your change was not saved: Title is not allowed');
 expect(server.metadata.titles.a).toBeUndefined();expect(view.result.current.metadata.titles.a).toBeUndefined();
});
it('refuses edits offline with a connection message and queues nothing',async()=>{
 const backend=fakeSupabase();backend.server.metadata.enriched={a:1};
 const {server,view,storage}=await setup({server:backend,cache:{metadata:{enriched:{a:1}}}});
 online=false;
 let saved;await act(async()=>{saved=await view.result.current.act({type:'rename',anchor:'a',title:'Offline edit'});});
 expect(saved).toBe(false);expect(view.result.current.error).toBe(OFFLINE_MESSAGE);
 expect(applies(server)).toEqual([]);
 expect(view.result.current.metadata.titles.a).toBeUndefined();
 expect(Object.keys(storage.rows).some(key=>key.includes('queue'))).toBe(false);
 // Back online, the same edit works: nothing was left half-done.
 online=true;
 await act(async()=>{saved=await view.result.current.act({type:'rename',anchor:'a',title:'Online edit'});});
 expect(saved).toBe(true);expect(server.metadata.titles.a).toBe('Online edit');
});
it('shows tags, titles and types from the cache of Supabase, and a stale cached value never reaches Supabase',async()=>{
 const backend=fakeSupabase({titles:{a:'Supabase title'}});backend.server.metadata.enriched={a:1};
 const {server,view}=await setup({server:backend,cache:{metadata:{enriched:{a:1},titles:{a:'Stale cached title'},manualTags:{a:['stale']}}}});
 let saved;await act(async()=>{saved=await view.result.current.act({type:'manualTags',anchor:'a',tags:['fresh']});});
 expect(saved).toBe(true);
 // The edit was built on what Supabase holds, so the stale title and tag were never written.
 expect(server.metadata.titles.a).toBe('Supabase title');
 expect(server.metadata.manualTags.a).toEqual(['fresh']);
 expect(view.result.current.metadata.titles.a).toBe('Supabase title');
});

it('retains completed enrichment so restarting does not repeat provider work',async()=>{
 mock.lookup.mockResolvedValue({candidates:[{name:'Park',placeID:'apple:park'}],source:'apple-geocoder-mapkit'});
 const storage=memoryStorage(),backend=fakeSupabase();
 const first=await setup({storage,server:backend});
 await waitFor(()=>expect(first.sync.read().metadata.enriched.a).toBeDefined());
 first.view.unmount();const count=mock.lookup.mock.calls.length;
 const restarted=await setup({storage,server:backend,enrichFrom:null});
 await act(async()=>{});
 expect(mock.lookup).toHaveBeenCalledTimes(count);
 expect(restarted.sync.read().metadata.places[placeKey(trip.points[0])]).toBeDefined();
});
it('does no provider work when completed history was evicted, even with no cached enrichment values',async()=>{
 await setup({cache:{cache:{work:{a:{state:'done'}}}}});
 await act(async()=>{});
 expect(mock.lookup).not.toHaveBeenCalled();expect(mock.road).not.toHaveBeenCalled();
});
it('processes a newly finalized recording even when the visible list is on another day',async()=>{
 mock.lookup.mockResolvedValue({candidates:[],source:'apple-geocoder-mapkit'});
 const {sync,server}=await setup({activities:[],processingActivities:[trip]});
 await waitFor(()=>expect(sync.read().cache.work.a.state).toBe('done'));
 expect(mock.lookup).toHaveBeenCalledTimes(1);expect(server.metadata.places[placeKey(trip.points[0])]).toBeDefined();
});
it('the done marker never overwrites a title changed on another phone while the device was enriching',async()=>{
 mock.lookup.mockResolvedValue({candidates:[],source:'apple-geocoder-mapkit'});
 const backend=fakeSupabase({titles:{a:'Renamed elsewhere'}});
 const {server}=await setup({server:backend,cache:{metadata:{titles:{a:'Stale cached title'}}}});
 await waitFor(()=>expect(server.metadata.enriched.a).toEqual(expect.any(Number)));
 expect(server.metadata.titles.a).toBe('Renamed elsewhere');
});
it('saves one activity’s answers together, not one request per lookup',async()=>{
 mock.lookup.mockResolvedValue({candidates:[],source:'apple-geocoder-mapkit'});
 const points=Array.from({length:6},(_,i)=>({latitude:-34+i*0.01,longitude:150,timestamp:100+i*10,accuracy:5}));
 const {server}=await setup({activities:[{...trip,points}]});
 await waitFor(()=>expect(server.metadata.enriched.a).toEqual(expect.any(Number)),{timeout:15000});
 expect(Object.keys(server.metadata.places).length).toBeGreaterThan(2);
 // The places, the summary and the marker went in at most a few requests, not one per place.
 expect(applies(server).length).toBeLessThanOrEqual(3);
},20000);
