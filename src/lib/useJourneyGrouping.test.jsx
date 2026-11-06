import {renderHook,waitFor,cleanup,act} from '@testing-library/react';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const mock=vi.hoisted(()=>({lookup:vi.fn()}));
vi.mock('./recorder.js',()=>({recorderAvailable:()=>true,recorder:{recogniseTripPlace:mock.lookup}}));
import {useJourneyGrouping} from './useJourneyGrouping.js';
import {emptyGrouping,placeKey} from './journeyGrouping.js';
const trip={id:'a',ownerID:'owner',activity:'Walking',state:'finished',source:'device',endedAt:200,startedAt:100,points:[{latitude:1,longitude:2,timestamp:100,accuracy:5}],tags:[]};
const props=()=>({owner:'owner',activities:[trip],places:[],vehicles:[],serialized:JSON.stringify({...emptyGrouping('owner'),enrichFrom:0}),savePreferences:vi.fn().mockResolvedValue()});
beforeEach(()=>{mock.lookup.mockReset();});afterEach(()=>{cleanup();vi.useRealTimers();});
it('enriches only completed recordings belonging to this account',async()=>{
 mock.lookup.mockResolvedValue({candidates:[],source:'apple-geocoder-mapkit'});
 const p=props();p.activities=[trip,{...trip,id:'foreign',ownerID:'other'},{...trip,id:'active',state:'recording',endedAt:null}];
 renderHook(()=>useJourneyGrouping(p));
 await waitFor(()=>expect(p.savePreferences).toHaveBeenCalledTimes(1));
 expect(mock.lookup).toHaveBeenCalledTimes(1);expect(mock.lookup.mock.calls[0][0]).toBe('a');
 const saved=JSON.parse(p.savePreferences.mock.calls[0][0].journeyGrouping);
 expect(saved.owner).toBe('owner');expect(saved.places[placeKey(trip.points[0])]).not.toHaveProperty('expiresAt');expect(saved.enriched).toEqual({a:expect.any(Number)});
});
it('discards a late provider result after an account change',async()=>{
 let finish;mock.lookup.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const p=props();const {rerender}=renderHook(p=>useJourneyGrouping(p),{initialProps:p});
 await waitFor(()=>expect(mock.lookup).toHaveBeenCalledTimes(1));
 rerender({...p,owner:'other',activities:[],serialized:JSON.stringify({...emptyGrouping('other'),enrichFrom:0})});
 await act(async()=>finish({candidates:[],source:'apple-geocoder-mapkit'}));
 expect(p.savePreferences).not.toHaveBeenCalled();
});
it('never looks up an answered place again, however old, and marks the activity done',async()=>{
 const p=props(),meta={...emptyGrouping('owner'),enrichFrom:0},key=placeKey(trip.points[0]);
 meta.places[key]={candidates:[{name:'Previously recognised park',placeID:'apple:park'}],expiresAt:1,lookupVersion:1};p.serialized=JSON.stringify(meta);
 renderHook(()=>useJourneyGrouping(p));
 await waitFor(()=>expect(p.savePreferences).toHaveBeenCalledTimes(1));
 expect(mock.lookup).not.toHaveBeenCalled();
 const saved=JSON.parse(p.savePreferences.mock.calls[0][0].journeyGrouping);
 expect(saved.places[key]).toEqual(meta.places[key]);expect(saved.enriched).toEqual({a:expect.any(Number)});
});
it('a done activity is not read again: no lookups, no saves',async()=>{
 const p=props(),meta={...emptyGrouping('owner'),enrichFrom:0};meta.enriched={a:1};p.serialized=JSON.stringify(meta);
 renderHook(()=>useJourneyGrouping(p));
 await new Promise(resolve=>setTimeout(resolve,300));
 expect(mock.lookup).not.toHaveBeenCalled();expect(p.savePreferences).not.toHaveBeenCalled();
});
it('offline: an unanswered place is retried later and the activity is not marked done until it is answered',async()=>{
 const p=props();mock.lookup.mockRejectedValue(new Error('offline'));
 renderHook(()=>useJourneyGrouping(p));
 await waitFor(()=>expect(p.savePreferences).toHaveBeenCalledTimes(1));
 const saved=JSON.parse(p.savePreferences.mock.calls[0][0].journeyGrouping);
 expect(saved.places[placeKey(trip.points[0])]).toMatchObject({attempts:1,retryAfter:expect.any(Number)});
 expect(saved.enriched).toEqual({});
});


