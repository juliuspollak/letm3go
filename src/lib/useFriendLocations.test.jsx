import {act,renderHook,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn(),position:vi.fn()}));
vi.mock('./supabase.js',()=>({supabase:{rpc:mock.rpc,auth:{getSession:async()=>({data:{session:null}})}}}));
vi.mock('./recorder.js',()=>({recorderAvailable:()=>false,recorder:{configureLiveSharing:vi.fn().mockResolvedValue()}}));
vi.mock('./sharedPosition.js',()=>({sharedPosition:mock.position}));
import {useFriendLocations} from './useFriendLocations.js';

let setting=false;
beforeEach(()=>{
 setting=false;
 mock.position.mockResolvedValue({latitude:-33.86,longitude:151.2,accuracy:10});
 mock.rpc.mockImplementation(async(name,params)=>{
  if(name==='my_friend_location_setting')return {data:setting,error:null};
  if(name==='my_friend_locations')return {data:[],error:null};
  if(name==='set_friend_location'){setting=params.p_enabled;return {data:null,error:null};}
  return {data:null,error:null};
 });
});

it('is not ready, and not shown as off, until the server has answered',async()=>{
 setting=true;
 const {result}=renderHook(()=>useFriendLocations('me',true));
 expect(result.current).toMatchObject({ready:false,enabled:false});
 await waitFor(()=>expect(result.current).toMatchObject({ready:true,enabled:true}));
 // On, but nothing has been delivered from this app yet.
 expect(result.current.lastSentAt).toBe(0);
});
it('records a confirmed send only when the server accepted the position',async()=>{
 const {result}=renderHook(()=>useFriendLocations('me',true));
 await waitFor(()=>expect(result.current.ready).toBe(true));
 await act(()=>result.current.setSharing(true));
 expect(result.current.enabled).toBe(true);
 expect(result.current.lastSentAt).toBeGreaterThan(0);
 await act(()=>result.current.setSharing(false));
 expect(result.current).toMatchObject({enabled:false,lastSentAt:0});
});
it('leaves the setting unchanged when an update fails',async()=>{
 const {result}=renderHook(()=>useFriendLocations('me',true));
 await waitFor(()=>expect(result.current.ready).toBe(true));
 mock.rpc.mockImplementation(async name=>name==='set_friend_location'?{data:null,error:new Error('offline')}:{data:name==='my_friend_location_setting'?false:[],error:null});
 await act(async()=>{await expect(result.current.setSharing(true)).rejects.toThrow('offline');});
 expect(result.current).toMatchObject({enabled:false,lastSentAt:0});
});
it('does not ask for a position when location is unavailable, and stays off',async()=>{
 mock.position.mockRejectedValue(new Error('Location permission is off.'));
 const {result}=renderHook(()=>useFriendLocations('me',true));
 await waitFor(()=>expect(result.current.ready).toBe(true));
 await act(async()=>{await expect(result.current.setSharing(true)).rejects.toThrow('Location permission is off.');});
 expect(mock.rpc).not.toHaveBeenCalledWith('set_friend_location',expect.anything());
 expect(result.current.enabled).toBe(false);
});
