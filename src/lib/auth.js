import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from './supabase.js';
import { config } from './config.js';
import { createCallbackHandler, NATIVE_AUTH_CALLBACK } from './nativeOAuth.js';

export async function signInWithApple() {
  if (!supabase || !config.appleEnabled) throw new Error('Apple sign-in has not been configured.');
  const native = Capacitor.isNativePlatform();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: native ? NATIVE_AUTH_CALLBACK : window.location.origin, skipBrowserRedirect: native },
  });
  if (error) throw error;
  if (native && data.url) await Browser.open({ url: data.url });
}

const handle = createCallbackHandler(async (code) => {
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw new Error('Unable to complete sign-in. Please try again.');
  try { await Browser.close(); } catch { /* iOS may already have dismissed it. */ }
});

export async function listenForNativeAuth(onError) {
  if (!supabase || !Capacitor.isNativePlatform()) return () => {};
  const receive = async (url) => { try { await handle(url); } catch (error) { onError(error); } };
  const listener = await App.addListener('appUrlOpen', ({ url }) => { void receive(url); });
  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) await receive(launch.url);
  } catch { onError(new Error('Unable to read the sign-in callback.')); }
  return () => { void listener.remove(); };
}
