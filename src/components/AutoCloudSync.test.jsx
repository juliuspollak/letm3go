import {render,cleanup,act} from '@testing-library/react';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const mocks=vi.hoisted(()=>({activities:vi.fn(),settings:vi.fn(),collections:vi.fn(),journey:vi.fn(),auth:null,native:false,foreground:null,remove:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>mocks.native},registerPlugin:()=>({})}));
vi.mock('@capacitor/app',()=>({App:{addListener:vi.fn(async(_event,callback)=>{mocks.foreground=callback;return {remove:mocks.remove};})}}));
vi.mock('../lib/AuthContext.jsx',()=>({useAuth:()=>mocks.auth}));
vi.mock('../lib/supabase.js',()=>({supabase:{}}));
vi.mock('../lib/config.js',()=>({config:{backupEnabled:true}}));
vi.mock('../lib/cloudSync.js',()=>({syncPrivateActivities:mocks.activities}));
vi.mock('../lib/settingsSync.js',()=>({syncAccountSettings:mocks.settings}));
vi.mock('../lib/collectionSync.js',()=>({syncCollections:mocks.collections}));
vi.mock('../lib/journeyMetadataStore.js',()=>({runJourneySync:mocks.journey}));
import AutoCloudSync from './AutoCloudSync.jsx';

const state=(token)=>({ownerID:'owner',historyToken:token,places:[],deletedIDs:[],trips:[]});
beforeEach(()=>{
 vi.useFakeTimers();mocks.native=false;mocks.foreground=null;
 Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'});
 const savePreferences=vi.fn(async patch=>{mocks.auth={...mocks.auth,preferences:{...mocks.auth.preferences,...patch}};});
 mocks.auth={status:'authenticated',session:{user:{id:'owner'}},preferences:{displayName:'J',syncReceipts:{}},savePreferences};
 mocks.activities.mockResolvedValue({receipts:{},lastSync:'now'});
 mocks.settings.mockResolvedValue({receipts:{}});mocks.collections.mockResolvedValue({receipts:{}});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.clearAllMocks();});
const tick=async ms=>{await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});};

it('backs up only after something changed, not on every two-minute check',async()=>{
 const view=render(<AutoCloudSync state={state('h1')}/>);
 await tick(5000);
 expect(mocks.activities).toHaveBeenCalledTimes(1);
 // Unchanged history and settings: later checks do no work and save nothing.
 const saves=mocks.auth.savePreferences.mock.calls.length;
 await tick(3*120000);
 expect(mocks.activities).toHaveBeenCalledTimes(1);expect(mocks.auth.savePreferences.mock.calls.length).toBe(saves);
 // A newly saved activity changes the history token: the next check backs it up.
 view.rerender(<AutoCloudSync state={state('h2')}/>);
 await tick(120000);
 expect(mocks.activities).toHaveBeenCalledTimes(2);
});
it('a failed backup is tried again at the next check',async()=>{
 mocks.activities.mockRejectedValueOnce(new Error('offline'));
 render(<AutoCloudSync state={state('h1')}/>);
 // Failed activity backup is retried; unchanged later passes stay cheap.
 await tick(5000);await tick(2*120000);
 expect(mocks.activities).toHaveBeenCalledTimes(2);
});
it('sends the queued journey records and waits for the device to keep them',async()=>{
 const journeySync={read:vi.fn(()=>({})),write:vi.fn(),flush:vi.fn(async()=>{})};
 mocks.journey.mockResolvedValue({state:'active',revision:4});
 render(<AutoCloudSync state={state('h1')} journeySync={journeySync}/>);
 await tick(5000);
 expect(mocks.journey).toHaveBeenCalledWith(expect.objectContaining({owner:'owner',read:journeySync.read,write:journeySync.write}));
 expect(journeySync.flush).toHaveBeenCalled();
 expect(mocks.auth.savePreferences).toHaveBeenCalledWith(expect.objectContaining({lastBackup:'now'}));
});
it('a journey sync that could not reach the cloud is retried, not counted as done',async()=>{
 const journeySync={flush:vi.fn(async()=>{})};
 mocks.journey.mockResolvedValue({state:'offline',error:'Network request failed'});
 render(<AutoCloudSync state={state('h1')} journeySync={journeySync}/>);
 await tick(5000);
 expect(mocks.journey).toHaveBeenCalledTimes(1);
 await tick(2*120000);
 expect(mocks.journey).toHaveBeenCalledTimes(3);
});
it('a journey edit alone sends records, not a fresh route and photo backup',async()=>{
 const device={status:{revision:4,state:'active'},queue:{},dropped:{}};
 const journeySync={read:vi.fn(()=>device),write:vi.fn(),flush:vi.fn(async()=>{})};
 mocks.journey.mockImplementation(async()=>{device.queue={};device.status={revision:5,state:'active'};return {state:'active',revision:5};});
 render(<AutoCloudSync state={state('h1')} journeySync={journeySync}/>);
 await tick(5000);
 expect(mocks.activities).toHaveBeenCalledTimes(1);
 // A rename queues one record: only the journey pass runs, no routes or photos.
 device.queue={activities:[{ref:'a',title:'Renamed'}]};
 await tick(2*120000);
 expect(mocks.journey).toHaveBeenCalledTimes(3);
 expect(mocks.activities).toHaveBeenCalledTimes(1);
 expect(mocks.settings).toHaveBeenCalledTimes(1);
 expect(mocks.collections).toHaveBeenCalledTimes(1);
 // An idle device still checks the remote revision, without other backup work.
 const saves=mocks.auth.savePreferences.mock.calls.length;
 await tick(2*120000);
 expect(mocks.journey).toHaveBeenCalledTimes(5);
 expect(mocks.activities).toHaveBeenCalledTimes(1);
 expect(mocks.auth.savePreferences.mock.calls.length).toBe(saves);
});

