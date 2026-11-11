// The outbox drain (ImBored's send-push-notifications worker, adapted), free of
// Deno/npm imports so it can be unit-tested. index.ts supplies the Supabase
// client, fetch and the ES256 signer.
import { apnsPayload, classifyApns, providerRejected } from './apns.js';

export const BUNDLE_ID = 'au.jpollak.journey';
export const PROVIDER_TOKEN_MS = 40 * 60 * 1000; // Apple accepts one for up to an hour.
export const CHECKIN_CONCURRENCY = 10;
export const BATCH = 10, MAX_ROUNDS = 10, APNS_TIMEOUT_MS = 8000, DRAIN_MS = 60000;
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
export const apnsHost = environment => environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';

// From ImBored's workerCore.ts: compare digests so timing does not reveal the secret.
export async function constantTimeEqual(left, right) {
  const [a, b] = await Promise.all([left, right].map(value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
  const aa = new Uint8Array(a), bb = new Uint8Array(b); let difference = 0;
  for (let index = 0; index < aa.length; index += 1) difference |= aa[index] ^ bb[index];
  return difference === 0;
}

// deps: { env(key), admin(), fetch, sign({kid,team,pem}), now(), log(event) }
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
    // Only the database dispatcher (20261124000000) calls this, with the worker
    // secret, as ImBored's scheduled worker does. Apps never call it.
    const expected = deps.env('PUSH_WORKER_SECRET') || '', supplied = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!expected || !supplied || !(await constantTimeEqual(supplied, expected))) return reply({ error: 'Unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    // Adapted from ImBored's apns-auth-check: asks Apple itself whether it accepts our
    // key, using an all-zero device token that no phone has. 'BadDeviceToken' means
    // the key and topic were accepted; 'InvalidProviderToken' means they were not.
    if (body?.mode === 'apns-check') {
      let token;
      try { token = await providerToken(); } catch (caught) { return reply({ ok: false, mode: 'apns-check', reason: caught instanceof Error && caught.message === 'ApnsNotConfigured' ? 'ApnsNotConfigured' : 'ApnsKeyUnusable' }); }
      try {
        const response = await deps.fetch(`${apnsHost('production')}/3/device/${'0'.repeat(64)}`, { method: 'POST', signal: AbortSignal.timeout(APNS_TIMEOUT_MS), headers: { authorization: `bearer ${token}`, 'apns-topic': BUNDLE_ID, 'apns-push-type': 'alert', 'apns-priority': '10', 'content-type': 'application/json' }, body: JSON.stringify({ aps: { alert: { title: 'check', body: 'check' } } }) });
        const result = await response.json().catch(() => ({}));
        const reason = typeof result.reason === 'string' ? result.reason : 'Unknown';
        if (providerRejected(response.status, reason)) provider = null;
        return reply({ ok: true, mode: 'apns-check', http: response.status, reason, credentialsAccepted: response.status === 400 && reason === 'BadDeviceToken' });
      } catch (caught) { return reply({ ok: false, mode: 'apns-check', reason: caught instanceof Error ? caught.name : 'NetworkError' }); }
    }
    const admin = deps.admin();

    // Silent location check-ins (20261130000000): wake each stale sharer so its
    // phone publishes one fresh position. A background push carries no text and
    // is delivered at low priority; iOS may coalesce or drop it, which is why
    // the server asks again every interval.
    if (body?.mode === 'checkin') {
      const { data: devices, error } = await admin.rpc('claim_location_checkins');
      if (error) { log({ event: 'checkin_claim_error', code: error.code || 'unknown' }); return reply({ error: 'Check-in queue unavailable' }, 500); }
      const result = { ok: true, mode: 'checkin', claimed: devices?.length || 0, sent: 0, failed: 0, invalid: 0 };
      if (!result.claimed) return reply(result);
      let token;
      try { token = await providerToken(); } catch (caught) { log({ event: 'apns_provider_error', reason: caught instanceof Error && caught.message === 'ApnsNotConfigured' ? 'ApnsNotConfigured' : 'ApnsKeyUnusable' }); return reply({ ...result, error: 'APNs is not configured' }, 500); }
      // Bounded concurrency keeps a large batch inside the dispatcher's timeout. A
      // device whose push did not go out is released so the next run retries it.
      const released = new Set();
      let rejected = false;
      const send = async device => {
        if (rejected) { released.add(device.owner_id); return; }
        try {
          const response = await deps.fetch(`${apnsHost(device.environment)}/3/device/${encodeURIComponent(device.apns_token)}`, {
            method: 'POST', signal: AbortSignal.timeout(APNS_TIMEOUT_MS),
            headers: { authorization: `bearer ${token}`, 'apns-topic': BUNDLE_ID, 'apns-push-type': 'background', 'apns-priority': '5', 'apns-collapse-id': 'location-checkin', 'apns-expiration': String(Math.floor(now() / 1000) + 600), 'content-type': 'application/json' },
            body: JSON.stringify({ aps: { 'content-available': 1 }, kind: 'location_checkin' }),
          });
          const answer = await response.json().catch(() => ({}));
          const reason = typeof answer.reason === 'string' ? answer.reason : response.ok ? 'Success' : 'Unknown';
          const status = classifyApns(response.status, reason);
          if (providerRejected(response.status, reason)) { provider = null; rejected = true; log({ event: 'apns_credentials_rejected', reason }); result.failed++; released.add(device.owner_id); return; }
          if (status === 'sent') result.sent++;
          else if (status === 'invalid_token') { result.invalid++; await admin.from('push_devices').delete().eq('apns_token', device.apns_token); }
          else { result.failed++; released.add(device.owner_id); }
        } catch { result.failed++; released.add(device.owner_id); }
      };
      for (let at = 0; at < devices.length; at += CHECKIN_CONCURRENCY) await Promise.all(devices.slice(at, at + CHECKIN_CONCURRENCY).map(send));
      if (released.size) await admin.rpc('release_location_checkins', { p_owners: [...released] });
      // Counts only: never tokens or people.
      log({ event: 'checkin_batch', ...result });
      return reply(result);
    }

    const summary = { ok: true, claimed: 0, sent: 0, retried: 0, failed: 0 };
    const finish = async (item, status, http, reason) => {
      const { data: final } = await admin.rpc('finish_push_delivery', { p_delivery: item.delivery_id, p_claim: item.claim_token, p_status: status, p_http: http, p_reason: reason });
      if (final === 'sent') summary.sent++; else if (final === 'retry') summary.retried++; else summary.failed++;
      return final;
    };
    // Drain in rounds while full batches come back, bounded so one call stays well
    // inside the 2-minute delivery lease (BATCH x APNS_TIMEOUT_MS per round).
    const started = now();
    let rejected = null, token = null;
    for (let round = 0; round < MAX_ROUNDS && now() - started < DRAIN_MS; round++) {
      const { data: claimed, error } = await admin.rpc('claim_push_deliveries', { p_batch: BATCH });
      if (error) { log({ event: 'push_claim_error', code: error.code || 'unknown' }); return reply({ error: 'Push queue unavailable' }, 500); }
      if (!claimed?.length) break;
      summary.claimed += claimed.length;
      if (!token) {
        try { token = await providerToken(); } catch (caught) {
          // Not configured or unusable key: put the claims back for a later call.
          const reason = caught instanceof Error && caught.message === 'ApnsNotConfigured' ? 'ApnsNotConfigured' : 'ApnsKeyUnusable';
          for (const item of claimed) await finish(item, 'retry', 0, reason);
          log({ event: 'apns_provider_error', reason, ...summary });
          return reply({ ...summary, error: 'APNs is not configured' }, 500);
        }
      }
      for (const item of claimed) {
        // Apple refused our credentials: every further request would fail the same
        // way, so the rest go back to the queue untouched.
        if (rejected) { await finish(item, 'retry', 0, rejected); continue; }
        let status = 'retry', http = 0, reason = 'NetworkError';
        try {
          const response = await deps.fetch(`${apnsHost(item.environment)}/3/device/${encodeURIComponent(item.apns_token)}`, {
            method: 'POST', signal: AbortSignal.timeout(APNS_TIMEOUT_MS),
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
      if (rejected || claimed.length < BATCH) break;
    }
    if (rejected) log({ event: 'apns_credentials_rejected', reason: rejected });
    log({ event: 'push_batch', ...summary });
    return reply(summary);
  };
}
