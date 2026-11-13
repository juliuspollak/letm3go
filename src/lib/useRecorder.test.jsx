import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getState:vi.fn(),assignEquipment:vi.fn(),deleteActivity:vi.fn(),addListener:vi.fn(),onJourneysChanged:vi.fn(),remove:vi.fn(),foreground:null,journeysChanged:null}));
vi.mock('@capacitor/app',()=>({App:{addListener:mocks.addListener}}));
vi.mock('./recorder.js',()=>({emptyRecorder:{trips:[]},recorderAvailable:()=>true,onJourneysChanged:mocks.onJourneysChanged,recorder:{getState:mocks.getState,assignEquipment:mocks.assignEquipment,deleteActivity:mocks.deleteActivity}}));
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

it('a late pre-delete poll cannot restore a deleted activity in the UI',async()=>{
 mocks.getState.mockResolvedValue(snapshot([{id:'delete-me',updatedAt:1}]));
 const {result}=renderHook(()=>useRecorder('owner'));
 await waitFor(()=>expect(result.current.state.trips).toHaveLength(1));
 let complete; mocks.getState.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
 await act(async()=>mocks.foreground({isActive:true}));
 mocks.deleteActivity.mockResolvedValue(snapshot([]));
 await act(async()=>result.current.run('deleteActivity','delete-me'));
 expect(mocks.deleteActivity).toHaveBeenCalledWith('delete-me','owner');
 await act(async()=>complete(snapshot([{id:'delete-me',updatedAt:1}])));
 expect(result.current.state.trips).toEqual([]);
});
it('requests incremental native history after the first full snapshot',async()=>{
 mocks.getState.mockResolvedValue({...snapshot([{id:'watch'}]),historyToken:'history-v1'});
 const {result}=renderHook(()=>useRecorder('owner'));
 await waitFor(()=>expect(result.current.state.trips).toHaveLength(1));
 const original=result.current.state.trips;
 mocks.getState.mockResolvedValue({...snapshot([]),historyToken:'history-v1',historyUnchanged:true,currentSpeed:2});
 await act(async()=>mocks.foreground({isActive:true}));
 expect(mocks.getState).toHaveBeenLastCalledWith({historyToken:'history-v1'});
 expect(result.current.state.trips).toBe(original);
});

it('does not display an obsolete polling failure after a successful deletion',async()=>{
 mocks.getState.mockResolvedValue(snapshot([{id:'delete-me',updatedAt:1}]));
 const {result}=renderHook(()=>useRecorder('owner'));
 await waitFor(()=>expect(result.current.state.trips).toHaveLength(1));
 let fail;mocks.getState.mockImplementationOnce(()=>new Promise((resolve,reject)=>{fail=reject;}));
 await act(async()=>mocks.foreground({isActive:true}));
 mocks.deleteActivity.mockResolvedValue(snapshot([]));
 await act(async()=>result.current.run('deleteActivity','delete-me'));
 await act(async()=>fail(new Error('Old polling failure')));
 expect(result.current.state.trips).toEqual([]);expect(result.current.error).toBe('');
});

