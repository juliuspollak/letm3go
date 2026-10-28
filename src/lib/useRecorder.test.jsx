import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getState:vi.fn(),addListener:vi.fn(),onJourneysChanged:vi.fn(),remove:vi.fn(),foreground:null,journeysChanged:null}));
vi.mock('@capacitor/app',()=>({App:{addListener:mocks.addListener}}));
vi.mock('./recorder.js',()=>({emptyRecorder:{trips:[]},recorderAvailable:()=>true,onJourneysChanged:mocks.onJourneysChanged,recorder:{getState:mocks.getState}}));
import {useRecorder} from './useRecorder.js';
const snapshot=(trips=[])=>({ownerID:'owner',trips});
beforeEach(()=>{
 mocks.getState.mockResolvedValue(snapshot());
 mocks.addListener.mockImplementation(async(event,callback)=>{mocks.foreground=callback;return {remove:mocks.remove};});
 mocks.onJourneysChanged.mockImplementation(async callback=>{mocks.journeysChanged=callback;return {remove:mocks.remove};});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('loads automatic activities recorded while the WebView was suspended on native foreground',async()=>{
 const {result}=renderHook(()=>useRecorder('owner'));
 await waitFor(()=>expect(result.current.state.ownerID).toBe('owner'));
 mocks.getState.mockResolvedValue(snapshot([{id:'drive',recordingMode:'automatic'}]));
 await act(async()=>mocks.foreground({isActive:true}));
 expect(result.current.state.trips).toEqual([{id:'drive',recordingMode:'automatic'}]);
});
it('refreshes History as soon as native publishes a journey change',async()=>{
 const {result}=renderHook(()=>useRecorder('owner'));
 await waitFor(()=>expect(result.current.state.ownerID).toBe('owner'));
 await waitFor(()=>expect(mocks.journeysChanged).toBeTypeOf('function'));
 mocks.getState.mockResolvedValue(snapshot([{id:'stopped',state:'paused',details:{provisional:true}}]));
 await act(async()=>mocks.journeysChanged());
 expect(result.current.state.trips).toEqual([{id:'stopped',state:'paused',details:{provisional:true}}]);
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
it('skips an identical poll so the state reference stays stable while idle',async()=>{
 const {result}=renderHook(()=>useRecorder('owner'));
 await waitFor(()=>expect(result.current.state.ownerID).toBe('owner'));
 const first=result.current.state;
 // A poll that only advances the debug trackingUsage counter must not re-render.
 mocks.getState.mockResolvedValue({ownerID:'owner',trips:[],trackingUsage:{continuousSeconds:99}});
 await act(async()=>mocks.foreground({isActive:true}));
 expect(result.current.state).toBe(first);
});
it('does not skip when an active journey gains a GPS point, distance or duration',async()=>{
 const {result}=renderHook(()=>useRecorder('owner'));
 await waitFor(()=>expect(result.current.state.ownerID).toBe('owner'));
 const drive=(pts,m,d)=>({id:'drive',state:'recording',points:pts,distanceMeters:m,durationSeconds:d});
 mocks.getState.mockResolvedValue({ownerID:'owner',trips:[],automaticTrip:drive([{latitude:-33,longitude:151}],0,10)});
 await act(async()=>mocks.foreground({isActive:true}));
 expect(result.current.state.automaticTrip.points.length).toBe(1);
 mocks.getState.mockResolvedValue({ownerID:'owner',trips:[],automaticTrip:drive([{latitude:-33,longitude:151},{latitude:-32.9,longitude:151}],500,20)});
 await act(async()=>mocks.foreground({isActive:true}));
 expect(result.current.state.automaticTrip.points.length).toBe(2);
 expect(result.current.state.automaticTrip.distanceMeters).toBe(500);
 expect(result.current.state.automaticTrip.durationSeconds).toBe(20);
});
it('does not expose another account recordings after foreground refresh',async()=>{
 const {result}=renderHook(()=>useRecorder('owner'));
 await waitFor(()=>expect(result.current.state.ownerID).toBe('owner'));
 mocks.getState.mockResolvedValue({ownerID:'other',trips:[{id:'private'}]});
 await act(async()=>mocks.foreground({isActive:true}));
 expect(result.current.state.trips).toEqual([]);
 expect(result.current.error).toContain('does not match');
});
it('requests a controlled account rebind when native storage is locked',async()=>{
 const rebind=vi.fn();
 mocks.getState.mockResolvedValue({trips:[],permission:'locked',storageReady:false,version:'1.0',build:'57'});
 const {result}=renderHook(()=>useRecorder('owner',rebind));
 await waitFor(()=>expect(result.current.error).toContain('locked'));
 expect(rebind).toHaveBeenCalledWith('owner');
 expect(result.current.state).toMatchObject({version:'1.0',build:'57',permission:'locked',storageReady:false,trips:[]});
});

it('only requests one rebind for repeated locked native snapshots',async()=>{
 const rebind=vi.fn().mockResolvedValue(false);
 mocks.getState.mockResolvedValue({trips:[],permission:'locked',storageReady:false,version:'1.0',build:'57'});
 const {result}=renderHook(()=>useRecorder('owner',rebind));
 await waitFor(()=>expect(rebind).toHaveBeenCalledTimes(1));
 await act(async()=>mocks.foreground({isActive:true}));
 await act(async()=>mocks.foreground({isActive:true}));
 expect(rebind).toHaveBeenCalledTimes(1);
 expect(result.current.state.trips).toEqual([]);
 expect(result.current.error).toContain('locked');
});
it('exposes native bridge errors instead of claiming there are no recorded journeys',async()=>{
 mocks.getState.mockRejectedValue(new Error('ManualRecorder bridge unavailable'));
 const {result}=renderHook(()=>useRecorder('owner'));
 await waitFor(()=>expect(result.current.error).toContain('ManualRecorder bridge unavailable'));
});
