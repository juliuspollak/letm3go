import {renderHook,waitFor,cleanup,act} from '@testing-library/react';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const mock=vi.hoisted(()=>({lookup:vi.fn()}));
vi.mock('./recorder.js',()=>({recorderAvailable:()=>true,recorder:{recogniseTripPlace:mock.lookup}}));
import {useJourneyGrouping} from './useJourneyGrouping.js';
import {emptyGrouping,placeKey} from './journeyGrouping.js';
const trip={id:'a',ownerID:'owner',activity:'Walking',state:'finished',source:'device',endedAt:200,startedAt:100,points:[{latitude:1,longitude:2,timestamp:100,accuracy:5}],tags:[]};
const props=()=>({owner:'owner',activities:[trip],places:[],vehicles:[],serialized:JSON.stringify(emptyGrouping('owner')),savePreferences:vi.fn().mockResolvedValue()});
beforeEach(()=>{mock.lookup.mockReset();});afterEach(()=>{cleanup();});
it('enriches only completed recordings belonging to this account',async()=>{
 mock.lookup.mockResolvedValue({candidates:[],source:'apple-geocoder-mapkit'});
 const p=props();p.activities=[trip,{...trip,id:'foreign',ownerID:'other'},{...trip,id:'active',state:'recording',endedAt:null}];
 renderHook(()=>useJourneyGrouping(p));
 await waitFor(()=>expect(p.savePreferences).toHaveBeenCalledTimes(1));
 expect(mock.lookup).toHaveBeenCalledTimes(1);expect(mock.lookup.mock.calls[0][0]).toBe('a');
 const saved=JSON.parse(p.savePreferences.mock.calls[0][0].journeyGrouping);
 expect(saved.owner).toBe('owner');expect(saved.places[placeKey(trip.points[0])].expiresAt).toBeGreaterThan(Date.now());
});
it('discards a late provider result after an account change',async()=>{
 let finish;mock.lookup.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const p=props();const {rerender}=renderHook(p=>useJourneyGrouping(p),{initialProps:p});
 await waitFor(()=>expect(mock.lookup).toHaveBeenCalledTimes(1));
 rerender({...p,owner:'other',activities:[],serialized:JSON.stringify(emptyGrouping('other'))});
 await act(async()=>finish({candidates:[],source:'apple-geocoder-mapkit'}));
 expect(p.savePreferences).not.toHaveBeenCalled();
});
it('retains prior recognition when an expired lookup fails offline',async()=>{
 const p=props(),meta=emptyGrouping('owner'),key=placeKey(trip.points[0]);
 meta.places[key]={candidates:[{name:'Previously recognised park',placeID:'apple:park'}],expiresAt:1,lookupVersion:2};p.serialized=JSON.stringify(meta);
 mock.lookup.mockRejectedValue(new Error('offline'));
 renderHook(()=>useJourneyGrouping(p));
 await waitFor(()=>expect(p.savePreferences).toHaveBeenCalledTimes(1));
 const saved=JSON.parse(p.savePreferences.mock.calls[0][0].journeyGrouping);
 expect(saved.places[key].candidates).toEqual(meta.places[key].candidates);
 expect(saved.places[key].retryAfter).toBeGreaterThan(Date.now());
});


it('enriches the native stop before generic route samples and upgrades a route-only cache',async()=>{
 const home={latitude:-34.545,longitude:150.865,timestamp:10000,accuracy:5,segment:0};
 const shop={latitude:-34.55,longitude:150.87,timestamp:10600,accuracy:5,segment:0};
 const t={id:'shopping',ownerID:'owner',activity:'Driving',recordingMode:'automatic',state:'finished',
  source:'device',startedAt:10000,endedAt:12000,points:[home,shop,{...shop,timestamp:11291,segment:1},{...home,timestamp:12000,segment:1}],
  details:{stops:[{start:10600,end:11291,verdict:'ambiguous'}]}};
 const p=props(),meta=emptyGrouping('owner'),key=placeKey(shop);
 meta.places[key]={source:'apple-geocoder-mapkit',lookupVersion:2,expiresAt:Date.now()+86400000,candidates:[]};
 p.activities=[t];p.serialized=JSON.stringify(meta);
 mock.lookup.mockResolvedValue({source:'apple-geocoder-mapkit',candidates:[{
  name:'Warilla Grove',category:'shoppingCentre',latitude:shop.latitude+.0003,longitude:shop.longitude
 }]});
 renderHook(()=>useJourneyGrouping(p));
 await waitFor(()=>expect(mock.lookup).toHaveBeenCalled());
 expect(mock.lookup.mock.calls[0]).toEqual(['shopping',1,null,true]);
 await waitFor(()=>expect(p.savePreferences).toHaveBeenCalled());
 const cached=JSON.parse(p.savePreferences.mock.calls[0][0].journeyGrouping).places[key];
 expect(cached.stopLookup).toBe(2);
 expect(cached.candidates[0].name).toBe('Warilla Grove');
});
