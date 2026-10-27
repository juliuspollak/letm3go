import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Onboarding from './Onboarding.jsx';
const { state }=vi.hoisted(()=>({state:{auth:null}}));
vi.mock('../lib/AuthContext.jsx',()=>({useAuth:()=>state.auth}));
vi.mock('../lib/supabase.js',()=>({supabase:null}));
beforeEach(()=>{state.auth={status:'offline',session:{user:{id:'account-1',user_metadata:{name:'Account name'}}},preferences:{onboardingStep:0,displayName:'',vehicles:[]},savePreferences:vi.fn(async patch=>({...state.auth.preferences,...patch})),signOut:vi.fn()};sessionStorage.clear();});
afterEach(cleanup);
it('uses account data for profile and saves progress per authenticated user',async()=>{
 render(<Onboarding/>);
 expect(screen.getByRole('heading',{name:'What should we call you?'})).toBeInTheDocument();
 expect(screen.getByLabelText('Display name')).toHaveValue('Account name');
 fireEvent.change(screen.getByLabelText('Display name'),{target:{value:'My name'}});
 fireEvent.click(screen.getByRole('button',{name:'Continue',exact:true}));
 await waitFor(()=>expect(state.auth.savePreferences).toHaveBeenCalledWith({displayName:'My name',onboardingStep:5,onboardingComplete:true}));
 expect(sessionStorage.getItem('letm3go:family-setup')).toBe('account-1');
});
it('finishes setup for installations left on the retired multi-step wizard',async()=>{
 state.auth.preferences={...state.auth.preferences,onboardingStep:3,displayName:'Account name'};
 render(<Onboarding/>);
 expect(screen.queryByText('Private home setup')).not.toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'What should we call you?'})).toBeInTheDocument();
 expect(screen.getByLabelText('Display name')).toHaveValue('Account name');
 fireEvent.click(screen.getByRole('button',{name:'Continue',exact:true}));
 await waitFor(()=>expect(state.auth.savePreferences).toHaveBeenCalledWith({displayName:'Account name',onboardingStep:5,onboardingComplete:true}));
});
it('records completion so returning users do not repeat setup',async()=>{
 state.auth.preferences={...state.auth.preferences,onboardingStep:5};
 render(<Onboarding/>);
 fireEvent.click(screen.getByRole('button',{name:'Continue',exact:true}));
 await waitFor(()=>expect(state.auth.savePreferences).toHaveBeenCalledWith({displayName:'Account name',onboardingStep:5,onboardingComplete:true}));
});
