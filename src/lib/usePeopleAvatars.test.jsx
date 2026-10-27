import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('./supabase.js',()=>({supabase:mock}));
import {usePeopleAvatars} from './usePeopleAvatars.js';
const photo='data:image/jpeg;base64,AAAA';
const png='data:image/png;base64,BBBB';
beforeEach(()=>{mock.rpc.mockImplementation(async name=>({data:name==='my_household'?[{id:'household'}]:name==='my_people_avatars'?[{user_id:'person',avatar_data:photo}]:name==='my_household_member_avatars'?[{user_id:'person',avatar_data:photo}]:null}));});
afterEach(cleanup);
it('uses one authorized photo source and always includes your own photo by id',async()=>{
 const {result}=renderHook(()=>usePeopleAvatars('owner',true,photo));
 await waitFor(()=>expect(result.current.photos).toEqual({owner:photo,person:photo}));
 expect(mock.rpc).toHaveBeenCalledWith('save_my_household_avatar',{p_avatar:photo});
 expect(mock.rpc).toHaveBeenCalledWith('my_people_avatars');
});
it('falls back to the household helper on databases without the people lookup',async()=>{
 mock.rpc.mockImplementation(async name=>({data:name==='my_household'?[{id:'household'}]:name==='my_people_avatars'?null:name==='my_household_member_avatars'?[{user_id:'person',avatar_data:photo}]:null,error:name==='my_people_avatars'?{message:'missing function'}:null}));
 const {result}=renderHook(()=>usePeopleAvatars('owner',true,photo));
 await waitFor(()=>expect(result.current.photos).toEqual({owner:photo,person:photo}));
 expect(mock.rpc).toHaveBeenCalledWith('my_household_member_avatars');
});
it('keeps your own photo without a household and never publishes it',async()=>{
 mock.rpc.mockResolvedValue({data:[]});
 const {result}=renderHook(()=>usePeopleAvatars('owner',true,photo));
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('my_household'));
 await waitFor(()=>expect(result.current.photos).toEqual({owner:photo}));
 expect(mock.rpc).not.toHaveBeenCalledWith('save_my_household_avatar',expect.anything());
});
it('does not erase shared photos when the avatar upload is rejected',async()=>{
 mock.rpc.mockImplementation(async name=>name==='save_my_household_avatar'?{error:{message:'Invalid or oversized avatar image'}}:({data:name==='my_household'?[{id:'household'}]:name==='my_people_avatars'?[{user_id:'person',avatar_data:photo}]:null}));
 const {result}=renderHook(()=>usePeopleAvatars('owner',true,photo));
 await waitFor(()=>expect(result.current.photos.person).toBe(photo));
 expect(mock.rpc).toHaveBeenCalledWith('save_my_household_avatar',{p_avatar:photo});
});
it('still shows a PNG from an older account while this WebView cannot convert it',async()=>{
 const {result}=renderHook(()=>usePeopleAvatars('owner',true,png));
 await waitFor(()=>expect(result.current.photos).toEqual({owner:png,person:photo}));
 expect(mock.rpc).not.toHaveBeenCalledWith('save_my_household_avatar',expect.anything());
});
it('does not erase a shared photo when this device has no local profile image',async()=>{
 const {result}=renderHook(()=>usePeopleAvatars('owner',true,null));
 await waitFor(()=>expect(result.current.photos).toEqual({person:photo}));
 expect(mock.rpc).not.toHaveBeenCalledWith('save_my_household_avatar',expect.anything());
});
it('does not expose a previous account photo while a new account is loading',async()=>{
 const {result,rerender}=renderHook(({owner,avatar})=>usePeopleAvatars(owner,true,avatar),{initialProps:{owner:'owner-a',avatar:photo}});
 await waitFor(()=>expect(result.current.photos).toEqual({'owner-a':photo,person:photo}));
 mock.rpc.mockImplementation(()=>new Promise(()=>{}));
 rerender({owner:'owner-b',avatar:null});
 expect(result.current.photos).toEqual({});
});
it('removes shared photos after leaving the household but keeps your own',async()=>{
 const {result}=renderHook(()=>usePeopleAvatars('owner',true,photo));
 await waitFor(()=>expect(result.current.photos).toEqual({owner:photo,person:photo}));
 mock.rpc.mockResolvedValue({data:[]});
 act(()=>result.current.refresh());
 await waitFor(()=>expect(result.current.photos).toEqual({owner:photo}));
});
