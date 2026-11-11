import {act,renderHook,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn(),handlers:[],removed:[]}));
// A Realtime client that records channels, so a signal can be sent by the test.
const fakeChannel=topic=>{const ch={topic,on:(type,filter,fn)=>{ch.filter=filter;ch.fn=fn;return ch;},subscribe:cb=>{mock.handlers.push(ch);cb?.('SUBSCRIBED');return ch;}};return ch;};
vi.mock('./supabase.js',()=>({supabase:{rpc:mock.rpc,realtime:{setAuth:async()=>{}},channel:topic=>fakeChannel(topic),removeChannel:ch=>{mock.removed.push(ch.topic);}}}));
import {usePersonDay} from './usePersonDay.js';
const signal=async()=>{await act(async()=>{mock.handlers.filter(h=>h.topic==='user:me').forEach(h=>h.fn({}));await new Promise(r=>setTimeout(r,20));});};
import {clearPersonDays,dropOwner,mergeRows,cachedDay,storeDay,SHOW_CACHED_MS} from './personDayCache.js';
import {dayWindow} from './dayWindow.js';

const Z='Australia/Sydney',DATE='2026-11-10',W=dayWindow(DATE,Z);
const NOW=()=>W.start+40000;
const row=(id,etag,points)=>({activity_id:id,started_at:new Date((W.start+3600)*1000).toISOString(),ended_at:new Date((W.start+4000)*1000).toISOString(),activity:'Driving',title:'Trip '+id,etag,roads:{},
 points:points===undefined?[{latitude:-34.5,longitude:150.9,segment:0,t:W.start+3600},{latitude:-34.6,longitude:150.9,segment:0,t:W.start+3700}]:points});
