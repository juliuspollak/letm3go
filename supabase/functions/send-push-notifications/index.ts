// Drains the notification outbox (migration 20261123000000) to APNs. There is no
// schedule: the app wakes this right after an action that notifies someone, and on
// foreground, so an undelivered push is retried on the next wake. Any signed-in
// user may wake it; it only ever sends what the database queued, to the devices
// the database chose. The logic lives in handler.js.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { importPKCS8, SignJWT } from 'npm:jose@6';
import { createPushHandler } from './handler.js';

const url = Deno.env.get('SUPABASE_URL')!;
Deno.serve(createPushHandler({
  env: (key: string) => Deno.env.get(key),
  caller: (authorization: string) => createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } }),
  admin: () => createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } }),
  fetch,
  sign: async ({ kid, team, pem }: { kid: string; team: string; pem: string }) =>
    new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid }).setIssuer(team).setIssuedAt().sign(await importPKCS8(pem, 'ES256')),
}));
