import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Onboarding from './Onboarding.jsx';
const { state }=vi.hoisted(()=>({state:{auth:null}}));
vi.mock('../lib/AuthContext.jsx',()=>({useAuth:()=>state.auth}));
vi.mock('../lib/supabase.js',()=>({supabase:null}));
vi.mock('../lib/useRecorder.js',()=>({useRecorder:()=>({state:{places:[],automaticEnabled:false},run:vi.fn(),busy:false})}));
vi.mock('./Places.jsx',()=>({default:()=> <p>Private home setup</p>}));
vi.mock('./AutomaticTracking.jsx',()=>({default:()=> <p>Automatic permission choice</p>}));
vi.mock('./Garage.jsx',()=>({default:()=> <p>Optional vehicle setup</p>}));
vi.mock('./Household.jsx',()=>({default:()=> <p>Optional household setup</p>}));
beforeEach(()=>{state.auth={status:'offline',session:{user:{user_metadata:{name:'Account name'}}},preferences:{onboardingStep:0,displayName:'',vehicles:[]},savePreferences:vi.fn(async patch=>({...state.auth.preferences,...patch})),signOut:vi.fn()};});
afterEach(cleanup);
it('uses account data for profile and saves progress per authenticated user',async()=>{
 render(<Onboarding/>);expect(screen.getByLabelText('Display name')).toHaveValue('Account name');fireEvent.change(screen.getByLabelText('Display name'),{target:{value:'My name'}});fireEvent.click(screen.getByRole('button',{name:'Continue',exact:true}));await waitFor(()=>expect(state.auth.savePreferences).toHaveBeenCalledWith({displayName:'My name'}));expect(state.auth.savePreferences).toHaveBeenCalledWith({onboardingStep:1,onboardingComplete:false});
});
it('continues from saved progress and makes Home optional',async()=>{
 state.auth.preferences.onboardingStep=1;render(<Onboarding/>);expect(screen.getByText('Private home setup')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Continue / skip for now'}));await waitFor(()=>expect(state.auth.savePreferences).toHaveBeenCalledWith({onboardingStep:2,onboardingComplete:false}));
});
it('records completion so returning users do not repeat setup',async()=>{
 state.auth.preferences.onboardingStep=5;render(<Onboarding/>);fireEvent.click(screen.getByRole('button',{name:'Start exploring'}));await waitFor(()=>expect(state.auth.savePreferences).toHaveBeenCalledWith({onboardingStep:5,onboardingComplete:true}));
});
