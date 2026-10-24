import { expect, it, vi } from 'vitest';
import { accountDisplayName, ensureUserProfile, verifyAccountSession, saveProfileName } from './userProfile.js';
const user={id:'owner',email:'relay@privaterelay.appleid.com',user_metadata:{full_name:'Apple Person'}};
function setup(reads,created){const q={};for(const name of ['select','eq','insert','update'])q[name]=vi.fn(()=>q);q.maybeSingle=vi.fn();for(const r of reads)q.maybeSingle.mockResolvedValueOnce(r);q.single=vi.fn().mockResolvedValue(created);return {q,client:{from:vi.fn(()=>q)}};}
it('creates only the verified user profile with minimal granted columns',async()=>{
 const {q,client}=setup([{data:null}],{data:{id:user.id,display_name:'Apple Person'}});
 expect(await ensureUserProfile(client,user)).toEqual({id:user.id,display_name:'Apple Person'});expect(q.insert).toHaveBeenCalledWith({id:'owner',display_name:'Apple Person'});expect(q.eq).toHaveBeenCalledWith('id','owner');
});
it('preserves existing names when Apple omits subsequent name/email',async()=>{
 const {q,client}=setup([{data:{id:'owner',display_name:'Chosen name'}}]);
 expect((await ensureUserProfile(client,{id:'owner'})).display_name).toBe('Chosen name');expect(q.insert).not.toHaveBeenCalled();expect(q.update).not.toHaveBeenCalled();expect(accountDisplayName({email:user.email})).toBe('');
});
it('fills an empty name without overwriting a concurrently chosen name',async()=>{
 const {q,client}=setup([{data:{id:'owner',display_name:''}},{data:{id:'owner',display_name:'Apple Person'}}]);await ensureUserProfile(client,user);expect(q.update).toHaveBeenCalledWith({display_name:'Apple Person'});expect(q.eq).toHaveBeenCalledWith('display_name','');
});
it('recovers a duplicate insert race and rejects a wrong owner response',async()=>{
 const {client}=setup([{data:null},{data:{id:'owner',display_name:'Saved'}}],{error:{code:'23505'}});expect((await ensureUserProfile(client,user)).display_name).toBe('Saved');
 const wrong=setup([{data:{id:'other',display_name:'Other'}}]);await expect(ensureUserProfile(wrong.client,user)).rejects.toThrow('match');
});
it('reports RLS/profile failures without leaking server error details',async()=>{
 const {client}=setup([{error:new Error('sensitive internals')}]);await expect(ensureUserProfile(client,user)).rejects.toThrow('could not be loaded');
});
it('verifies the current Supabase access token and profile owner before reporting Apple sign-in',async()=>{
 const {client}=setup([{data:{id:'owner',display_name:'Saved'}}]);client.auth={getUser:vi.fn().mockResolvedValue({data:{user:{...user,identities:[{provider:'apple'}]}}})};
 expect(await verifyAccountSession(client,{access_token:'test-session-token',user})).toEqual({userID:'owner',provider:'Apple',profileVerified:true});expect(client.auth.getUser).toHaveBeenCalledWith('test-session-token');
 client.auth.getUser.mockResolvedValue({data:{user:{id:'other'}}});await expect(verifyAccountSession(client,{access_token:'test',user})).rejects.toThrow('could not be verified');
 client.auth.getUser.mockResolvedValue({error:{status:401}});await expect(verifyAccountSession(client,{access_token:'test',user})).rejects.toThrow('could not be verified');
});
it('synchronizes an edited name only to the authenticated profile',async()=>{
 const {q,client}=setup([{data:{id:'owner',display_name:'Original'}}],{data:{id:'owner'}});await saveProfileName(client,user,'Chosen name');expect(q.update).toHaveBeenCalledWith({display_name:'Chosen name'});expect(q.eq).toHaveBeenCalledWith('id','owner');
});
it('times out a stalled Auth request instead of leaving the check busy forever',async()=>{
 const client={auth:{getUser:()=>new Promise(()=>{})}};
 await expect(verifyAccountSession(client,{access_token:'test',user},{timeoutMs:5})).rejects.toThrow('sign-in check timed out');
});
it('reports verified authentication separately when the profile request stalls',async()=>{
 const {q,client}=setup([]);client.auth={getUser:async()=>({data:{user:{...user,identities:[{provider:'apple'}]}}})};q.maybeSingle.mockImplementation(()=>new Promise(()=>{}));const onProgress=vi.fn();
 await expect(verifyAccountSession(client,{access_token:'test',user},{timeoutMs:5,onProgress})).rejects.toThrow('Apple sign-in verified. Account ending owner. Your profile check did not complete.');expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Checking your profile'));
});
