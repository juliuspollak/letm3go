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
