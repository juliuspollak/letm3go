// The outbox drain, free of Deno/npm imports so it can be unit-tested. index.ts
// supplies the Supabase clients, fetch and the ES256 signer.
import { apnsPayload, classifyApns, providerRejected } from './apns.js';

export const BUNDLE_ID = 'au.jpollak.journey';
export const PROVIDER_TOKEN_MS = 40 * 60 * 1000; // Apple accepts one for up to an hour.
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
export const apnsHost = environment => environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';

// deps: { env(key), caller(authorization), admin(), fetch, sign({kid,team,pem}), now(), log(event) }
export function createPushHandler(deps) {
  let provider = null;
  const now = deps.now || Date.now, log = deps.log || (event => console.log(JSON.stringify(event)));
  async function providerToken() {
    if (provider && now() - provider.at < PROVIDER_TOKEN_MS) return provider.token;
    const kid = deps.env('APNS_KEY_ID'), team = deps.env('APNS_TEAM_ID'), pem = deps.env('APNS_PRIVATE_KEY');
    if (!kid || !team || !pem) throw new Error('ApnsNotConfigured');
    const token = await deps.sign({ kid, team, pem: pem.replace(/\\n/g, '\n') });
    provider = { token, at: now() };
    return token;
  }
  return async request => {
    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    const { data: identity, error: identityError } = await deps.caller(request.headers.get('Authorization') || '').auth.getUser();
    if (identityError || !identity?.user) return reply({ error: 'Sign in required' }, 401);
    const admin = deps.admin();
    const { data: budget } = await admin.rpc('consume_operation', { p_key: `push-wake:${identity.user.id}`, p_max: 240 });
    if (!budget) return reply({ ok: true, rateLimited: true }, 202);

    const { data: claimed, error } = await admin.rpc('claim_push_deliveries', { p_batch: 20 });
    if (error) { log({ event: 'push_claim_error', code: error.code || 'unknown' }); return reply({ error: 'Push queue unavailable' }, 500); }
    const summary = { ok: true, claimed: claimed?.length || 0, sent: 0, retried: 0, failed: 0 };
    if (!claimed?.length) return reply(summary);
    const finish = async (item, status, http, reason) => {
      const { data: final } = await admin.rpc('finish_push_delivery', { p_delivery: item.delivery_id, p_claim: item.claim_token, p_status: status, p_http: http, p_reason: reason });
      if (final === 'sent') summary.sent++; else if (final === 'retry') summary.retried++; else summary.failed++;
      return final;
    };
    let token;
    try { token = await providerToken(); } catch (caught) {
      // Not configured or unusable key: put the claims back for a later wake.
      const reason = caught instanceof Error && caught.message === 'ApnsNotConfigured' ? 'ApnsNotConfigured' : 'ApnsKeyUnusable';
      for (const item of claimed) await finish(item, 'retry', 0, reason);
      log({ event: 'apns_provider_error', reason, ...summary });
      return reply({ ...summary, error: 'APNs is not configured' }, 500);
    }
    let rejected = null;
    for (const item of claimed) {
      // Apple refused our credentials: every further request would fail the same
      // way, so the rest go back to the queue untouched.
      if (rejected) { await finish(item, 'retry', 0, rejected); continue; }
      let status = 'retry', http = 0, reason = 'NetworkError';
      try {
        const response = await deps.fetch(`${apnsHost(item.environment)}/3/device/${encodeURIComponent(item.apns_token)}`, {
          method: 'POST', signal: AbortSignal.timeout(12000),
          headers: { authorization: `bearer ${token}`, 'apns-topic': BUNDLE_ID, 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-collapse-id': String(item.notification_id), 'content-type': 'application/json' },
          body: apnsPayload(item),
        });
        http = response.status;
        const result = await response.json().catch(() => ({}));
        reason = typeof result.reason === 'string' ? result.reason : response.ok ? 'Success' : 'Unknown';
        status = classifyApns(http, reason);
        if (providerRejected(http, reason)) { provider = null; rejected = reason; }
      } catch (caught) { reason = caught instanceof Error ? caught.name : 'NetworkError'; }
      const final = await finish(item, status, http, reason);
      // Metadata only: never the device token, the message or the key.
      log({ event: 'apns_delivery', delivery: item.delivery_id, kind: item.kind, environment: item.environment, http, reason, status: final });
    }
    if (rejected) log({ event: 'apns_credentials_rejected', reason: rejected });
    log({ event: 'push_batch', ...summary });
    return reply(summary);
  };
}
