// Drains the notification outbox (migration 20261123000000) to APNs. The database
// calls it (20261124000000): straight after notifications are added, and every 5
// minutes when a retry is due. It authenticates with PUSH_WORKER_SECRET and only
// sends what the database queued, to the devices the database chose. The logic
// lives in handler.js.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { importPKCS8, SignJWT } from 'npm:jose@6';
import { createPushHandler } from './handler.js';

const url = Deno.env.get('SUPABASE_URL')!;
Deno.serve(createPushHandler({
  env: (key: string) => Deno.env.get(key),
  admin: () => createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } }),
  fetch,
  sign: async ({ kid, team, pem }: { kid: string; team: string; pem: string }) =>
    new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid }).setIssuer(team).setIssuedAt().sign(await importPKCS8(pem, 'ES256')),
}));