let dayRows,trail,calls;
beforeEach(()=>{
 clearPersonDays();mock.handlers.length=0;mock.removed.length=0;calls=[];dayRows=[row('a','e1')];trail=null;
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
it('drops a trail the server emptied and fetches the day again, so a finished drive is not drawn twice',async()=>{
 vi.useFakeTimers({shouldAdvanceTime:true});
 const t=W.start+39000;
 trail={activity_ref:'live1',started_at:'x',updated_at:'x',points:[[-34.7,150.9,t,0],[-34.71,150.9,t+10,0]],roads:{},point_count:2};
 const {result,unmount}=render();
 await waitFor(()=>expect(result.current.day.live.length).toBe(1));
 const dayCalls=calls.filter(c=>c[0]==='my_shared_day').length;
 trail={...trail,points:[],point_count:0}; // finished or hidden: the row remains, emptied
 await act(async()=>{await vi.advanceTimersByTimeAsync(10500);});
 await waitFor(()=>expect(result.current.live).toBeNull());
 expect(result.current.day.live).toEqual([]);
 await waitFor(()=>expect(calls.filter(c=>c[0]==='my_shared_day').length).toBeGreaterThan(dayCalls));
 unmount();vi.useRealTimers();
});
it('a quiet poll (nothing new) does not rebuild the day',async()=>{
 vi.useFakeTimers({shouldAdvanceTime:true});
 const t=W.start+39000;
 trail={activity_ref:'live1',started_at:'x',updated_at:'x',points:[[-34.7,150.9,t,0],[-34.71,150.9,t+10,0]],roads:{},point_count:2};
 const {result,unmount}=render();
 await waitFor(()=>expect(result.current.day.live.length).toBe(1));
 const first=result.current.day;
 await act(async()=>{await vi.advanceTimersByTimeAsync(10500);});     // same trail again
 await act(async()=>{await vi.advanceTimersByTimeAsync(10500);});
 expect(result.current.day).toBe(first);
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

describe('revocation signals',()=>{
 it('listens on the viewer\'s own private channel for the share event, and stops on unmount',async()=>{
  const {unmount}=render();
  await waitFor(()=>expect(mock.handlers.length).toBe(1));
  expect(mock.handlers[0].topic).toBe('user:me');expect(mock.handlers[0].filter).toEqual({event:'share'});
  unmount();expect(mock.removed).toContain('user:me');
 });
 it('an unshared activity disappears from an open map at once, without waiting for the schedule',async()=>{
  const {result}=render();
  await waitFor(()=>expect(result.current.day.activities.length).toBe(1));
  const before=calls.filter(c=>c[0]==='my_shared_day').length;
  dayRows=[];                                   // the owner made it private
  await signal();
  await waitFor(()=>expect(result.current.day.activities.length).toBe(0));
  expect(calls.filter(c=>c[0]==='my_shared_day').length).toBeGreaterThan(before);
 });
 it('after a signal nothing held counts as verified, so an unreachable server shows nothing instead of the old rows',async()=>{
  const {result}=render();
  await waitFor(()=>expect(result.current.day.activities.length).toBe(1));
  mock.rpc.mockImplementation(async()=>({data:null,error:{message:'offline'}}));
  await signal();
  await waitFor(()=>expect(result.current.day.activities.length).toBe(0));
  expect(result.current.error).toMatch(/offline/);
 });
 it('a response that was already on its way when access changed cannot bring the activity back',async()=>{
  const {result}=render();
  await waitFor(()=>expect(result.current.day.activities.length).toBe(1));
  let releaseOld;
  mock.rpc.mockImplementationOnce(async name=>{ if(name==='my_shared_day'){ await new Promise(r=>{releaseOld=r;}); return {data:[row('a','e1')],error:null}; } return {data:[],error:null}; });
  const slow=act(async()=>{window.dispatchEvent(new Event('online'));await new Promise(r=>setTimeout(r,10));});  // starts a revalidation that will answer late
  await slow;
  dayRows=[];
  await signal();                                // revocation: a newer request returns nothing
  await waitFor(()=>expect(result.current.day.activities.length).toBe(0));
  await act(async()=>{releaseOld?.();await new Promise(r=>setTimeout(r,20));});   // the stale answer finally arrives
  expect(result.current.day.activities.length).toBe(0);
  expect(cachedDay('me','her',`${DATE}@${Z}`)?.rows||[]).toEqual([]);
 });
 it('dropping a person discards a request still in flight for them',async()=>{
  let release;
  mock.rpc.mockImplementation(async name=>{ if(name==='my_shared_day'){ await new Promise(r=>{release=r;}); return {data:[row('a','e1')],error:null}; } return {data:[],error:null}; });
  const {result}=render();
  await waitFor(()=>expect(release).toBeTypeOf('function'));
  dropOwner('me','her');                         // they stopped being a friend while it was loading
  await act(async()=>{release();await new Promise(r=>setTimeout(r,20));});
  expect(result.current.day.activities.length).toBe(0);
  expect(cachedDay('me','her',`${DATE}@${Z}`)).toBeNull();
 });
});
describe('access changes and the cache',()=>{
 it('does not show an old cached day from memory: it waits for the server, so withdrawn access is not displayed',async()=>{
  const first=render();
  await waitFor(()=>expect(first.result.current.day.activities.length).toBe(1));
  first.unmount();
  cachedDay('me','her',`${DATE}@${Z}`).at=Date.now()-SHOW_CACHED_MS-1000; // older than the display window
  dayRows=[]; // meanwhile the owner made it private
  let release;mock.rpc.mockImplementation(async(name,params)=>{
   calls.push([name,params]);
   if(name==='my_shared_day'){await new Promise(r=>{release=r;});return {data:dayRows,error:null};}
   return {data:[],error:null};
  });
  const again=render();
  expect(again.result.current.day.activities.length).toBe(0);   // not shown while unverified
  expect(again.result.current.loading).toBe(true);
  await waitFor(()=>expect(release).toBeTypeOf('function'));
  release();
  await waitFor(()=>expect(again.result.current.loading).toBe(false));
  expect(again.result.current.day.activities.length).toBe(0);
 });
 it('offline, an old cached day is not shown from memory either, and the failure is reported',async()=>{
  const first=render();
  await waitFor(()=>expect(first.result.current.day.activities.length).toBe(1));
  first.unmount();
  cachedDay('me','her',`${DATE}@${Z}`).at=Date.now()-SHOW_CACHED_MS-1000;
  mock.rpc.mockImplementation(async()=>({data:null,error:{message:'offline'}}));
  const again=render();
  await waitFor(()=>expect(again.result.current.loading).toBe(false));
  expect(again.result.current.day.activities.length).toBe(0);
  expect(again.result.current.error).toMatch(/offline/);
 });
 it('an open map whose revalidation keeps failing stops showing rows once they are no longer recently verified',async()=>{
  vi.useFakeTimers({shouldAdvanceTime:true});
  const {result,unmount}=render();
  await waitFor(()=>expect(result.current.day.activities.length).toBe(1));
  mock.rpc.mockImplementation(async()=>({data:null,error:{message:'offline'}}));
  await act(async()=>{await vi.advanceTimersByTimeAsync(61000);});
  expect(result.current.day.activities.length).toBe(1);        // verified a minute ago: still shown
  cachedDay('me','her',`${DATE}@${Z}`).at=Date.now()-SHOW_CACHED_MS-1000;
  await act(async()=>{await vi.advanceTimersByTimeAsync(61000);});
  await waitFor(()=>expect(result.current.day.activities.length).toBe(0));
  expect(result.current.error).toMatch(/offline/);
  unmount();vi.useRealTimers();
 });
 it('revalidates an open map on a schedule, so a friend removed meanwhile disappears from it',async()=>{
  vi.useFakeTimers({shouldAdvanceTime:true});
  const {result,unmount}=render();
  await waitFor(()=>expect(result.current.day.activities.length).toBe(1));
  dayRows=[]; // the server no longer returns anything for this viewer
  await act(async()=>{await vi.advanceTimersByTimeAsync(61000);});
  await waitFor(()=>expect(result.current.day.activities.length).toBe(0));
  unmount();vi.useRealTimers();
 });
 it('revalidates when the app returns to the foreground and when the network returns',async()=>{
  const {result}=render();
  await waitFor(()=>expect(result.current.day.activities.length).toBe(1));
  const before=calls.filter(c=>c[0]==='my_shared_day').length;
  dayRows=[];
  await act(async()=>{window.dispatchEvent(new Event('online'));});
  await waitFor(()=>expect(result.current.day.activities.length).toBe(0));
  expect(calls.filter(c=>c[0]==='my_shared_day').length).toBeGreaterThan(before);
 });
 it('keys a day by its time zone, so a traveller never gets the wrong 24 hours',async()=>{
  const sydney=render();
  await waitFor(()=>expect(sydney.result.current.day.activities.length).toBe(1));
  sydney.unmount();
  const la=renderHook(()=>usePersonDay({viewer:'me',owner:'her',date:DATE,timeZone:'America/Los_Angeles',now:NOW}));
  expect(la.result.current.day.activities.length).toBe(0);   // nothing reused from the Sydney window
  const sent=calls.filter(c=>c[0]==='my_shared_day').map(c=>c[1].p_from);
  await waitFor(()=>expect(new Set(sent.concat(calls.filter(c=>c[0]==='my_shared_day').map(c=>c[1].p_from))).size).toBeGreaterThan(3));
 });
 it('forgets a person entirely when they are no longer someone I may see',async()=>{
  const first=render();
  await waitFor(()=>expect(first.result.current.day.activities.length).toBe(1));
  first.unmount();
  dropOwner('me','her');
  expect(cachedDay('me','her',`${DATE}@${Z}`)).toBeNull();
 });
});
