import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({native:vi.fn(),signIn:vi.fn(),exchange:vi.fn(),update:vi.fn(),invoke:vi.fn(),oauth:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>true},registerPlugin:()=>({signInWithApple:m.native})}));
vi.mock('./config.js',()=>({config:{appleEnabled:true}}));
vi.mock('./sessionStorage.js',()=>({authStorage:{setItem:vi.fn(),removeItem:vi.fn()}}));
vi.mock('./supabase.js',()=>({supabase:{auth:{signInWithIdToken:m.signIn,updateUser:m.update,signInWithOAuth:m.oauth,exchangeCodeForSession:m.exchange},functions:{invoke:m.invoke}}}));
import { signInWithApple } from './auth.js';
const user={id:'apple-owner',email:'private@privaterelay.appleid.com',email_confirmed_at:'2026-10-25',identities:[{provider:'apple'}]};
beforeEach(()=>{vi.resetAllMocks();m.native.mockResolvedValue({idToken:'test-apple-id-token',nonce:'test-raw-nonce',name:'Apple Person',authorizationCode:'test-code'});m.signIn.mockResolvedValue({data:{user,session:{user,access_token:'test-supabase-token'}},error:null});m.update.mockResolvedValue({error:null});m.invoke.mockResolvedValue({error:null});});
it('exchanges a native ID token and raw nonce without browser OAuth or email login',async()=>{
 expect(await signInWithApple()).toMatchObject({userID:user.id,cancelled:false});
 expect(m.signIn).toHaveBeenCalledWith({provider:'apple',token:'test-apple-id-token',nonce:'test-raw-nonce'});
 expect(m.update).toHaveBeenCalledWith({data:{full_name:'Apple Person'}});
 expect(m.invoke).toHaveBeenCalledWith('account',{body:{action:'captureAppleAuthorization',code:'test-code'}});
 expect(m.oauth).not.toHaveBeenCalled();
});
it('treats cancellation as a retryable user choice and never calls Supabase',async()=>{
 m.native.mockRejectedValue({code:'APPLE_SIGN_IN_CANCELLED'});expect(await signInWithApple()).toEqual({cancelled:true});expect(m.signIn).not.toHaveBeenCalled();
});
it('accepts private relay and subsequent credentials without name or email without erasing metadata',async()=>{
 m.native.mockResolvedValue({idToken:'test-apple-id-token',nonce:'test-raw-nonce'});
 expect(await signInWithApple()).toMatchObject({userID:user.id});expect(m.update).not.toHaveBeenCalled();
});
it('rejects missing credentials and rejected or mismatched sessions',async()=>{
 m.native.mockResolvedValueOnce({});await expect(signInWithApple()).rejects.toThrow('credentials');expect(m.signIn).not.toHaveBeenCalled();
 m.signIn.mockResolvedValueOnce({data:{},error:new Error('Nonce rejected')});await expect(signInWithApple()).rejects.toThrow('Nonce rejected');
 m.signIn.mockResolvedValueOnce({data:{user,session:{user:{id:'other'}}}});await expect(signInWithApple()).rejects.toThrow('session');
});
it('preserves successful login when optional profile or revocation setup needs attention',async()=>{
 const events=[];const listener=event=>events.push(event.detail);window.addEventListener('letm3go:integration-warning',listener);
 try{m.update.mockResolvedValue({error:new Error('Offline')});m.invoke.mockResolvedValue({error:new Error('Function absent')});await expect(signInWithApple()).resolves.toMatchObject({userID:user.id});expect(events).toHaveLength(2);expect(events.every(e=>e.ownerID===user.id)).toBe(true);}finally{window.removeEventListener('letm3go:integration-warning',listener);}
});
