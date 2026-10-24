import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext.jsx';
const mocks=vi.hoisted(()=>({callback:null,user:null,session:null,auth:{getSession:vi.fn(),getUser:vi.fn(),onAuthStateChange:vi.fn(),signOut:vi.fn(),startAutoRefresh:vi.fn(),stopAutoRefresh:vi.fn()},store:{bind:vi.fn(),lock:vi.fn(),save:vi.fn()},storage:{getItem:vi.fn(),removeItem:vi.fn()},stopPush:vi.fn()}));
vi.mock('./supabase.js',()=>({supabase:{auth:mocks.auth}}));
vi.mock('./sessionStorage.js',()=>({AUTH_STORAGE_KEY:'letm3go-auth',authStorage:mocks.storage,accountStore:mocks.store,defaultPreferences:()=>({onboardingComplete:false,vehicles:[]})}));
vi.mock('./config.js',()=>({config:{key:'test-public-key'}}));
vi.mock('./auth.js',()=>({listenForNativeAuth:async()=>()=>{},authRedirect:()=>''}));
vi.mock('./pushAccount.js',()=>({stopAccountPush:mocks.stopPush,resumeAccountPush:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>false},registerPlugin:()=>({})}));
function Probe(){const value=useAuth();return <><p role="status">{value.status}:{value.session?.user.id||'none'}</p><button onClick={()=>void value.signOut()}>Logout</button><button onClick={()=>void value.savePreferences({displayName:'Changed'})}>Save name</button></>;}
beforeEach(()=>{
 mocks.user={id:'owner-a',email_confirmed_at:'2026-10-24'};mocks.session={access_token:'test',user:mocks.user};
 mocks.auth.getSession.mockImplementation(async()=>({data:{session:mocks.session}}));mocks.auth.getUser.mockImplementation(async()=>({data:{user:mocks.user}}));mocks.auth.onAuthStateChange.mockImplementation(callback=>{mocks.callback=callback;return {data:{subscription:{unsubscribe:vi.fn()}}};});mocks.auth.signOut.mockResolvedValue({error:null});
 mocks.store.bind.mockImplementation(async session=>({ownerID:session.user.id,preferences:{displayName:'',vehicles:[],onboardingComplete:true}}));mocks.store.lock.mockResolvedValue();mocks.store.save.mockImplementation(async preferences=>({preferences}));mocks.storage.removeItem.mockResolvedValue();mocks.stopPush.mockResolvedValue();
});
afterEach(cleanup);
it('restores an authenticated returning user without resetting onboarding',async()=>{
 render(<AuthProvider><Probe/></AuthProvider>);expect(await screen.findByText('authenticated:owner-a')).toBeInTheDocument();expect(mocks.store.bind).toHaveBeenCalledWith(expect.objectContaining({user:expect.objectContaining({id:'owner-a'})}),'test-public-key',{offline:false});
});
it('locks native tracking and clears stored session on explicit sign-out',async()=>{
 render(<AuthProvider><Probe/></AuthProvider>);await screen.findByText('authenticated:owner-a');fireEvent.click(screen.getByRole('button',{name:'Logout'}));await screen.findByText('signedOut:none');expect(mocks.store.lock).toHaveBeenCalled();expect(mocks.stopPush).toHaveBeenCalled();expect(mocks.storage.removeItem).toHaveBeenCalledWith('letm3go-auth');
});
it('switches the native account binding before exposing another account',async()=>{
 render(<AuthProvider><Probe/></AuthProvider>);await screen.findByText('authenticated:owner-a');mocks.user={id:'owner-b',email_confirmed_at:'2026-10-24'};mocks.session={access_token:'other',user:mocks.user};mocks.callback('SIGNED_IN',mocks.session);await screen.findByText('authenticated:owner-b');expect(mocks.store.bind).toHaveBeenLastCalledWith(mocks.session,'test-public-key',{offline:false});
});
it('rejects revoked access and pauses private tracking without deleting recordings',async()=>{
 mocks.auth.getUser.mockResolvedValue({error:{status:401,message:'Revoked'}});render(<AuthProvider><Probe/></AuthProvider>);await screen.findByText('reauth:none');expect(mocks.store.lock).toHaveBeenCalled();expect(mocks.store.bind).not.toHaveBeenCalled();
});
it('saves preferences against the current user, not an unscoped device key',async()=>{
 render(<AuthProvider><Probe/></AuthProvider>);await screen.findByText('authenticated:owner-a');fireEvent.click(screen.getByRole('button',{name:'Save name'}));await waitFor(()=>expect(mocks.store.save).toHaveBeenCalledWith(expect.objectContaining({displayName:'Changed'}),'owner-a'));
});
