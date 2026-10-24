import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AuthScreen from './AuthScreen.jsx';
const { api,auth }=vi.hoisted(()=>({api:{signUp:vi.fn(),signInWithPassword:vi.fn(),resetPasswordForEmail:vi.fn()},auth:{status:'signedOut',session:null,beginSignIn:vi.fn(),updatePassword:vi.fn(),error:''}}));
vi.mock('../lib/AuthContext.jsx',()=>({useAuth:()=>auth}));
vi.mock('../lib/supabase.js',()=>({supabase:{auth:api}}));
vi.mock('../lib/config.js',()=>({config:{configured:true,appleEnabled:false}}));
vi.mock('../lib/auth.js',()=>({authRedirect:recovery=>`au.jpollak.journey://auth/callback${recovery?'?flow=recovery':''}`,signInWithApple:vi.fn()}));
afterEach(cleanup);
beforeEach(()=>{auth.recovery=false;auth.session=null;api.signUp.mockResolvedValue({data:{session:null},error:null});api.signInWithPassword.mockResolvedValue({error:null});api.resetPasswordForEmail.mockResolvedValue({error:null});});
it('registers with a native confirmation redirect and waits for email confirmation',async()=>{
 render(<AuthScreen/>);fireEvent.click(screen.getByRole('button',{name:'Create account',exact:true}));fireEvent.change(screen.getByLabelText('Email'),{target:{value:'person@example.com'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'test-password'}});fireEvent.click(screen.getByRole('button',{name:'Create account',exact:true}));
 await waitFor(()=>expect(api.signUp).toHaveBeenCalledWith({email:'person@example.com',password:'test-password',options:{emailRedirectTo:'au.jpollak.journey://auth/callback'}}));expect(await screen.findByRole('status')).toHaveTextContent('confirm');
});
it('uses real password authentication rather than a demo login',async()=>{
 render(<AuthScreen/>);fireEvent.click(screen.getByRole('button',{name:'Sign in',exact:true}));fireEvent.change(screen.getByLabelText('Email'),{target:{value:'person@example.com'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'test-password'}});fireEvent.click(screen.getByRole('button',{name:'Sign in',exact:true}));
 await waitFor(()=>expect(api.signInWithPassword).toHaveBeenCalledWith({email:'person@example.com',password:'test-password'}));
});
it('starts recovery with a deep link and updates the password only in a recovery session',async()=>{
 const {unmount}=render(<AuthScreen/>);fireEvent.click(screen.getByRole('button',{name:'Sign in',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Forgot password?'}));fireEvent.change(screen.getByLabelText('Email'),{target:{value:'person@example.com'}});fireEvent.click(screen.getByRole('button',{name:'Send recovery link'}));await waitFor(()=>expect(api.resetPasswordForEmail).toHaveBeenCalledWith('person@example.com',{redirectTo:'au.jpollak.journey://auth/callback?flow=recovery'}));
 unmount();auth.recovery=true;auth.session={user:{id:'owner'}};render(<AuthScreen/>);fireEvent.change(screen.getByLabelText('Password'),{target:{value:'new-test-password'}});fireEvent.click(screen.getByRole('button',{name:'Update password'}));await waitFor(()=>expect(auth.updatePassword).toHaveBeenCalledWith('new-test-password'));
});