it('discovers device A rename while device B is idle, including an immediate foreground check',async()=>{
 const {runJourneySync}=await vi.importActual('../lib/journeyMetadataStore.js');
 const {emptyGrouping}=await vi.importActual('../lib/journeyGrouping.js');
 const cloud={revision:1,metadata:{...emptyGrouping('owner'),titles:{a:'Original'}}},requests=[];
 const client={rpc:async name=>{requests.push(name);return {data:name==='journey_metadata_revision'?cloud.revision:{...cloud.metadata,revision:cloud.revision},error:null};}};
 const device={metadata:cloud.metadata,queue:{},status:{owner:'owner',revision:1,migratedAt:1,state:'active'}};
 const journeySync={read:()=>device,write:async patch=>Object.assign(device,typeof patch==='function'?patch(device):patch),flush:async()=>{}};
 mocks.journey.mockImplementation(args=>runJourneySync({...args,client}));
 render(<AutoCloudSync state={state('h1')} journeySync={journeySync}/>);await tick(5000);
 expect(requests).toEqual(['journey_metadata_revision']);
 cloud.metadata={...cloud.metadata,titles:{a:'Rename from device A'}};cloud.revision=2;
 await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
 expect(device.metadata.titles.a).toBe('Rename from device A');
 expect(requests).toEqual(['journey_metadata_revision','journey_metadata_revision','journey_metadata_snapshot']);
 await tick(2*120000);
 expect(requests.filter(name=>name==='journey_metadata_snapshot')).toHaveLength(1);
 expect(mocks.activities).toHaveBeenCalledTimes(1);expect(mocks.settings).toHaveBeenCalledTimes(1);expect(mocks.collections).toHaveBeenCalledTimes(1);
});

it('checks on native foreground and at the first interval without another full backup',async()=>{
 mocks.native=true;mocks.journey.mockResolvedValue({state:'active'});
 const journeySync={read:()=>({}),write:vi.fn(),flush:async()=>{}};
 const view=render(<AutoCloudSync state={state('h1')} journeySync={journeySync}/>);
 await tick(5000);expect(mocks.journey).toHaveBeenCalledTimes(1);
 await act(async()=>{mocks.foreground({isActive:true});});expect(mocks.journey).toHaveBeenCalledTimes(2);
 await tick(115000);expect(mocks.journey).toHaveBeenCalledTimes(3);
 expect(mocks.activities).toHaveBeenCalledTimes(1);view.unmount();expect(mocks.remove).toHaveBeenCalledTimes(1);
});

it('checks journey changes independently of an absent or not-yet-bound recorder',async()=>{
 mocks.journey.mockResolvedValue({state:'active'});
 const journeySync={read:()=>({}),write:vi.fn(),flush:async()=>{}};
 render(<AutoCloudSync state={{trips:[]}} journeySync={journeySync}/>);await tick(5000);
 expect(mocks.journey).toHaveBeenCalledWith(expect.objectContaining({owner:'owner'}));
 expect(mocks.activities).not.toHaveBeenCalled();expect(mocks.settings).not.toHaveBeenCalled();
});
