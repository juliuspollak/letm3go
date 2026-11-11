import {act,renderHook,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('./supabase.js',()=>({supabase:{rpc:mock.rpc}}));
import {usePersonDay} from './usePersonDay.js';
import {clearPersonDays,mergeRows,cachedDay,storeDay} from './personDayCache.js';
import {dayWindow} from './dayWindow.js';

const Z='Australia/Sydney',DATE='2026-11-10',W=dayWindow(DATE,Z);
const NOW=()=>W.start+40000;
const row=(id,etag,points)=>({activity_id:id,started_at:new Date((W.start+3600)*1000).toISOString(),ended_at:new Date((W.start+4000)*1000).toISOString(),activity:'Driving',title:'Trip '+id,etag,roads:{},
 points:points===undefined?[{latitude:-34.5,longitude:150.9,segment:0,t:W.start+3600},{latitude:-34.6,longitude:150.9,segment:0,t:W.start+3700}]:points});
let dayRows,trail,calls;
beforeEach(()=>{
 clearPersonDays();calls=[];dayRows=[row('a','e1')];trail=null;
 mock.rpc.mockReset();
 mock.rpc.mockImplementation(async(name,params)=>{
  calls.push([name,params]);
  if(name==='my_shared_day')return {data:dayRows.map(r=>(params.p_known||[]).includes(r.etag)?{...r,points:null,roads:null}:r),error:null};
  if(name==='my_live_trail')return {data:trail?[trail]:[],error:null};
  return {data:null,error:null};
 });
});
const render=(over={})=>renderHook(props=>usePersonDay({viewer:'me',owner:'her',date:DATE,timeZone:Z,now:NOW,...props}),{initialProps:over});

it('loads a day, numbers its activity and prefetches the neighbouring days',async()=>{
 const {result}=render();
 await waitFor(()=>expect(result.current.day.activities.length).toBe(1));
 expect(result.current.day.markers[0]).toMatchObject({n:1,activityID:'a'});
 const days=calls.filter(c=>c[0]==='my_shared_day').map(c=>c[1].p_from);
 expect(days.length).toBe(3);
});
it('shows a cached day at once and revalidates by etag without re-downloading geometry',async()=>{
 const first=render();
 await waitFor(()=>expect(first.result.current.day.activities.length).toBe(1));
 first.unmount();calls.length=0;
 const again=render();
 expect(again.result.current.day.activities.length).toBe(1); // before any network answer
 await waitFor(()=>expect(calls.some(c=>c[0]==='my_shared_day'&&c[1].p_known.includes('e1'))).toBe(true));
 await waitFor(()=>expect(again.result.current.loading).toBe(false));
 expect(again.result.current.day.activities.length).toBe(1);
});
it('drops an activity the owner hid or unshared on the next revalidation',async()=>{
 const first=render();
 await waitFor(()=>expect(first.result.current.day.activities.length).toBe(1));
 first.unmount();dayRows=[];
 const again=render();
 await waitFor(()=>expect(again.result.current.day.activities.length).toBe(0));
});
it('never shows one account\'s cached day to another account',async()=>{
 const first=render();
 await waitFor(()=>expect(first.result.current.day.activities.length).toBe(1));
 first.unmount();dayRows=[];
 const other=renderHook(()=>usePersonDay({viewer:'someone-else',owner:'her',date:DATE,timeZone:Z,now:NOW}));
 expect(other.result.current.day.activities.length).toBe(0);
 clearPersonDays('me');expect(cachedDay('me','her',DATE)).toBeNull();
});
it('keeps what it has when a revalidation fails',async()=>{
 const first=render();
 await waitFor(()=>expect(first.result.current.day.activities.length).toBe(1));
 first.unmount();
 mock.rpc.mockImplementation(async()=>({data:null,error:{message:'offline'}}));
 const again=render();
 await waitFor(()=>expect(again.result.current.loading).toBe(false));
 expect(again.result.current.day.activities.length).toBe(1);expect(again.result.current.error).toBe('');
});
it('polls the live trail for today, asks only for newer points and merges late batches',async()=>{
 vi.useFakeTimers({shouldAdvanceTime:true});
 const t=W.start+39000;
 trail={activity_ref:'live1',started_at:'x',updated_at:'x',points:[[-34.7,150.9,t,0],[-34.71,150.9,t+10,0]],roads:{}};
 const {result,unmount}=render();
 await waitFor(()=>expect(result.current.day.live.length).toBe(1));
 expect(calls.find(c=>c[0]==='my_live_trail')[1].p_after).toBe(0);
 trail={...trail,points:[[-34.72,150.9,t+20,0],[-34.7,150.9,t,0]]}; // a late duplicate and one new point
 await act(async()=>{await vi.advanceTimersByTimeAsync(10500);});
 const second=calls.filter(c=>c[0]==='my_live_trail')[1];
 expect(second[1].p_after).toBe(t+10);
 await waitFor(()=>expect(result.current.live.points.map(p=>p[2])).toEqual([t,t+10,t+20]));
 trail=null; // the activity ended
 await act(async()=>{await vi.advanceTimersByTimeAsync(10500);});
 await waitFor(()=>expect(result.current.live).toBeNull());
 unmount();vi.useRealTimers();
});
it('does not poll a past day or run when disabled',async()=>{
 const past=render({date:'2026-11-08'});
 await waitFor(()=>expect(past.result.current.loading).toBe(false));
 expect(calls.some(c=>c[0]==='my_live_trail')).toBe(false);
 calls.length=0;
 renderHook(()=>usePersonDay({viewer:'me',owner:'her',date:DATE,timeZone:Z,now:NOW,enabled:false}));
 expect(calls).toEqual([]);
});
it('merges unchanged rows from the held copy, and bounds the cache',()=>{
 const held=[row('a','e1')];
 expect(mergeRows(held,[{...row('a','e1'),points:null}])[0].points.length).toBe(2);
 expect(mergeRows(held,[{...row('a','e2'),points:null}])).toEqual([]); // changed etag with no geometry: never trust it
 for(let i=0;i<40;i++)storeDay('me','her','2026-01-'+String(i+1).padStart(2,'0'),{rows:[]});
 expect(cachedDay('me','her','2026-01-01')).toBeNull();expect(cachedDay('me','her','2026-01-40')).not.toBeNull();
});
