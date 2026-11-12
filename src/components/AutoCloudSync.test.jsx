import {render,cleanup,act} from '@testing-library/react';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const mocks=vi.hoisted(()=>({noteBackupFailure:vi.fn(),publications:vi.fn(),backupEnabled:true,efforts:vi.fn(),activities:vi.fn(),settings:vi.fn(),collections:vi.fn(),journey:vi.fn(),auth:null,native:false,foreground:null,remove:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>mocks.native},registerPlugin:()=>({})}));
vi.mock('@capacitor/app',()=>({App:{addListener:vi.fn(async(_event,callback)=>{mocks.foreground=callback;return {remove:mocks.remove};})}}));
vi.mock('../lib/AuthContext.jsx',()=>({useAuth:()=>mocks.auth}));
vi.mock('../lib/supabase.js',()=>({supabase:{}}));
vi.mock('../lib/config.js',()=>({config:{get backupEnabled(){return mocks.backupEnabled;}}}));
vi.mock('../lib/cloudSync.js',()=>({syncPublicSegments:mocks.publications,syncPrivateActivities:mocks.activities,syncSegmentEfforts:mocks.efforts}));
vi.mock('../lib/settingsSync.js',()=>({syncAccountSettings:mocks.settings}));
vi.mock('../lib/collectionSync.js',()=>({syncCollections:mocks.collections}));
vi.mock('../lib/journeyMetadataStore.js',async importOriginal=>({...await importOriginal(),refreshJourneyMetadata:mocks.journey}));
vi.mock('../lib/recorder.js',()=>({recorder:{noteBackupFailure:mocks.noteBackupFailure}}));
import AutoCloudSync from './AutoCloudSync.jsx';

