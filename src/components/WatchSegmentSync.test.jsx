import {render,cleanup,act} from '@testing-library/react';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const mocks=vi.hoisted(()=>({auth:null,fetch:vi.fn(),build:vi.fn(),send:vi.fn(),refresh:null}));
vi.mock('../lib/AuthContext.jsx',()=>({useAuth:()=>mocks.auth}));
vi.mock('../lib/recorder.js',()=>({recorderAvailable:()=>true,recorder:{setWatchSegments:mocks.send}}));
vi.mock('../lib/mtbApi.js',()=>({fetchWatchSegments:mocks.fetch}));
vi.mock('../lib/watchSegments.js',()=>({buildWatchSegments:mocks.build}));
vi.mock('../lib/segmentEvents.js',()=>({watchSegmentRefresh:callback=>{mocks.refresh=callback;return()=>{};}}));
import WatchSegmentSync from './WatchSegmentSync.jsx';
const state=(ownerID='owner',historyToken='h1')=>({ownerID,historyToken,trips:[{points:[{latitude:-34,longitude:151,timestamp:100}]}]});
beforeEach(()=>{
 vi.useFakeTimers();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
 Object.defineProperty(navigator,'onLine',{configurable:true,value:true});
 mocks.auth={status:'authenticated',session:{user:{id:'owner'}}};
 mocks.fetch.mockResolvedValue([]);mocks.build.mockResolvedValue({ownerID:'owner',revision:'revision-1',definitions:[]});mocks.send.mockResolvedValue();
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.clearAllMocks();});
const start=()=>act(async()=>{await vi.advanceTimersByTimeAsync(8000);});
it('sends an owner-scoped catalogue using public segments near the latest actual fix',async()=>{
 render(<WatchSegmentSync state={state()}/>);await start();
 expect(mocks.fetch).toHaveBeenCalledWith(expect.objectContaining({minLat:-34.18,maxLat:-33.82}));
 expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({ownerID:'owner',publicSegments:[]}));
 expect(mocks.send).toHaveBeenCalledTimes(1);
});
it('rejects a late catalogue after switching accounts',async()=>{
 let resolve;mocks.fetch.mockReturnValue(new Promise(r=>{resolve=r;}));
 const view=render(<WatchSegmentSync state={state()}/>);await start();
 mocks.auth={status:'authenticated',session:{user:{id:'other'}}};view.rerender(<WatchSegmentSync state={state('other')}/>);
 await act(async()=>{resolve([]);});expect(mocks.send).not.toHaveBeenCalled();
});
it('rejects a late catalogue after history changes',async()=>{
 let resolve;mocks.build.mockReturnValue(new Promise(r=>{resolve=r;}));
 const view=render(<WatchSegmentSync state={state()}/>);await start();view.rerender(<WatchSegmentSync state={state('owner','h2')}/>);
 await act(async()=>{resolve({definitions:[]});});expect(mocks.send).not.toHaveBeenCalled();
});
it('retains the offline native cache when public lookup fails and retries on reconnect',async()=>{
 mocks.fetch.mockRejectedValueOnce(new Error('offline'));render(<WatchSegmentSync state={state()}/>);await start();
 expect(mocks.send).not.toHaveBeenCalled();await act(async()=>{await mocks.refresh();});
 expect(mocks.send).toHaveBeenCalledTimes(1);
});

it('refreshes public availability without rematching or transferring unchanged history every five minutes',async()=>{
 render(<WatchSegmentSync state={state()}/>);await start();
 await act(async()=>{await mocks.refresh();});
 expect(mocks.fetch).toHaveBeenCalledTimes(2);expect(mocks.build).toHaveBeenCalledTimes(1);expect(mocks.send).toHaveBeenCalledTimes(1);
});
