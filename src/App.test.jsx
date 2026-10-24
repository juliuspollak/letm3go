import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { demoJourneys } from './test/fixtures/journeys.js';
import { emptyRecorder } from './lib/recorder.js';
const { identity, recorderHook }=vi.hoisted(()=>({identity:{value:null},recorderHook:vi.fn()}));
vi.mock('./lib/AuthContext.jsx',()=>({AuthProvider:({children})=>children,useAuth:()=>identity.value}));
vi.mock('./lib/config.js',()=>({config:{configured:false,appleEnabled:false,pushEnabled:false,teslaEnabled:false}}));
vi.mock('./lib/supabase.js',()=>({supabase:null}));
vi.mock('./lib/useRecorder.js',()=>({useRecorder:recorderHook}));
vi.mock('./components/JourneyMap.jsx',()=>({default:()=> <div aria-label="Interactive journey route map"/>}));
beforeEach(()=>{identity.value={status:'signedOut',session:null,preferences:{displayName:'',vehicles:[],onboardingStep:0,onboardingComplete:false},savePreferences:vi.fn(async patch=>({...identity.value.preferences,...patch})),beginSignIn:vi.fn(),signOut:vi.fn(),retry:vi.fn()};recorderHook.mockReturnValue({state:emptyRecorder,run:vi.fn(),busy:false,error:''});});
afterEach(()=>{cleanup();localStorage.clear();window.history.replaceState({},'','/');});
function signedIn(){identity.value={...identity.value,status:'authenticated',session:{user:{id:'owner',email:'owner@example.com'}},preferences:{...identity.value.preferences,onboardingComplete:true}};}
it('requires authentication before accessing any private screens or the native recorder',()=>{
 render(<App/>);expect(screen.getByRole('heading',{name:'Welcome to Letm3go.'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Start activity'})).not.toBeInTheDocument();expect(recorderHook).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Continue with Apple'})).toBeDisabled();
});
it('shows profile onboarding after first authentication rather than Home',()=>{
 signedIn();identity.value.preferences.onboardingComplete=false;render(<App/>);
 expect(screen.getByRole('heading',{name:'Make it yours.'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Open profile'})).not.toBeInTheDocument();
});
it('keeps demonstration routes and photos out of the real application',()=>{signedIn();render(<App/>);expect(screen.getByText('No device recordings yet.')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Browse labelled demo journeys'})).not.toBeInTheDocument();for(const fixture of demoJourneys)expect(screen.queryByText(fixture.title)).not.toBeInTheDocument();});
it('restores returning users to Home and keeps browser GPS unavailable',()=>{
 signedIn();render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Start activity'}));expect(screen.getByRole('button',{name:'Start walking'})).toBeDisabled();
});
it('keeps private screens locked while restoring or reauthenticating',()=>{
 identity.value.status='restoring';const {rerender}=render(<App/>);expect(screen.getByRole('status')).toHaveTextContent('Restoring');expect(recorderHook).not.toHaveBeenCalled();
 identity.value.status='reauth';rerender(<App/>);expect(screen.getByRole('heading',{name:'Welcome to Letm3go.'})).toBeInTheDocument();expect(recorderHook).not.toHaveBeenCalled();
});

it('permits deliberately public journey links without mounting private recording',async()=>{
 window.history.replaceState({},'', '/?journey=11111111-1111-4111-8111-111111111111');render(<App/>);
 expect(await screen.findByRole('heading',{name:/unavailable or has been revoked/})).toBeInTheDocument();expect(recorderHook).not.toHaveBeenCalled();
});
