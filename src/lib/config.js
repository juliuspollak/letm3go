export function readConfig(env = {}) {
  const url = env.VITE_SUPABASE_URL?.trim() || '';
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || '';
  let validUrl = false;
  try {
    const parsed = new URL(url);
    validUrl = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname));
  } catch { /* Unconfigured development is supported. */ }
  return {
    url, key, configured: validUrl && Boolean(key),
    appleEnabled: env.VITE_ENABLE_APPLE_AUTH === 'true',
    pushEnabled: env.VITE_ENABLE_PUSH === 'true',
    apnsEnvironment: env.VITE_APNS_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
  };
}
export const config = readConfig(import.meta.env);
