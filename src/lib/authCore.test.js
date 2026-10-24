import { expect, it, vi } from 'vitest';
import { resolveIdentity } from './authCore.js';
const session={access_token:'test-token',user:{id:'owner',email_confirmed_at:'2026-10-24'}};
function setup(result={data:{user:session.user}}){return {client:{auth:{getUser:vi.fn().mockResolvedValue(result)}},store:{bind:vi.fn().mockResolvedValue({ownerID:'owner',preferences:{onboardingComplete:true}})},session};}
it('verifies a restored identity before unlocking local storage',async()=>{
 const options=setup();const result=await resolveIdentity(options);expect(result.status).toBe('authenticated');expect(options.store.bind).toHaveBeenCalledWith(session,undefined,{offline:false});
});
it('retains local GPS for an offline previously verified session instead of clearing it',async()=>{
 const options=setup({error:Object.assign(new Error('Offline'),{name:'AuthRetryableFetchError'})});expect((await resolveIdentity(options)).status).toBe('offline');expect(options.store.bind).toHaveBeenCalledWith(session,undefined,{offline:true});
});
it('does not unlock storage for an expired/revoked token or unconfirmed email',async()=>{
 const revoked=setup({error:{status:401,message:'Expired'}});await expect(resolveIdentity(revoked)).rejects.toMatchObject({status:401});expect(revoked.store.bind).not.toHaveBeenCalled();
 const unconfirmed=setup({data:{user:{id:'owner'}}});expect((await resolveIdentity(unconfirmed)).status).toBe('verification');expect(unconfirmed.store.bind).not.toHaveBeenCalled();
});
it('rejects cross-account server responses and stale account-switch tasks',async()=>{
 const wrong=setup({data:{user:{...session.user,id:'other'}}});await expect(resolveIdentity(wrong)).rejects.toThrow('mismatch');expect(wrong.store.bind).not.toHaveBeenCalled();
 const stale=setup();await expect(resolveIdentity({...stale,isCurrent:()=>false})).rejects.toThrow('changed');expect(stale.store.bind).not.toHaveBeenCalled();
});
it('keeps a server-controlled pending deletion outside normal private application use',async()=>{
 const user={...session.user,app_metadata:{deletion_requested:true}};const options=setup({data:{user}});
 expect((await resolveIdentity(options)).status).toBe('deletionPending');
});
