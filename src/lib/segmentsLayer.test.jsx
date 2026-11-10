import {act,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('./supabase.js',()=>({supabase:null}));
import {areaAround,effortTime,useSegmentMapLayer} from './segmentsApi.js';
import {withCommunitySegments} from './mapContent.js';
import {localSegmentStates} from './segmentSyncState.js';

beforeEach(()=>vi.useFakeTimers());
afterEach(()=>vi.useRealTimers());
const area={minLat:-34.6,maxLat:-34.5,minLon:150.8,maxLon:150.9};
const settle=async ms=>act(async()=>{vi.advanceTimersByTime(ms);await Promise.resolve();await Promise.resolve();});

it('loads the Map’s Segments layer only while on, only once the area settles, and reuses an area it has seen',async()=>{
 const load=vi.fn(async()=>[{id:'s',name:'S',geometry:[[-34.55,150.85],[-34.56,150.85]]}]);
 const {result,rerender}=renderHook(({on,box})=>useSegmentMapLayer(on,box,load),{initialProps:{on:false,box:area}});
 await settle(1000);expect(load).not.toHaveBeenCalled();expect(result.current.status).toBe('idle');
 rerender({on:true,box:area});expect(result.current.status).toBe('loading');
 await settle(100);rerender({on:true,box:{...area,minLat:-34.61}});await settle(100);
 expect(load).not.toHaveBeenCalled();
 await settle(400);expect(load).toHaveBeenCalledTimes(1);
 expect(result.current).toMatchObject({status:'ready',segments:[{id:'s'}]});
 // Back to the first area: from memory, no request.
 rerender({on:true,box:area});await settle(400);rerender({on:true,box:{...area,minLat:-34.61}});await settle(400);
 expect(load).toHaveBeenCalledTimes(2);
});

it('asks to zoom in instead of loading a huge area',async()=>{
 const load=vi.fn(async()=>[]);
 const {result}=renderHook(()=>useSegmentMapLayer(true,{minLat:-40,maxLat:-30,minLon:140,maxLon:155},load));
 await settle(1000);
 expect(load).not.toHaveBeenCalled();expect(result.current.status).toBe('zoom');
});

it('keeps the last lines while a failed area reports an error',async()=>{
 const load=vi.fn().mockResolvedValueOnce([{id:'s',geometry:[[0,0],[0,1]]}]).mockRejectedValueOnce(new Error('offline'));
 const {result,rerender}=renderHook(({box})=>useSegmentMapLayer(true,box,load),{initialProps:{box:area}});
 await settle(400);
 rerender({box:{...area,minLat:-35}});await settle(400);
 expect(result.current).toMatchObject({status:'error',segments:[{id:'s'}]});
});

it('retries a failed area by itself, and reloads everything after an edit',async()=>{
 const load=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([{id:'s',geometry:[[0,0],[0,1]]}]);
 const {result,rerender}=renderHook(({version})=>useSegmentMapLayer(true,area,load,version),{initialProps:{version:0}});
 await settle(400);expect(result.current.status).toBe('error');
 await settle(10000);await settle(400);
 expect(load).toHaveBeenCalledTimes(2);expect(result.current.status).toBe('ready');
 rerender({version:1});await settle(400);
 expect(load).toHaveBeenCalledTimes(3);
});

it('draws community segments as lines with a tappable pin, capped at what the native map draws',()=>{
 const segments=Array.from({length:70},(_,i)=>({id:`s${i}`,name:`S${i}`,geometry:[[i,0],[i,1]]}));
 const payload=withCommunitySegments({routes:[],pins:[{kind:'start'}],styled:[]},segments);
 expect(payload.styled).toHaveLength(60);
 // Marked so AppleMap updates them in place instead of re-embedding the map on every pan.
 expect(payload.styled.every(line=>line.community===true)).toBe(true);
 const pins=payload.pins.filter(pin=>pin.segmentID);
 expect(pins).toHaveLength(60);
 expect(pins[0]).toMatchObject({kind:'segment',segmentID:'s0',title:'S0',point:[0,0]});
 expect(payload.pins[0]).toEqual({kind:'start'});
 const base={routes:[],pins:[]};
 expect(withCommunitySegments(base,null)).toBe(base);
});

it('describes where each segment made here stands',()=>{
 const trip={id:'t',activity:'Walking',details:{namedSegments:[{id:'a',name:'A',startIndex:1,endIndex:5},{id:'b',name:'B',startIndex:1,endIndex:5}]}};
 const receipts={'mtb-segment:a':{owner:'me',fingerprint:'A|1|5',publicationVersion:1,uploaded:true},'mtb-segment:b':{owner:'me',fingerprint:'B|1|4',uploaded:true}};
 // B was re-sectioned since it was published: waiting again.
 expect(localSegmentStates([trip],receipts,'me').map(r=>[r.id,r.state])).toEqual([['a','published'],['b','pending']]);
 expect(localSegmentStates([{...trip,activity:'Driving'}],receipts,'me')).toEqual([]);
 expect(localSegmentStates([trip],receipts,'someone-else').every(r=>r.state==='pending')).toBe(true);
});

it('formats effort times and areas',()=>{
 expect([59.6,95,3725,null].map(effortTime)).toEqual(['1:00','1:35','1:02:05','—']);
 const box=areaAround({latitude:-34.5,longitude:150.85});
 expect(box.maxLat-box.minLat).toBeCloseTo(0.18,2);
 expect(areaAround(null)).toBeNull();
});
