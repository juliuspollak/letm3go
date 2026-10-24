import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from './supabase.js';
import { config } from './config.js';
import { authStorage } from './sessionStorage.js';
import { createCallbackHandler, parseNativeOAuthCallback, NATIVE_AUTH_CALLBACK } from './nativeOAuth.js';

export const authRedirect = (recovery=false) => Capacitor.isNativePlatform()?`${NATIVE_AUTH_CALLBACK}${recovery?'?flow=recovery':''}`:`${window.location.origin}/${recovery?'?flow=recovery':''}`;

export async function signInWithApple() {
  if (!supabase || !config.appleEnabled) throw new Error('Apple sign-in has not been configured.');
  const native = Capacitor.isNativePlatform();
  if(native){
    let credentials;
    try{credentials=await registerPlugin('SecureSession').signInWithApple();}
    catch(error){if(error.code==='APPLE_SIGN_IN_CANCELLED')return {cancelled:true};throw error;}
    if(!credentials.idToken||!credentials.nonce)throw new Error('Apple did not return valid sign-in credentials. Please retry.');
    const {data,error}=await supabase.auth.signInWithIdToken({provider:'apple',token:credentials.idToken,nonce:credentials.nonce});if(error)throw error;
    if(!data.session||!data.user||data.session.user.id!==data.user.id)throw new Error('Apple sign-in did not create a verified Supabase session. Please retry.');
    // Apple supplies the name once. Never clear it when later credentials omit it.
    if(credentials.name?.trim()){
      const {error:nameError}=await supabase.auth.updateUser({data:{full_name:credentials.name.trim()}});
      if(nameError)window.dispatchEvent(new CustomEvent('letm3go:integration-warning',{detail:{ownerID:data.user.id,message:'Signed in. Enter your display name during profile setup.'}}));
    }
    if(credentials.authorizationCode&&data.session){
      const {error}=await supabase.functions.invoke('account',{body:{action:'captureAppleAuthorization',code:credentials.authorizationCode}});
      if(error)window.dispatchEvent(new CustomEvent('letm3go:integration-warning',{detail:{ownerID:data.session.user.id,message:'Apple sign-in succeeded, but account-deletion revocation setup needs configuration before release.'}}));
    }
    return {cancelled:false,userID:data.user.id};
  }
  await authStorage.setItem('letm3go-oauth-pending',String(Date.now()));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: authRedirect(), skipBrowserRedirect: native },
  });
  if (error) { await authStorage.removeItem('letm3go-oauth-pending'); throw error; }
  if(native&&!(await authStorage.getItem('letm3go-auth-code-verifier')))throw new Error('Unable to securely save the sign-in verifier.');
  if (native && data.url) await Browser.open({ url: data.url });
}

const handle = createCallbackHandler(async (code) => {
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw new Error('Unable to complete sign-in. Please try again.');
  if(data.session)window.dispatchEvent(new CustomEvent('letm3go:auth-completed',{detail:{session:data.session}}));
  await authStorage.removeItem('letm3go-oauth-pending');
  try { await Browser.close(); } catch { /* iOS may already have dismissed it. */ }
});

export async function listenForNativeAuth(onError,onRecovery=()=>{}) {
  if (!supabase || !Capacitor.isNativePlatform()) return () => {};
  const receive = async (url) => { try { const incoming=new URL(url);if(incoming.protocol==='au.jpollak.journey:'&&incoming.hostname==='tesla'&&incoming.pathname==='/connected'){try{await Browser.close();}catch{/* Already dismissed. */}window.dispatchEvent(new Event('letm3go:tesla-connected'));return;} if(!parseNativeOAuthCallback(url))return; await handle(url); if(new URL(url).searchParams.get('flow')==='recovery')onRecovery(); } catch (error) { onError(error); } };
  const listener = await App.addListener('appUrlOpen', ({ url }) => { void receive(url); });
  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) await receive(launch.url);
  } catch { onError(new Error('Unable to read the sign-in callback.')); }
  return () => { void listener.remove(); };
}
