import {act,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useSocialRestPlaces} from './useSocialRestPlaces.js';

const {sync}=vi.hoisted(()=>({sync:vi.fn()}));
vi.mock('./recorder.js',()=>({recorderAvailable:()=>true,recorder:{setSocialRestPlaces:sync}}));
const places=[{id:'school',latitude:-33,longitude:151,radius:500,name:'School'}];

beforeEach(()=>{vi.useFakeTimers();sync.mockReset().mockResolvedValue(undefined);});
afterEach(()=>vi.useRealTimers());

it('retries a failed recorder write with the same places when the source does not change',async()=>{
 sync.mockRejectedValueOnce(new Error('Storage unavailable'));
 const {unmount}=renderHook(()=>useSocialRestPlaces('owner',places,true));
 await act(async()=>vi.advanceTimersByTimeAsync(1000));
 expect(sync.mock.calls).toEqual(Array(2).fill(['owner',[{id:'school',latitude:-33,longitude:151,radius:500}]]));
 unmount();
});

it('cancels a stale retry when a newer list arrives',async()=>{
 sync.mockRejectedValueOnce(new Error('Storage unavailable'));
 const {rerender,unmount}=renderHook(({rows})=>useSocialRestPlaces('owner',rows,true),{initialProps:{rows:places}});
 await act(async()=>vi.advanceTimersByTimeAsync(0));
 rerender({rows:[]});
 await act(async()=>vi.advanceTimersByTimeAsync(30000));
 expect(sync).toHaveBeenCalledTimes(2);
 expect(sync).toHaveBeenLastCalledWith('owner',[]);
 unmount();
});