it('enriches the native stop before generic route samples and upgrades a route-only cache',async()=>{
 const home={latitude:-34.545,longitude:150.865,timestamp:10000,accuracy:5,segment:0};
 const shop={latitude:-34.55,longitude:150.87,timestamp:10600,accuracy:5,segment:0};
 const t={id:'shopping',ownerID:'owner',activity:'Driving',recordingMode:'automatic',state:'finished',
  source:'device',startedAt:10000,endedAt:12000,points:[home,shop,{...shop,timestamp:11291,segment:1},{...home,timestamp:12000,segment:1}],
  details:{stops:[{start:10600,end:11291,verdict:'ambiguous'}]}};
 const p=props(),meta={...emptyGrouping('owner'),enrichFrom:0},key=placeKey(shop);
 meta.places[key]={source:'apple-geocoder-mapkit',lookupVersion:2,expiresAt:Date.now()+86400000,candidates:[]};
 p.activities=[t];p.serialized=JSON.stringify(meta);
 mock.lookup.mockResolvedValue({source:'apple-geocoder-mapkit',candidates:[{
  name:'Warilla Grove',category:'shoppingCentre',latitude:shop.latitude+.0003,longitude:shop.longitude
 }]});
 renderHook(()=>useJourneyGrouping(p));
 await waitFor(()=>expect(mock.lookup).toHaveBeenCalled());
 expect(mock.lookup.mock.calls[0]).toEqual(['shopping',1,null,true]);
 await waitFor(()=>expect(p.savePreferences).toHaveBeenCalled(),{timeout:6000});
 const cached=JSON.parse(p.savePreferences.mock.calls[0][0].journeyGrouping).places[key];
 expect(cached.stopLookup).toBe(2);
 expect(cached.candidates[0].name).toBe('Warilla Grove');
});

it('saves enrichment in batches, not once per lookup',async()=>{
 // Ten uncached places: a save every 8 results and one for the rest.
 const points=Array.from({length:10},(_,i)=>({latitude:-34+i*0.01,longitude:150,timestamp:100+i,accuracy:5}));
 const p=props();p.activities=Array.from({length:10},(_,i)=>({...trip,id:`w${i}`,points:[points[i]]}));
 mock.lookup.mockResolvedValue({candidates:[],source:'apple-geocoder-mapkit'});
 renderHook(()=>useJourneyGrouping(p));
 await waitFor(()=>expect(p.savePreferences).toHaveBeenCalledTimes(2),{timeout:20000});
 expect(mock.lookup).toHaveBeenCalledTimes(10);
 expect(Object.keys(JSON.parse(p.savePreferences.mock.calls[1][0].journeyGrouping).places)).toHaveLength(10);
},25000);
it('a recording in progress does not restart enrichment on every poll',async()=>{
 mock.lookup.mockImplementation(()=>new Promise(()=>{}));
 const live={...trip,id:'live',state:'recording',endedAt:null,points:[{latitude:5,longitude:5,timestamp:1,accuracy:5}]};
 const p=props();p.activities=[trip,live];
 const {rerender}=renderHook(props=>useJourneyGrouping(props),{initialProps:p});
 await waitFor(()=>expect(mock.lookup).toHaveBeenCalledTimes(1));
 for(let i=2;i<5;i++)rerender({...p,activities:[trip,{...live,points:[...live.points,{latitude:5,longitude:5+i*1e-4,timestamp:i,accuracy:5}]}]});
 await new Promise(resolve=>setTimeout(resolve,100));
 expect(mock.lookup).toHaveBeenCalledTimes(1);
});
it('history is never looked up: the first run only records the cutoff',async()=>{
 const p=props();p.serialized=JSON.stringify(emptyGrouping('owner'));
 renderHook(()=>useJourneyGrouping(p));
 await waitFor(()=>expect(p.savePreferences).toHaveBeenCalledTimes(1));
 const saved=JSON.parse(p.savePreferences.mock.calls[0][0].journeyGrouping);
 expect(saved.enrichFrom).toBeGreaterThan(Date.now()-5000);
 expect(saved.places).toEqual({});
 expect(mock.lookup).not.toHaveBeenCalled();
});
it('an activity that finished before the cutoff is history: never looked up',async()=>{
 const p=props();p.serialized=JSON.stringify({...emptyGrouping('owner'),enrichFrom:trip.endedAt*1000+1});
 renderHook(()=>useJourneyGrouping(p));
 await new Promise(resolve=>setTimeout(resolve,300));
 expect(mock.lookup).not.toHaveBeenCalled();expect(p.savePreferences).not.toHaveBeenCalled();
});
it('never writes over saved metadata it cannot read as this account\'s',async()=>{
 const p=props();p.serialized=JSON.stringify({...emptyGrouping('someone-else'),titles:{a:'Mine'}});
 renderHook(()=>useJourneyGrouping(p));
 await new Promise(resolve=>setTimeout(resolve,300));
 expect(p.savePreferences).not.toHaveBeenCalled();expect(mock.lookup).not.toHaveBeenCalled();
});

it('does not overwrite same-owner metadata rejected by the reader, including manual actions',async()=>{
 const p=props();p.serialized=JSON.stringify({version:1,owner:'owner',titles:{a:'Keep this'},places:{saved:{name:'Keep place'}}});
 const {result}=renderHook(()=>useJourneyGrouping(p));
 await act(async()=>{});
 expect(p.savePreferences).not.toHaveBeenCalled();expect(mock.lookup).not.toHaveBeenCalled();
 expect(result.current.error).toMatch(/left unchanged/);
 let saved;await act(async()=>{saved=await result.current.act({type:'rename',id:'a',title:'New'});});
 expect(saved).toBe(false);expect(p.savePreferences).not.toHaveBeenCalled();
});

