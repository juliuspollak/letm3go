import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../.env.local', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const rawUrl = process.env.VITE_SUPABASE_URL?.trim();
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
let url;
try { url = new URL(rawUrl); } catch { /* Report configuration without disclosing values. */ }
if (!url || url.protocol !== 'https:' || !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
  console.error('NOT VERIFIED: Enter the dedicated Letm3go HTTPS project URL in .env.local.');
  process.exit(1);
}
if (!key?.startsWith('sb_publishable_') || /\s/.test(key)) {
  console.error('NOT VERIFIED: Enter the public publishable key in .env.local. Secret/service-role keys are not accepted.');
  process.exit(1);
}
let failed = false;
for (const [name, route] of [['Auth gateway', '/auth/v1/settings']]) {
  try {
    const response = await fetch(new URL(route, url), {
      method: 'GET', headers: { apikey: key }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    console.log(`${response.ok ? 'PASS' : 'FAIL'}: ${name} returned HTTP ${response.status}.`);
    if(response.ok){const settings=await response.json();console.log(`Auth settings: email=${settings.external?.email===true}, Apple=${settings.external?.apple===true}, email auto-confirm=${settings.mailer_autoconfirm===true}, signups disabled=${settings.disable_signup===true}.`);}else await response.body?.cancel();
    if (!response.ok) failed = true;
  } catch {
    failed = true;
    console.error(`FAIL: ${name} could not be reached securely. Check network access and project status.`);
  }
}
// The schema/OpenAPI root requires a secret key on hosted projects. Use the
// public SDK with HEAD and limit 0 instead; no profile rows are downloaded.
try {
  const client = createClient(url.origin, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) }) },
  });
  const { error, status } = await client.from('profiles').select('id', { head: true }).limit(0);
  console.log(`${error ? 'NOT VERIFIED' : 'PASS'}: Data API zero-row HEAD returned HTTP ${status}.`);
  if (error) {
    console.log('Check whether profiles exists and its grants permit this check; do not change grants just to pass it.');
    failed = true;
  }
} catch {
  failed = true;
  console.error('FAIL: Data API could not be reached securely.');
}
console.log('Read-only checks only: no user rows downloaded, no sign-in, and no database writes.');
console.log('These checks do not verify user authentication, migrations, or RLS enforcement.');
process.exitCode = failed ? 1 : 0;