const state=(token)=>({ownerID:'owner',historyToken:token,places:[],deletedIDs:[],trips:[]});
beforeEach(()=>{
 vi.useFakeTimers();mocks.backupEnabled=true;mocks.publications.mockResolvedValue({receipts:{},published:0,pending:false,failure:null});mocks.native=false;mocks.foreground=null;
 Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'});
 const savePreferences=vi.fn(async patch=>{const resolved=typeof patch==='function'?patch(mocks.auth.preferences):patch;mocks.auth={...mocks.auth,preferences:{...mocks.auth.preferences,...resolved}};return mocks.auth.preferences;});
 mocks.auth={status:'authenticated',session:{user:{id:'owner'}},preferences:{displayName:'J',syncReceipts:{}},savePreferences};
 mocks.activities.mockResolvedValue({receipts:{},lastSync:'now'});mocks.efforts.mockResolvedValue({pending:false,failure:null});
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
it('refreshes the device’s cache of Supabase metadata, uploading nothing',async()=>{
 const journeySync={read:vi.fn(()=>({})),write:vi.fn(),flush:vi.fn(async()=>{})};
 mocks.journey.mockResolvedValue({state:'active',revision:4});
 render(<AutoCloudSync state={state('h1')} journeySync={journeySync}/>);
 await tick(5000);
 expect(mocks.journey).toHaveBeenCalledWith(expect.objectContaining({owner:'owner',read:journeySync.read,write:journeySync.write}));
 expect(journeySync.flush).toHaveBeenCalled();
 expect(mocks.auth.preferences.lastBackup).toBe('now');
});
it('a metadata refresh that could not reach Supabase is retried, not counted as done',async()=>{
 const journeySync={flush:vi.fn(async()=>{})};
 mocks.journey.mockRejectedValue(new Error('Network request failed'));
 render(<AutoCloudSync state={state('h1')} journeySync={journeySync}/>);
 await tick(5000);
 expect(mocks.journey).toHaveBeenCalledTimes(1);
 await tick(2*120000);
 expect(mocks.journey).toHaveBeenCalledTimes(3);
});
it('a metadata refresh alone does not repeat the route and photo backup, and an idle device saves nothing',async()=>{
 const journeySync={read:vi.fn(()=>({})),write:vi.fn(),flush:vi.fn(async()=>{})};
 mocks.journey.mockResolvedValue({state:'active',revision:5});
 render(<AutoCloudSync state={state('h1')} journeySync={journeySync}/>);
 await tick(5000);
 expect(mocks.activities).toHaveBeenCalledTimes(1);
 await tick(2*120000);
 expect(mocks.journey).toHaveBeenCalledTimes(3);
 expect(mocks.activities).toHaveBeenCalledTimes(1);
 expect(mocks.settings).toHaveBeenCalledTimes(1);
 expect(mocks.collections).toHaveBeenCalledTimes(1);
 const saves=mocks.auth.savePreferences.mock.calls.length;
 await tick(2*120000);
 expect(mocks.journey).toHaveBeenCalledTimes(5);
 expect(mocks.activities).toHaveBeenCalledTimes(1);
 expect(mocks.auth.savePreferences.mock.calls.length).toBe(saves);
});

it('picks up a rename made on another phone when returning to the app, and an idle check only asks for the revision',async()=>{
 const {refreshJourneyMetadata,createJourneySync}=await vi.importActual('../lib/journeyMetadataStore.js');
 const {fakeSupabase,memoryStorage}=await import('../test/journeyServer.js');
 const {rpc,server}=fakeSupabase({titles:{a:'Original'}});
 const journeySync=createJourneySync({owner:'owner',storage:memoryStorage()});await journeySync.ready();
 journeySync.configureScope(['a']);
 mocks.journey.mockImplementation(args=>refreshJourneyMetadata({...args,client:{rpc}}));
 render(<AutoCloudSync state={state('h1')} journeySync={journeySync}/>);await tick(5000);
 expect(journeySync.read().metadata.titles.a).toBe('Original');
 server.metadata.titles.a='Rename from device A';server.revision=2;
 await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
 expect(journeySync.read().metadata.titles.a).toBe('Rename from device A');
 const snapshots=server.calls.filter(([name])=>name==='journey_metadata_snapshot').length;
 await tick(2*120000);
 expect(server.calls.filter(([name])=>name==='journey_metadata_snapshot')).toHaveLength(snapshots);
 expect(server.calls.some(([name])=>name==='journey_apply_changes')).toBe(false);
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
it('Retry now runs a full pass even when nothing changed, and is queued if a pass is already running',async()=>{
 const {requestSync}=await import('../lib/syncNow.js');
 render(<AutoCloudSync state={state('h1')}/>);
 await tick(5000);expect(mocks.activities).toHaveBeenCalledTimes(1);
 // Nothing changed, but the person asked: it runs.
 await act(async()=>{requestSync();});await tick(0);
 expect(mocks.activities).toHaveBeenCalledTimes(2);
 // Asked again while a slow pass is running: run once more right after it, not dropped.
 let finish;mocks.activities.mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve({receipts:{},lastSync:'now'});}));
 await act(async()=>{requestSync();});await tick(0);
 expect(mocks.activities).toHaveBeenCalledTimes(3);
 await act(async()=>{requestSync();});await tick(0);
 expect(mocks.activities).toHaveBeenCalledTimes(3);
 await act(async()=>{finish();});await tick(0);
 expect(mocks.activities).toHaveBeenCalledTimes(4);
});

it('checks older rides against newly published segments every few hours even when nothing local changed',async()=>{
 render(<AutoCloudSync state={state('h1')}/>);
 await tick(5000);expect(mocks.activities).toHaveBeenCalledTimes(1);
 // A full backup also matched efforts; nothing more for now.
 await tick(3*120000);expect(mocks.efforts).not.toHaveBeenCalled();
 // Six hours on, unchanged history: only the light segment pass runs.
 await tick(6*3600*1000);
 expect(mocks.efforts).toHaveBeenCalledTimes(1);expect(mocks.activities).toHaveBeenCalledTimes(1);
 expect(mocks.efforts.mock.calls[0][1]).toMatchObject({ownerID:'owner'});
 await tick(3*120000);expect(mocks.efforts).toHaveBeenCalledTimes(1);
});
it('keeps going at the next check while older rides are still being matched',async()=>{
 mocks.efforts.mockResolvedValueOnce({pending:true,failure:null});
 render(<AutoCloudSync state={state('h1')}/>);
 await tick(5000);await tick(6*3600*1000);
 const after=mocks.efforts.mock.calls.length;
 await tick(120000);
 expect(mocks.efforts.mock.calls.length).toBe(after+1);
});

it('recovers existing sections immediately on startup without waiting for private backup',async()=>{
 render(<AutoCloudSync state={state('old-history')}/>);await tick(0);
 expect(mocks.publications).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({historyToken:'old-history'}),expect.anything(),expect.objectContaining({owner:'owner'}));
 expect(mocks.activities).not.toHaveBeenCalled();
});
it('publishes a native segment-save snapshot while private uploads remain in flight',async()=>{
 let complete;mocks.activities.mockImplementationOnce(()=>new Promise(resolve=>{complete=()=>resolve({receipts:{},lastSync:'now'});}));
 const view=render(<AutoCloudSync state={state('old-history')}/>);await tick(5000);
 expect(mocks.activities).toHaveBeenCalledTimes(1);
 const before=mocks.publications.mock.calls.length;
 view.rerender(<AutoCloudSync state={{...state('new-segment'),trips:[{id:'old-ride',details:{namedSegments:[{id:'section'}]}}]}}/>);await tick(0);
 expect(mocks.publications).toHaveBeenCalledTimes(before+1);
 await act(async()=>complete());
});
it('publishes sections even when private activity backup is disabled',async()=>{
 mocks.backupEnabled=false;
 render(<AutoCloudSync state={state('old-history')}/>);await tick(5000);
 expect(mocks.publications).toHaveBeenCalledTimes(1);expect(mocks.activities).not.toHaveBeenCalled();
 expect(mocks.settings).not.toHaveBeenCalled();expect(mocks.collections).not.toHaveBeenCalled();
});
it('automatically resumes a bounded backlog without waiting two minutes',async()=>{
 mocks.publications.mockResolvedValueOnce({published:3,pending:true}).mockResolvedValue({published:1,pending:false});
 render(<AutoCloudSync state={state('old-history')}/>);await tick(0);expect(mocks.publications).toHaveBeenCalledTimes(1);
 await tick(250);expect(mocks.publications).toHaveBeenCalledTimes(2);expect(mocks.activities).not.toHaveBeenCalled();
});
it('automatically retries offline-created sections when the connection returns',async()=>{
 let online=false;const spy=vi.spyOn(navigator,'onLine','get').mockImplementation(()=>online);
 try{
  render(<AutoCloudSync state={state('old-history')}/>);await tick(0);expect(mocks.publications).not.toHaveBeenCalled();
  online=true;await act(async()=>window.dispatchEvent(new Event('online')));
  expect(mocks.publications).toHaveBeenCalledTimes(1);
 }finally{spy.mockRestore();}
});
it('starts recovery after sign-in and does not publish a mismatched native account',async()=>{
 mocks.auth={...mocks.auth,status:'signedOut',session:null};
 const view=render(<AutoCloudSync state={state('old-history')}/>);await tick(0);expect(mocks.publications).not.toHaveBeenCalled();
 mocks.auth={...mocks.auth,status:'authenticated',session:{user:{id:'owner'}}};
 view.rerender(<AutoCloudSync state={state('old-history')}/>);await tick(0);expect(mocks.publications).toHaveBeenCalledTimes(1);
 view.rerender(<AutoCloudSync state={{...state('another'),ownerID:'someone-else'}}/>);await tick(0);expect(mocks.publications).toHaveBeenCalledTimes(1);
});
it('preserves a publication confirmation when an older backup checkpoint finishes later',async()=>{
 const key='mtb-segment:section';let finish;
 mocks.publications.mockImplementation(async(_client,_state,receipts,{checkpoint})=>{
  await checkpoint({...receipts,[key]:{publicationAt:200,confirmedAt:200,uploaded:true}});return {published:1,pending:false};
 });
 mocks.activities.mockImplementationOnce(async(_client,_state,_receipts,{checkpoint})=>{
  await new Promise(resolve=>{finish=resolve;});
  const receipts={trip:{revision:4},[key]:{publicationAt:100,failed:'older attempt'}};await checkpoint(receipts);return {receipts,lastSync:'now'};
 });
 render(<AutoCloudSync state={state('old-history')}/>);await tick(5000);await act(async()=>finish());
 expect(mocks.auth.preferences.syncReceipts[key]).toMatchObject({confirmedAt:200,uploaded:true});
 expect(mocks.auth.preferences.syncReceipts.trip.revision).toBe(4);
});