const batchActivities=()=>Array.from({length:8},(_,i)=>({...trip,id:`batch-${i}`,points:[{latitude:1+i*.01,longitude:2,timestamp:100,accuracy:5}]}));
it('retains a failed boundary batch, retries storage without provider repeats, and only then finishes activities',async()=>{
 vi.useFakeTimers();mock.lookup.mockResolvedValue({candidates:[],source:'apple-geocoder-mapkit'});
 const p=props();p.activities=batchActivities();p.savePreferences.mockRejectedValueOnce(new Error('disk unavailable'));
 const {result}=renderHook(()=>useJourneyGrouping(p));
 await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
 expect(p.savePreferences).toHaveBeenCalledTimes(1);
 expect(result.current.error).toMatch(/could not be saved/);
 await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});
 const saved=JSON.parse(p.savePreferences.mock.lastCall[0].journeyGrouping);
 for(const activity of p.activities){
  expect(saved.places[placeKey(activity.points[0])]).toMatchObject({source:'apple-geocoder-mapkit'});
  expect(saved.enriched[activity.id]).toEqual(expect.any(Number));
 }
 expect(result.current.error).toBe('');expect(mock.lookup).toHaveBeenCalledTimes(8);
 const writes=p.savePreferences.mock.calls.length;
 await act(async()=>{await vi.advanceTimersByTimeAsync(24*3600000);});
 expect(p.savePreferences).toHaveBeenCalledTimes(writes);expect(mock.lookup).toHaveBeenCalledTimes(8);
});
it('keeps unsaved answers when changing activities restarts enrichment',async()=>{
 vi.useFakeTimers();mock.lookup.mockResolvedValue({candidates:[],source:'apple-geocoder-mapkit'});
 const p=props();p.activities=batchActivities();p.savePreferences.mockRejectedValueOnce(new Error('disk unavailable'));
 const view=renderHook(props=>useJourneyGrouping(props),{initialProps:p});
 await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
 const next={...trip,id:'new',points:[{latitude:8,longitude:8,timestamp:100,accuracy:5}]};
 view.rerender({...p,activities:[...p.activities,next]});
 await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
 const saved=JSON.parse(p.savePreferences.mock.lastCall[0].journeyGrouping);
 for(const activity of [...p.activities,next]){
  expect(saved.places[placeKey(activity.points[0])]).toBeDefined();
  expect(saved.enriched[activity.id]).toEqual(expect.any(Number));
 }
 expect(mock.lookup).toHaveBeenCalledTimes(9);
});
it('does not flush retained answers into a different account',async()=>{
 vi.useFakeTimers();mock.lookup.mockResolvedValue({candidates:[],source:'apple-geocoder-mapkit'});
 const p=props();p.activities=batchActivities();p.savePreferences.mockRejectedValueOnce(new Error('disk unavailable'));
 const view=renderHook(props=>useJourneyGrouping(props),{initialProps:p});
 await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
 view.rerender({...p,owner:'other',activities:[],serialized:JSON.stringify({...emptyGrouping('other'),enrichFrom:0})});
 await act(async()=>{await vi.advanceTimersByTimeAsync(120000);});
 expect(p.savePreferences).toHaveBeenCalledTimes(1);
});
it('retries the initial cutoff write without moving the first-run boundary',async()=>{
 vi.useFakeTimers();const now=Date.now(),p=props();p.serialized=JSON.stringify(emptyGrouping('owner'));
 p.savePreferences.mockRejectedValueOnce(new Error('disk unavailable'));
 const {result}=renderHook(()=>useJourneyGrouping(p));
 await act(async()=>{});
 expect(result.current.error).toMatch(/could not be saved/);
 await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});
 expect(p.savePreferences).toHaveBeenCalledTimes(2);
 expect(JSON.parse(p.savePreferences.mock.lastCall[0].journeyGrouping).enrichFrom).toBe(now);
 expect(result.current.error).toBe('');expect(mock.lookup).not.toHaveBeenCalled();
});

it('also retries failed persistence when a provider retry timer initiated the run',async()=>{
 vi.useFakeTimers();mock.lookup.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({candidates:[],source:'apple-geocoder-mapkit'});
 const p=props();p.savePreferences.mockResolvedValueOnce().mockRejectedValueOnce(new Error('disk unavailable'));
 const {result}=renderHook(()=>useJourneyGrouping(p));
 await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
 expect(p.savePreferences).toHaveBeenCalledTimes(1);
 await act(async()=>{await vi.advanceTimersByTimeAsync(300000);});
 expect(result.current.error).toMatch(/could not be saved/);
 await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});
 const saved=JSON.parse(p.savePreferences.mock.lastCall[0].journeyGrouping);
 expect(saved.enriched.a).toEqual(expect.any(Number));
 expect(saved.places[placeKey(trip.points[0])]).toMatchObject({source:'apple-geocoder-mapkit'});
 expect(mock.lookup).toHaveBeenCalledTimes(2);expect(result.current.error).toBe('');
});
