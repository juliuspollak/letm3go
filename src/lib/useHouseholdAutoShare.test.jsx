import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({share:vi.fn()}));
vi.mock('./householdAutoShare.js',()=>({shareNewHouseholdActivities:mock.share}));
import {useHouseholdAutoShare} from './useHouseholdAutoShare.js';

const args=over=>({client:{},recorder:{},enabled:true,finishedCount:1,...over});
beforeEach(()=>{vi.useFakeTimers();mock.share.mockReset().mockResolvedValue({published:[],failed:[]});});
afterEach(()=>{cleanup();vi.useRealTimers();});

it('runs once shortly after the app opens, and again when an activity finishes',async()=>{
 const {rerender}=renderHook(p=>useHouseholdAutoShare(p),{initialProps:args()});
 await act(async()=>{await vi.advanceTimersByTimeAsync(5100);});
 expect(mock.share).toHaveBeenCalledTimes(1);
 rerender(args({finishedCount:2}));
 await act(async()=>{await vi.advanceTimersByTimeAsync(5100);});
 expect(mock.share).toHaveBeenCalledTimes(2);
});
it('retries when the network returns and when the app comes back to the foreground',async()=>{
 renderHook(()=>useHouseholdAutoShare(args()));
 await act(async()=>{await vi.advanceTimersByTimeAsync(5100);});
 mock.share.mockClear();
 await act(async()=>{window.dispatchEvent(new Event('online'));await vi.advanceTimersByTimeAsync(3100);});
 expect(mock.share).toHaveBeenCalledTimes(1);
 await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(3100);});
 expect(mock.share).toHaveBeenCalledTimes(2);
});
it('never runs two passes at once: a trigger during a pass schedules exactly one more',async()=>{
 let release;
 mock.share.mockImplementation(()=>new Promise(r=>{release=()=>r({published:[],failed:[]});}));
 renderHook(()=>useHouseholdAutoShare(args()));
 await act(async()=>{await vi.advanceTimersByTimeAsync(5100);});
 expect(mock.share).toHaveBeenCalledTimes(1);
 await act(async()=>{window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('online'));await vi.advanceTimersByTimeAsync(3100);});
 expect(mock.share).toHaveBeenCalledTimes(1);          // still the first pass
 mock.share.mockResolvedValue({published:[],failed:[]});
 await act(async()=>{release();await vi.advanceTimersByTimeAsync(2100);});
 expect(mock.share).toHaveBeenCalledTimes(2);
});
it('does nothing when disabled or signed out, and stops its listeners on unmount',async()=>{
 renderHook(()=>useHouseholdAutoShare(args({enabled:false})));
 const {unmount}=renderHook(()=>useHouseholdAutoShare(args()));
 unmount();
 await act(async()=>{window.dispatchEvent(new Event('online'));await vi.advanceTimersByTimeAsync(10000);});
 expect(mock.share).not.toHaveBeenCalled();
});
