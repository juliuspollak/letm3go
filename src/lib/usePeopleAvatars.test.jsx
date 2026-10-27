import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('./supabase.js',()=>({supabase:mock}));
import {usePeopleAvatars} from './usePeopleAvatars.js';
const photo='data:image/jpeg;base64,AAAA';
beforeEach(()=>{mock.rpc.mockImplementation(async name=>({data:name==='my_household'?[{id:'household'}]:name==='my_household_member_avatars'?[{user_id:'person',avatar_data:photo}]:null}));});
afterEach(cleanup);
it('uses the existing household-authorized photo source for all views',async()=>{
 const {result}=renderHook(()=>usePeopleAvatars('owner',true,photo));
 await waitFor(()=>expect(result.current.photos).toEqual({person:photo}));
 expect(mock.rpc).toHaveBeenCalledWith('save_my_household_avatar',{p_avatar:photo});
 expect(mock.rpc).toHaveBeenCalledWith('my_household_member_avatars');
});
it('does not publish or fetch household photos without membership',async()=>{
 mock.rpc.mockResolvedValue({data:[]});
 const {result}=renderHook(()=>usePeopleAvatars('owner',true,photo));
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('my_household'));
 expect(result.current.photos).toEqual({});
 expect(mock.rpc).not.toHaveBeenCalledWith('save_my_household_avatar',expect.anything());
 expect(mock.rpc).not.toHaveBeenCalledWith('my_household_member_avatars');
});
it('does not erase a shared photo when this device has no local profile image',async()=>{
 const {result}=renderHook(()=>usePeopleAvatars('owner',true,null));
 await waitFor(()=>expect(result.current.photos).toEqual({person:photo}));
 expect(mock.rpc).not.toHaveBeenCalledWith('save_my_household_avatar',expect.anything());
});
it('does not expose a previous account photo while a new account is loading',async()=>{
 const {result,rerender}=renderHook(({owner})=>usePeopleAvatars(owner,true,photo),{initialProps:{owner:'owner-a'}});
 await waitFor(()=>expect(result.current.photos).toEqual({person:photo}));
 mock.rpc.mockImplementation(()=>new Promise(()=>{}));
 rerender({owner:'owner-b'});
 expect(result.current.photos).toEqual({});
});
it('removes photos after leaving the household and refreshing membership',async()=>{
 const {result}=renderHook(()=>usePeopleAvatars('owner',true,photo));
 await waitFor(()=>expect(result.current.photos).toEqual({person:photo}));
 mock.rpc.mockResolvedValue({data:[]});
 act(()=>result.current.refresh());
 await waitFor(()=>expect(result.current.photos).toEqual({}));
});
