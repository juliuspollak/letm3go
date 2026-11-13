import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({share:vi.fn()}));
vi.mock('./householdAutoShare.js',()=>({HOUSEHOLD_SHARE_LIMIT:10,shareNewHouseholdActivities:mock.share}));
import {useHouseholdAutoShare,FOLLOW_UPS_MS} from './useHouseholdAutoShare.js';

const args=over=>({client:{},recorder:{},enabled:true,finishedCount:1,...over});
beforeEach(()=>{vi.useFakeTimers();mock.share.mockReset().mockResolvedValue({published:[],failed:[]});});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();});

it('runs once shortly after the app opens, and again when an activity finishes',async()=>{
 const {rerender}=renderHook(p=>useHouseholdAutoShare(p),{initialProps:args()});
 await act(async()=>{await vi.advanceTimersByTimeAsync(5100);});
 expect(mock.share).toHaveBeenCalledTimes(1);
 mock.share.mockClear();
 rerender(args({finishedCount:2}));
 await act(async()=>{await vi.advanceTimersByTimeAsync(5100);});
 expect(mock.share).toHaveBeenCalledTimes(1);
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
it('looks again after an activity finishes, because the backup that uploads it comes a little later',async()=>{
 renderHook(()=>useHouseholdAutoShare(args()));
 await act(async()=>{await vi.advanceTimersByTimeAsync(FOLLOW_UPS_MS.at(-1)+100);});
 expect(mock.share).toHaveBeenCalledTimes(FOLLOW_UPS_MS.length+3);
});
it('a trigger that arrives during a pass is still serviced when an activity finishes mid-pass',async()=>{
 let release;
 mock.share.mockImplementationOnce(()=>new Promise(r=>{release=()=>r({published:[],failed:[]});}));
 const {rerender}=renderHook(p=>useHouseholdAutoShare(p),{initialProps:args()});
 await act(async()=>{await vi.advanceTimersByTimeAsync(5100);});
 expect(mock.share).toHaveBeenCalledTimes(1);
 rerender(args({finishedCount:2}));                         // the effect restarts while the pass is in flight
 await act(async()=>{await vi.advanceTimersByTimeAsync(5100);});
 expect(mock.share).toHaveBeenCalledTimes(1);               // still waiting on the first
 mock.share.mockResolvedValue({published:[],failed:[]});
 await act(async()=>{release();await vi.advanceTimersByTimeAsync(2100);});
 expect(mock.share.mock.calls.length).toBeGreaterThanOrEqual(2);   // the queued one ran
});
it('does nothing when disabled or signed out, and stops its listeners on unmount',async()=>{
 renderHook(()=>useHouseholdAutoShare(args({enabled:false})));
 const {unmount}=renderHook(()=>useHouseholdAutoShare(args()));
 unmount();
 await act(async()=>{window.dispatchEvent(new Event('online'));await vi.advanceTimersByTimeAsync(10000);});
 expect(mock.share).not.toHaveBeenCalled();
});

it('follows the backup: an activity that has just reached the cloud is looked at within seconds',async()=>{
 renderHook(()=>useHouseholdAutoShare(args()));
 await act(async()=>{await vi.advanceTimersByTimeAsync(5100);});
 mock.share.mockClear();
 await act(async()=>{window.dispatchEvent(new Event('letm3go:backed-up'));await vi.advanceTimersByTimeAsync(3100);});
 expect(mock.share).toHaveBeenCalledTimes(1);
});

it('drains a large eligible backlog automatically using bounded passes',async()=>{
 const full={published:Array.from({length:10},(_,i)=>String(i)),failed:[]};
 mock.share.mockResolvedValueOnce(full).mockResolvedValueOnce(full).mockResolvedValueOnce(full).mockResolvedValueOnce(full).mockResolvedValue({published:['last'],failed:[]});
 renderHook(()=>useHouseholdAutoShare(args()));
 await act(async()=>{await vi.advanceTimersByTimeAsync(16000);});
 expect(mock.share).toHaveBeenCalledTimes(5);
});

it('checks for delayed sharing and retries while the app stays open, without another user action',async()=>{
 renderHook(()=>useHouseholdAutoShare(args()));
 await act(async()=>{await vi.advanceTimersByTimeAsync(125000);});
 expect(mock.share).toHaveBeenCalledTimes(2);
});
it('does not run while offline, hidden or after sharing is disabled',async()=>{
 const online=vi.spyOn(navigator,'onLine','get').mockReturnValue(false);
 const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
 const {rerender}=renderHook(p=>useHouseholdAutoShare(p),{initialProps:args()});
 await act(async()=>{await vi.advanceTimersByTimeAsync(5100);});expect(mock.share).not.toHaveBeenCalled();
 online.mockReturnValue(true);visibility.mockReturnValue('hidden');
 await act(async()=>{window.dispatchEvent(new Event('online'));await vi.advanceTimersByTimeAsync(3100);});expect(mock.share).not.toHaveBeenCalled();
 visibility.mockReturnValue('visible');rerender(args({enabled:false}));
 await act(async()=>{await vi.advanceTimersByTimeAsync(500000);});expect(mock.share).not.toHaveBeenCalled();
});
