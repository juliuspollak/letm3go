import {render,cleanup,act} from '@testing-library/react';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const mocks=vi.hoisted(()=>({activities:vi.fn(),settings:vi.fn(),collections:vi.fn(),auth:null}));
vi.mock('../lib/AuthContext.jsx',()=>({useAuth:()=>mocks.auth}));
vi.mock('../lib/supabase.js',()=>({supabase:{}}));
vi.mock('../lib/config.js',()=>({config:{backupEnabled:true}}));
vi.mock('../lib/cloudSync.js',()=>({syncPrivateActivities:mocks.activities}));
vi.mock('../lib/settingsSync.js',()=>({syncAccountSettings:mocks.settings}));
vi.mock('../lib/collectionSync.js',()=>({syncCollections:mocks.collections}));
import AutoCloudSync from './AutoCloudSync.jsx';

const state=(token)=>({ownerID:'owner',historyToken:token,places:[],deletedIDs:[],trips:[]});
beforeEach(()=>{
 vi.useFakeTimers();
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
 // The existing 2-minute throttle counts from the first attempt (at 5 s).
 await tick(5000);await tick(2*120000);
 expect(mocks.activities).toHaveBeenCalledTimes(2);
});
