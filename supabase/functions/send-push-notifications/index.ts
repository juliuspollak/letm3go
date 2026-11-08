// Drains the notification outbox (migration 20261123000000) to APNs. There is no
// schedule: the app wakes this right after an action that notifies someone, and on
// foreground, so an undelivered push is retried on the next wake. Any signed-in
// user may wake it; it only ever sends what the database queued, to the devices
// the database chose.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { importPKCS8, SignJWT } from 'npm:jose@6';
import { apnsPayload, classifyApns } from './apns.js';

const BUNDLE_ID = 'au.jpollak.journey';
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });

// Apple accepts a provider token for up to an hour; refresh well before that.
let provider: { token: string; at: number } | null = null;
async function providerToken() {
  if (provider && Date.now() - provider.at < 40 * 60 * 1000) return provider.token;
  const kid = Deno.env.get('APNS_KEY_ID'), team = Deno.env.get('APNS_TEAM_ID'), pem = Deno.env.get('APNS_PRIVATE_KEY');
  if (!kid || !team || !pem) throw new Error('APNs is not configured');
  const key = await importPKCS8(pem.replace(/\\n/g, '\n'), 'ES256');
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid }).setIssuer(team).setIssuedAt().sign(key);
  provider = { token, at: Date.now() };
  return token;
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: request.headers.get('Authorization') || '' } }, auth: { persistSession: false } });
  const { data: identity, error: identityError } = await caller.auth.getUser();
  if (identityError || !identity.user) return reply({ error: 'Sign in required' }, 401);
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: budget } = await admin.rpc('consume_operation', { p_key: `push-wake:${identity.user.id}`, p_max: 240 });
  if (!budget) return reply({ ok: true, rateLimited: true }, 202);

  const { data: claimed, error } = await admin.rpc('claim_push_deliveries', { p_batch: 20 });
  if (error) { console.error(JSON.stringify({ event: 'push_claim_error', code: error.code })); return reply({ error: 'Push queue unavailable' }, 500); }
  const summary = { ok: true, claimed: claimed?.length || 0, sent: 0, retried: 0, failed: 0 };
  if (!claimed?.length) return reply(summary);
  let token: string;
  try { token = await providerToken(); } catch {
    // Not configured yet: put the claims back for a later wake instead of losing them.
    for (const item of claimed) await admin.rpc('finish_push_delivery', { p_delivery: item.delivery_id, p_claim: item.claim_token, p_status: 'retry', p_http: 0, p_reason: 'ApnsNotConfigured' });
    return reply({ ...summary, error: 'APNs is not configured' }, 500);
  }
  for (const item of claimed) {
    let status = 'retry', http = 0, reason = 'NetworkError';
    try {
      const host = item.environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
      const response = await fetch(`${host}/3/device/${encodeURIComponent(item.apns_token)}`, {
        method: 'POST', signal: AbortSignal.timeout(12000),
        headers: { authorization: `bearer ${token}`, 'apns-topic': BUNDLE_ID, 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-collapse-id': String(item.notification_id), 'content-type': 'application/json' },
        body: apnsPayload(item),
      });
      http = response.status;
      const result = await response.json().catch(() => ({}));
      reason = typeof result.reason === 'string' ? result.reason : response.ok ? 'Success' : 'Unknown';
      status = classifyApns(http, reason);
    } catch (caught) { reason = caught instanceof Error ? caught.name : 'NetworkError'; }
    const { data: final } = await admin.rpc('finish_push_delivery', { p_delivery: item.delivery_id, p_claim: item.claim_token, p_status: status, p_http: http, p_reason: reason });
    if (final === 'sent') summary.sent++; else if (final === 'retry') summary.retried++; else summary.failed++;
  }
  console.log(JSON.stringify({ event: 'push_batch', ...summary }));
  return reply(summary);
});
