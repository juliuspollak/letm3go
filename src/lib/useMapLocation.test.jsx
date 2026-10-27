import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({currentPosition:vi.fn(),addListener:vi.fn(),foreground:null}));
vi.mock('@capacitor/app',()=>({App:{addListener:mock.addListener}}));
vi.mock('./recorder.js',()=>({recorderAvailable:()=>true,recorder:{currentPosition:mock.currentPosition}}));
import {useMapLocation} from './useMapLocation.js';
const point=()=>({latitude:-34,longitude:151,accuracy:10,timestamp:Date.now()/1000});
beforeEach(()=>{mock.currentPosition.mockResolvedValue(point());mock.addListener.mockImplementation(async(event,callback)=>{mock.foreground=callback;return {remove:vi.fn()};});});
afterEach(cleanup);
it('loads your position when an already-authorized map opens',async()=>{
 const {result}=renderHook(()=>useMapLocation('owner',true,'always'));
 await waitFor(()=>expect(result.current.position?.latitude).toBe(-34));
 expect(mock.currentPosition).toHaveBeenCalled();
});
it('waits for restored permission without prompting automatically',async()=>{
 const {result,rerender}=renderHook(({permission})=>useMapLocation('owner',true,permission),{initialProps:{permission:'unavailable'}});
 expect(mock.currentPosition).not.toHaveBeenCalled();
 rerender({permission:'always'});
 await waitFor(()=>expect(result.current.position?.latitude).toBe(-34));
});
it('recovers from a stalled initial location read on native foreground and ignores its late reply',async()=>{
 let complete;
 mock.currentPosition.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
 const {result}=renderHook(()=>useMapLocation('owner',true,'always'));
 await waitFor(()=>expect(mock.currentPosition).toHaveBeenCalled());
 await act(async()=>mock.foreground({isActive:true}));
 expect(result.current.position?.latitude).toBe(-34);
 await act(async()=>complete({...point(),latitude:-35}));
 expect(result.current.position?.latitude).toBe(-34);
});
it('does not retain another account position while a new location request loads',async()=>{
 const {result,rerender}=renderHook(({owner})=>useMapLocation(owner,true,'always'),{initialProps:{owner:'one'}});
 await waitFor(()=>expect(result.current.position?.latitude).toBe(-34));
 mock.currentPosition.mockImplementation(()=>new Promise(()=>{}));
 rerender({owner:'two'});
 await waitFor(()=>expect(result.current.loading).toBe(true));
 expect(result.current.position).toBeNull();
});
