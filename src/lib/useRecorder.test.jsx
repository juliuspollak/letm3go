import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getState:vi.fn(),addListener:vi.fn(),remove:vi.fn(),foreground:null}));
vi.mock('@capacitor/app',()=>({App:{addListener:mocks.addListener}}));
vi.mock('./recorder.js',()=>({emptyRecorder:{trips:[]},recorderAvailable:()=>true,recorder:{getState:mocks.getState}}));
import {useRecorder} from './useRecorder.js';
const snapshot=(trips=[])=>({ownerID:'owner',trips});
beforeEach(()=>{mocks.getState.mockResolvedValue(snapshot());mocks.addListener.mockImplementation(async(event,callback)=>{mocks.foreground=callback;return {remove:mocks.remove};});});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('loads automatic activities recorded while the WebView was suspended on native foreground',async()=>{
 const {result}=renderHook(()=>useRecorder('owner'));
 await waitFor(()=>expect(result.current.state.ownerID).toBe('owner'));
 mocks.getState.mockResolvedValue(snapshot([{id:'drive',recordingMode:'automatic'}]));
 await act(async()=>mocks.foreground({isActive:true}));
 expect(result.current.state.trips).toEqual([{id:'drive',recordingMode:'automatic'}]);
});
it('replaces a stalled pre-suspension read and ignores its late stale response',async()=>{
 let complete;
 mocks.getState.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
 const {result}=renderHook(()=>useRecorder('owner'));
 await waitFor(()=>expect(mocks.foreground).toBeTypeOf('function'));
 mocks.getState.mockResolvedValue(snapshot([{id:'new-drive'}]));
 await act(async()=>mocks.foreground({isActive:true}));
 expect(result.current.state.trips).toEqual([{id:'new-drive'}]);
 await act(async()=>complete(snapshot()));
 expect(result.current.state.trips).toEqual([{id:'new-drive'}]);
});
it('does not expose another account recordings after foreground refresh',async()=>{
 const {result}=renderHook(()=>useRecorder('owner'));
 await waitFor(()=>expect(result.current.state.ownerID).toBe('owner'));
 mocks.getState.mockResolvedValue({ownerID:'other',trips:[{id:'private'}]});
 await act(async()=>mocks.foreground({isActive:true}));
 expect(result.current.state.trips).toEqual([]);
 expect(result.current.error).toContain('does not match');
});
