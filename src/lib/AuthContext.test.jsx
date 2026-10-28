import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { ensureUserProfile } from './userProfile.js';
const mocks=vi.hoisted(()=>({callback:null,user:null,session:null,auth:{getSession:vi.fn(),getUser:vi.fn(),onAuthStateChange:vi.fn(),signOut:vi.fn(),startAutoRefresh:vi.fn(),stopAutoRefresh:vi.fn()},store:{bind:vi.fn(),lock:vi.fn(),save:vi.fn()},storage:{getItem:vi.fn(),removeItem:vi.fn()},stopPush:vi.fn()}));
vi.mock('./supabase.js',()=>({supabase:{auth:mocks.auth}}));
vi.mock('./sessionStorage.js',()=>({AUTH_STORAGE_KEY:'letm3go-auth',authStorage:mocks.storage,accountStore:mocks.store,defaultPreferences:()=>({onboardingComplete:false,vehicles:[]})}));
vi.mock('./userProfile.js',()=>({ensureUserProfile:vi.fn(async(_,user)=>({id:user.id,display_name:''}))}));
vi.mock('./config.js',()=>({config:{key:'test-public-key'}}));
vi.mock('./auth.js',()=>({listenForNativeAuth:async()=>()=>{},authRedirect:()=>''}));
vi.mock('./pushAccount.js',()=>({stopAccountPush:mocks.stopPush,resumeAccountPush:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>false},registerPlugin:()=>({})}));
function Probe(){const value=useAuth();return <><p role="status">{value.status}:{value.session?.user.id||'none'}</p><p data-testid="auth-error">{value.error}</p><p data-testid="account-notice">{value.accountDeletionNotice}</p><p data-testid="integration-banner">{value.integrationWarning}</p><button onClick={()=>void value.signOut()}>Logout</button><button onClick={()=>void value.savePreferences({displayName:'Changed'})}>Save name</button></>;}
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
it('completes local sign-out when auxiliary secure-session cleanup rejects a key',async()=>{
 mocks.storage.removeItem.mockRejectedValue(new Error('Unsupported session key.'));
 render(<AuthProvider><Probe/></AuthProvider>);await screen.findByText('authenticated:owner-a');fireEvent.click(screen.getByRole('button',{name:'Logout'}));
 await screen.findByText('signedOut:none');expect(mocks.store.lock).toHaveBeenCalled();expect(screen.getByTestId('integration-banner')).toHaveTextContent('Signed out locally');
});
it('rebinds the verified session when the recorder reports that native storage became locked',async()=>{
 render(<AuthProvider><Probe/></AuthProvider>);await screen.findByText('authenticated:owner-a');
 const before=mocks.store.bind.mock.calls.length;act(()=>window.dispatchEvent(new CustomEvent('letm3go:recorder-binding-required',{detail:{ownerID:'owner-a'}})));
 await waitFor(()=>expect(mocks.store.bind.mock.calls.length).toBeGreaterThan(before));expect(screen.getByRole('status')).toHaveTextContent('authenticated:owner-a');
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
it('keeps verified authentication and private recording available when profile sync is offline',async()=>{
 vi.mocked(ensureUserProfile).mockRejectedValueOnce(new Error('Profile unavailable'));
 render(<AuthProvider><Probe/></AuthProvider>);await screen.findByText('authenticated:owner-a');expect(mocks.store.bind).toHaveBeenCalled();
});
it('retries a discarded refresh without exposing the SDK error or forcing logout',async()=>{mocks.auth.getSession.mockResolvedValueOnce({data:{session:null},error:{name:'AuthRefreshDiscardedError',status:409,message:'Refresh result discarded: session state changed mid-flight'}});render(<AuthProvider><Probe/></AuthProvider>);await screen.findByText('authenticated:owner-a');expect(screen.getByTestId('auth-error')).toBeEmptyDOMElement();expect(mocks.store.lock).not.toHaveBeenCalled();});
it('ignores an old restore finishing after a newer sign-in',async()=>{let finish;mocks.auth.getSession.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));render(<AuthProvider><Probe/></AuthProvider>);await waitFor(()=>expect(finish).toBeTypeOf('function'));act(()=>mocks.callback('SIGNED_IN',mocks.session));await screen.findByText('authenticated:owner-a');await act(async()=>finish({data:{session:null}}));expect(screen.getByRole('status')).toHaveTextContent('authenticated:owner-a');expect(mocks.store.lock).not.toHaveBeenCalled();});

it('keeps deletion availability in account settings and isolated to the correct account',async()=>{render(<AuthProvider><Probe/></AuthProvider>);await screen.findByText('authenticated:owner-a');act(()=>window.dispatchEvent(new CustomEvent('letm3go:account-service-warning',{detail:{ownerID:'owner-a',message:'Account deletion is temporarily unavailable.'}})));expect(screen.getByTestId('account-notice')).toHaveTextContent('temporarily unavailable');expect(screen.getByTestId('integration-banner')).toBeEmptyDOMElement();mocks.user={id:'owner-b',email_confirmed_at:'2026-10-24'};mocks.session={access_token:'other',user:mocks.user};act(()=>mocks.callback('SIGNED_IN',mocks.session));await screen.findByText('authenticated:owner-b');expect(screen.getByTestId('account-notice')).toBeEmptyDOMElement();});
