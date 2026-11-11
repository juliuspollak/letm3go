import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({road:vi.fn(),rpc:vi.fn(),available:true}));
vi.mock('./supabase.js',()=>({supabase:{rpc:mock.rpc}}));
vi.mock('./recorder.js',()=>({recorder:{roadRoute:mock.road},recorderAvailable:()=>mock.available}));
import {useLiveRoads} from './useLiveRoads.js';
import {forgetLiveRoads} from './liveRoads.js';

const p=(lat,lon,t,segment)=>({latitude:lat,longitude:lon,timestamp:t,segment});
// The shape of state.automaticTrip: the recorder's in-progress activity.
const trip=(extra=[])=>({id:'TRIP-9',source:'device',state:'recording',recordingMode:'automatic',activity:'Driving',endedAt:null,
 points:[p(-34.50,150.80,1000,0),p(-34.51,150.80,1010,0),p(-34.55,150.84,1370,1),p(-34.56,150.84,1380,1),...extra]});
const road={routes:[{distanceMeters:6500,expectedSeconds:420,points:[[-34.52,150.81],[-34.54,150.83]]}]};
let hidden=false;
beforeEach(()=>{
 forgetLiveRoads();mock.available=true;hidden=false;
 mock.road.mockReset().mockResolvedValue(road);mock.rpc.mockReset().mockResolvedValue({data:true,error:null});
 Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});
});
afterEach(cleanup);

it('rebuilds a closed gap of the drive in progress once and publishes it to the live trail',async()=>{
 const {rerender}=renderHook(props=>useLiveRoads(props),{initialProps:{trip:trip(),owner:'me',enabled:true}});
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('put_my_live_road',expect.objectContaining({p_ref:'TRIP-9'})));
 rerender({trip:trip([p(-34.57,150.85,1390,1)]),owner:'me',enabled:true});   // more points, no new gap
 await act(async()=>{await new Promise(r=>setTimeout(r,50));});
 expect(mock.road).toHaveBeenCalledTimes(1);expect(mock.rpc).toHaveBeenCalledTimes(1);
});
it('ignores a drive that is not an automatic recording in progress',async()=>{
 for(const t of [{...trip(),recordingMode:'manual'},{...trip(),state:'finished'},{...trip(),activity:'Walking'},{...trip(),source:'tesla'},null]){
  renderHook(()=>useLiveRoads({trip:t,owner:'me',enabled:true}));
 }
 await act(async()=>{await new Promise(r=>setTimeout(r,50));});
 expect(mock.road).not.toHaveBeenCalled();
});
it('does not ask Apple Maps while the app is in the background, and catches up on return',async()=>{
 hidden=true;
 renderHook(()=>useLiveRoads({trip:trip(),owner:'me',enabled:true}));
 await act(async()=>{await new Promise(r=>setTimeout(r,50));});
 expect(mock.road).not.toHaveBeenCalled();
 hidden=false;
 await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
 await waitFor(()=>expect(mock.road).toHaveBeenCalledTimes(1));
});
it('publishes the roads again after live sharing was switched off and on, because the server dropped them',async()=>{
 const {rerender}=renderHook(props=>useLiveRoads(props),{initialProps:{trip:trip(),owner:'me',enabled:true}});
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledTimes(1));
 rerender({trip:trip(),owner:'me',enabled:false});
 rerender({trip:trip(),owner:'me',enabled:true});
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledTimes(2));
 expect(mock.road).toHaveBeenCalledTimes(1);                       // Apple Maps is not asked again
});
it('does nothing off the phone or when signed out',async()=>{
 mock.available=false;
 renderHook(()=>useLiveRoads({trip:trip(),owner:'me',enabled:true}));
 renderHook(()=>useLiveRoads({trip:trip(),owner:'me',enabled:false}));
 await act(async()=>{await new Promise(r=>setTimeout(r,50));});
 expect(mock.road).not.toHaveBeenCalled();
});
