import { Capacitor } from '@capacitor/core';
export function readConfig(env = {}, { native = false } = {}) {
  const url = env.VITE_SUPABASE_URL?.trim() || '';
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || '';
  let validUrl = false;
  try {
    const parsed = new URL(url);
    validUrl = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname));
  } catch { /* Unconfigured development is supported. */ }
  return {
    url, key, configured: validUrl && Boolean(key),
    // The native target carries Apple capability; browser OAuth is a separate opt-in.
    appleEnabled: native || env.VITE_ENABLE_APPLE_AUTH === 'true',
    pushEnabled: env.VITE_ENABLE_PUSH === 'true',
    teslaEnabled: env.VITE_ENABLE_TESLA === 'true',
    backupEnabled: env.VITE_ENABLE_PRIVATE_BACKUP === 'true',
    apnsEnvironment: env.VITE_APNS_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
  };
}
export const config = readConfig(import.meta.env, { native: Capacitor.isNativePlatform() });