it('applies a metadata-only equipment acknowledgement without fetching or replacing GPS history',async()=>{
 const points=[{latitude:1,longitude:2}],other={id:'other',points:[]};
 mocks.getState.mockResolvedValue({...snapshot([{id:'drive',points,updatedAt:1},other]),historyToken:'h1'});
 const {result}=renderHook(()=>useRecorder('owner'));
 await waitFor(()=>expect(result.current.state.historyToken).toBe('h1'));
 const calls=mocks.getState.mock.calls.length;let finish;
 mocks.assignEquipment.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 let saving;act(()=>{saving=result.current.run('assignEquipment',{id:'drive',ids:['tesla']});});
 await act(async()=>mocks.journeysChanged());
 expect(mocks.getState).toHaveBeenCalledTimes(calls);
 await act(async()=>{finish({ownerID:'owner',baseHistoryToken:'h1',historyToken:'h2',equipmentUpdate:{id:'drive',equipment:[{id:'tesla',name:'Tesla'}],vehicle:'Tesla',vehicleID:'tesla',updatedAt:2}});await saving;});
 expect(result.current.state.trips[0]).toMatchObject({vehicle:'Tesla',vehicleID:'tesla',updatedAt:2});
 expect(result.current.state.trips[0].points).toBe(points);
 expect(result.current.state.trips[1]).toBe(other);
 expect(result.current.state.historyToken).toBe('h2');
 expect(mocks.getState).toHaveBeenCalledTimes(calls);
});
it('reads authoritative history if an equipment acknowledgement was based on unseen native changes',async()=>{
 mocks.getState.mockResolvedValueOnce({...snapshot([{id:'drive',updatedAt:1}]),historyToken:'h1'});
 const {result}=renderHook(()=>useRecorder('owner'));
 await waitFor(()=>expect(result.current.state.historyToken).toBe('h1'));
 mocks.assignEquipment.mockResolvedValue({ownerID:'owner',baseHistoryToken:'unseen',historyToken:'h3',equipmentUpdate:{id:'drive',vehicle:'Tesla',updatedAt:3}});
 mocks.getState.mockResolvedValue({...snapshot([{id:'drive',vehicle:'Tesla',updatedAt:3},{id:'newly-finished'}]),historyToken:'h3'});
 await act(async()=>result.current.run('assignEquipment',{id:'drive',ids:['tesla']}));
 expect(result.current.state.trips.map(t=>t.id)).toEqual(['drive','newly-finished']);
 expect(result.current.state.historyToken).toBe('h3');
});
it('rejects an equipment reply from another account',async()=>{
 mocks.getState.mockResolvedValue({...snapshot([{id:'drive',updatedAt:1}]),historyToken:'h1'});
 const {result}=renderHook(()=>useRecorder('owner'));
 await waitFor(()=>expect(result.current.state.historyToken).toBe('h1'));
 mocks.assignEquipment.mockResolvedValue({ownerID:'someone-else',baseHistoryToken:'h1',historyToken:'h2',equipmentUpdate:{id:'drive',vehicle:'Tesla',updatedAt:2}});
 await act(async()=>result.current.run('assignEquipment',{id:'drive',ids:['tesla']}));
 expect(result.current.state.trips).toEqual([]);
 expect(result.current.error).toMatch(/account changed/i);
});
it('keeps the saved assignment on failure and resumes ordinary native refreshes',async()=>{
 mocks.getState.mockResolvedValue({...snapshot([{id:'drive',vehicle:'Original',updatedAt:1}]),historyToken:'h1'});
 const {result}=renderHook(()=>useRecorder('owner'));
 await waitFor(()=>expect(result.current.state.historyToken).toBe('h1'));
 mocks.assignEquipment.mockRejectedValueOnce(new Error('Storage unavailable'));
 await act(async()=>result.current.run('assignEquipment',{id:'drive',ids:['tesla']}));
 expect(result.current.state.trips[0].vehicle).toBe('Original');
 expect(result.current.busy).toBe(false);
 const calls=mocks.getState.mock.calls.length;
 await act(async()=>mocks.journeysChanged());
 expect(mocks.getState.mock.calls.length).toBeGreaterThan(calls);
});
it('loads a newly signed-in account while an old account equipment request is pending',async()=>{
 mocks.getState.mockResolvedValue({...snapshot([{id:'drive',updatedAt:1}]),historyToken:'h1'});
 const {result,rerender}=renderHook(({owner})=>useRecorder(owner),{initialProps:{owner:'owner'}});
 await waitFor(()=>expect(result.current.state.historyToken).toBe('h1'));
 let finish,saving;mocks.assignEquipment.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 act(()=>{saving=result.current.run('assignEquipment',{id:'drive',ids:['tesla']});});
 mocks.getState.mockResolvedValue({ownerID:'new-owner',historyToken:'new',trips:[]});
 rerender({owner:'new-owner'});
 await waitFor(()=>expect(result.current.state.ownerID).toBe('new-owner'));
 await act(async()=>{finish({ownerID:'owner',baseHistoryToken:'h1',historyToken:'h2',equipmentUpdate:{id:'drive',vehicle:'Tesla',updatedAt:2}});await saving;});
 expect(result.current.state.ownerID).toBe('new-owner');
 expect(result.current.state.trips).toEqual([]);
});