it('writes why a backup failed to the diagnostic log, once per reason, never the activity data',async()=>{
 mocks.activities.mockRejectedValue(new Error('Cloud activity conflict; reload before overwriting (activity 3f2a9c10)'));
 const view=render(<AutoCloudSync state={state('h1')}/>);
 await tick(5000);
 expect(mocks.noteBackupFailure).toHaveBeenCalledTimes(1);
 expect(mocks.noteBackupFailure).toHaveBeenCalledWith('Cloud activity conflict; reload before overwriting (activity 3f2a9c10)');
 // The same failure at the next checks is not logged again; a different one is.
 view.rerender(<AutoCloudSync state={state('h2')}/>);
 await tick(120000);
 expect(mocks.noteBackupFailure).toHaveBeenCalledTimes(1);
 mocks.activities.mockRejectedValue(new Error('Failed to fetch'));
 view.rerender(<AutoCloudSync state={state('h3')}/>);
 await tick(120000);
 expect(mocks.noteBackupFailure).toHaveBeenLastCalledWith('Failed to fetch');
});

it('backs up a recording that has just finished within seconds, not at the next two-minute check',async()=>{
 const view=render(<AutoCloudSync state={state('h1')}/>);
 await tick(5000);
 expect(mocks.activities).toHaveBeenCalledTimes(1);
 view.rerender(<AutoCloudSync state={state('h2')}/>);
 await tick(3000);
 expect(mocks.activities).toHaveBeenCalledTimes(2);
});
it('tells household sharing each time an activity has been backed up, not for any other checkpoint',async()=>{
 const heard=vi.fn();window.addEventListener('letm3go:backed-up',heard);
 mocks.activities.mockImplementation(async(_c,_s,receipts,{checkpoint,onBackedUp})=>{await checkpoint({...receipts,place:{owner:'owner'}});onBackedUp();await checkpoint({...receipts,a:{revision:1}});return {receipts,lastSync:'now'};});
 render(<AutoCloudSync state={state('h1')}/>);
 await tick(5000);
 expect(heard).toHaveBeenCalledTimes(1);
 window.removeEventListener('letm3go:backed-up',heard);
});
it('keeps what went up when some activities were refused, reports the refusal once, and comes back to it when it is due',async()=>{
 const problem=Object.assign(new Error('1 activity could not be backed up (Cloud activity conflict; activity 3f2a9c10)'),{key:'Cloud activity conflict'});
 mocks.activities.mockResolvedValue({receipts:{a:{revision:1}},uploaded:2,problem,nextRetryAt:Date.now()+60000,pending:false,lastSync:'now'});
 render(<AutoCloudSync state={state('h1')}/>);
 await tick(5000);
 expect(mocks.noteBackupFailure).toHaveBeenCalledWith(problem.message);
 expect(mocks.activities).toHaveBeenCalledTimes(1);
 await tick(62000);
 expect(mocks.activities.mock.calls.length).toBeGreaterThan(1);   // came back at the time the refused activity was due
 expect(mocks.noteBackupFailure).toHaveBeenCalledTimes(1);        // the same refusal is not logged again
});
it('does not run an extra pass just because the history was first read',async()=>{
 render(<AutoCloudSync state={state('h1')}/>);
 await tick(2600);
 expect(mocks.activities).not.toHaveBeenCalled();                // only the five-second opening pass runs
 await tick(2500);
 expect(mocks.activities).toHaveBeenCalledTimes(1);
});
