import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';

// The client half of household sharing: loading member states, recovering from
// failures and foreground transitions, and arming the native background uploader.
const mock=vi.hoisted(()=>({rpc:vi.fn(),getSession:vi.fn(),configure:vi.fn(),getState:vi.fn(),currentPosition:vi.fn(),addListener:vi.fn(),foreground:null,responses:{}}));
vi.mock('./supabase.js',()=>({supabase:{rpc:mock.rpc,auth:{getSession:mock.getSession}}}));
vi.mock('./config.js',()=>({config:{url:'https://example.supabase.co',key:'sb_publishable_test'}}));
vi.mock('@capacitor/app',()=>({App:{addListener:mock.addListener}}));
vi.mock('./recorder.js',()=>({recorderAvailable:()=>true,recorder:{configureLiveSharing:mock.configure,getState:mock.getState,currentPosition:mock.currentPosition}}));
import {loadHouseholdLocations,useHouseholdPresence} from './useHouseholdPresence.js';

const anna={user_id:'anna',display_name:'Anna',sharing_enabled:true,latitude:-33.87,longitude:151.21,accuracy_m:12,location_at:'2026-11-04T07:58:00Z',server_now:'2026-11-04T08:00:00Z'};
const token='a'.repeat(64);
function respond(name,value){mock.responses[name]=value;}
beforeEach(()=>{
 mock.responses={};
 respond('my_presence_settings',{data:[{sharing_enabled:false}]});
 respond('my_household_presence',{data:[]});
 respond('my_live_location_settings',{data:[{enabled:true}]});
 respond('my_household_location_status',{data:[anna]});
 respond('issue_my_live_location_token',{data:[{publish_token:token,valid_until:'2026-12-04T08:00:00Z'}]});
 respond('set_my_live_location',{error:null});
 mock.rpc.mockImplementation(async name=>{const value=mock.responses[name];if(value instanceof Error)throw value;return value||{data:null,error:null};});
 mock.getState.mockResolvedValue({nativeFamilySharing:{armed:false}});
 mock.configure.mockResolvedValue();
 mock.currentPosition.mockResolvedValue({latitude:-33.86,longitude:151.2,accuracy:10,speed:0,timestamp:Date.now()/1000});
 mock.addListener.mockImplementation(async(event,callback)=>{mock.foreground=callback;return {remove:vi.fn()};});
});
afterEach(cleanup);

it('loads every household member with their state, not just members seen in the last 90 seconds',async()=>{
 const {result}=renderHook(()=>useHouseholdPresence('julius',true));
 await waitFor(()=>expect(result.current.liveReady).toBe(true));
 expect(result.current.liveMembers).toEqual([anna]);
 expect(result.current.livePeople).toEqual([anna]);
 expect(mock.rpc).toHaveBeenCalledWith('my_household_location_status');
});
it('keeps members without a position in the member list but off the map list',async()=>{
 const waiting={...anna,latitude:null,longitude:null,location_at:null};
 respond('my_household_location_status',{data:[waiting]});
 const {result}=renderHook(()=>useHouseholdPresence('julius',true));
 await waitFor(()=>expect(result.current.liveMembers).toEqual([waiting]));
 expect(result.current.livePeople).toEqual([]);
});
it('falls back to the earlier RPC until the database migration is applied',async()=>{
 respond('my_household_location_status',{data:null,error:{code:'PGRST202',message:'Could not find the function'}});
 respond('my_household_live_locations',{data:[{user_id:'anna',display_name:'Anna',latitude:-33.87,longitude:151.21,accuracy_m:12,updated_at:'2026-11-04T07:59:30Z'}]});
 const rows=await loadHouseholdLocations();
 expect(rows[0]).toMatchObject({user_id:'anna',sharing_enabled:true,location_at:'2026-11-04T07:59:30Z'});
 respond('my_household_location_status',{data:null,error:{code:'42501',message:'permission denied'}});
 await expect(loadHouseholdLocations()).rejects.toThrow(/could not be loaded/);
});
it('survives a temporary network failure without blanking the map, then recovers on the next foreground',async()=>{
 const {result}=renderHook(()=>useHouseholdPresence('julius',true));
 await waitFor(()=>expect(result.current.livePeople).toHaveLength(1));
 respond('my_household_location_status',new Error('Failed to fetch'));
 await act(async()=>{await result.current.refreshLive();});
 expect(result.current.liveError).not.toBe('');
 expect(result.current.livePeople).toEqual([anna]);
 // A missed update: the next foreground fetch restores the current state.
 const moved={...anna,latitude:-33.9,location_at:'2026-11-04T08:05:00Z',server_now:'2026-11-04T08:05:10Z'};
 respond('my_household_location_status',{data:[moved]});
 await act(async()=>{await mock.foreground({isActive:true});});
 await waitFor(()=>expect(result.current.livePeople[0]?.latitude).toBe(-33.9));
 expect(result.current.liveError).toBe('');
});
it('reloads locations when the app is reopened',async()=>{
 const {result}=renderHook(()=>useHouseholdPresence('julius',true));
 await waitFor(()=>expect(result.current.liveReady).toBe(true));
 const before=mock.rpc.mock.calls.filter(([name])=>name==='my_household_location_status').length;
 await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
 await waitFor(()=>expect(mock.rpc.mock.calls.filter(([name])=>name==='my_household_location_status').length).toBeGreaterThan(before));
});
it('arms the native uploader with a device credential so a locked phone keeps sharing',async()=>{
 renderHook(()=>useHouseholdPresence('julius',true));
 await waitFor(()=>expect(mock.configure).toHaveBeenCalledWith(expect.objectContaining({enabled:true,publishToken:token,endpoint:'https://example.supabase.co/rest/v1/rpc/publish_live_location',apiKey:'sb_publishable_test'})));
 expect(mock.configure.mock.calls.at(-1)[0].expiresAt).toBe(Date.parse('2026-12-04T08:00:00Z')/1000);
 expect(mock.configure.mock.calls.at(-1)[0]).not.toHaveProperty('accessToken');
});
it('does not reissue a credential the phone already holds for more than a week',async()=>{
 mock.getState.mockResolvedValue({nativeFamilySharing:{armed:true,mode:'device',tokenExpiresAt:Date.now()/1000+20*86400}});
 renderHook(()=>useHouseholdPresence('julius',true));
 await waitFor(()=>expect(mock.getState).toHaveBeenCalled());
 await new Promise(resolve=>setTimeout(resolve,20));
 expect(mock.rpc).not.toHaveBeenCalledWith('issue_my_live_location_token');
});
it('disarms the native uploader when sharing is off',async()=>{
 respond('my_live_location_settings',{data:[{enabled:false}]});
 const {result}=renderHook(()=>useHouseholdPresence('julius',true));
 await waitFor(()=>expect(result.current.liveReady).toBe(true));
 await waitFor(()=>expect(mock.configure).toHaveBeenCalledWith({enabled:false}));
 expect(mock.rpc).not.toHaveBeenCalledWith('issue_my_live_location_token');
});
