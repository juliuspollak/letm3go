import {cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';

// Friend sharing must keep publishing from a closed or relaunched phone, so the
// native uploader is armed with a device credential, and is never disarmed just
// because the server setting has not loaded yet.
const mock=vi.hoisted(()=>({rpc:vi.fn(),configure:vi.fn(),getState:vi.fn(),responses:{}}));
vi.mock('./supabase.js',()=>({supabase:{rpc:mock.rpc,auth:{getSession:async()=>({data:{session:{user:{id:'julia'},access_token:'t'.repeat(120),expires_at:Date.now()/1000+3600}}})}}}));
vi.mock('./config.js',()=>({config:{url:'https://example.supabase.co',key:'sb_publishable_test'}}));
vi.mock('./recorder.js',()=>({recorderAvailable:()=>true,recorder:{configureLiveSharing:mock.configure,getState:mock.getState,currentPosition:vi.fn()}}));
vi.mock('./sharedPosition.js',()=>({sharedPosition:vi.fn()}));
import {useFriendLocations} from './useFriendLocations.js';

const token='b'.repeat(64);
beforeEach(()=>{
 mock.responses={my_friend_location_setting:{data:true},my_friend_locations:{data:[]},
  issue_my_friend_location_token:{data:[{publish_token:token,valid_until:'2026-12-11T08:00:00Z'}]}};
 mock.rpc.mockImplementation(async name=>mock.responses[name]||{data:null,error:null});
 mock.getState.mockResolvedValue({nativeFamilySharing:{friendArmed:false}});
 mock.configure.mockReset();mock.configure.mockResolvedValue();
});
afterEach(cleanup);

it('arms the native uploader with a device credential once sharing is on',async()=>{
 renderHook(()=>useFriendLocations('julia',true));
 await waitFor(()=>expect(mock.configure).toHaveBeenCalledWith(expect.objectContaining({
  enabled:true,channel:'friends',publishToken:token,endpoint:'https://example.supabase.co/rest/v1/rpc/publish_friend_location'})));
});
it('does not reissue a credential the phone already holds for more than a week',async()=>{
 mock.getState.mockResolvedValue({nativeFamilySharing:{friendArmed:true,friendMode:'device',friendTokenExpiresAt:Date.now()/1000+20*86400}});
 const {result}=renderHook(()=>useFriendLocations('julia',true));
 await waitFor(()=>expect(result.current.ready).toBe(true));
 await new Promise(resolve=>setTimeout(resolve,30));
 expect(mock.rpc).not.toHaveBeenCalledWith('issue_my_friend_location_token');
});
it('falls back to the session token until the database is migrated',async()=>{
 mock.responses.issue_my_friend_location_token={error:{code:'PGRST202',message:'Could not find the function'}};
 renderHook(()=>useFriendLocations('julia',true));
 await waitFor(()=>expect(mock.configure).toHaveBeenCalledWith(expect.objectContaining({channel:'friends',accessToken:'t'.repeat(120)})));
});
it('never disarms the native uploader before the sharing setting has loaded',async()=>{
 mock.rpc.mockImplementation(()=>new Promise(()=>{}));
 renderHook(()=>useFriendLocations('julia',true));
 await new Promise(resolve=>setTimeout(resolve,50));
 expect(mock.configure).not.toHaveBeenCalled();
});
it('disarms once the server says sharing is off',async()=>{
 mock.responses.my_friend_location_setting={data:false};
 renderHook(()=>useFriendLocations('julia',true));
 await waitFor(()=>expect(mock.configure).toHaveBeenCalledWith({enabled:false,channel:'friends'}));
});
