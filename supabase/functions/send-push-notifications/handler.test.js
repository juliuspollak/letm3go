import { describe, expect, it, vi } from 'vitest';
import { createPushHandler, constantTimeEqual, BUNDLE_ID, PROVIDER_TOKEN_MS, BATCH, MAX_ROUNDS } from './handler.js';

const TOKEN_A = 'a'.repeat(64), TOKEN_B = 'b'.repeat(64);
const delivery = (id, token, extra = {}) => ({ delivery_id: id, claim_token: `claim-${id}`, apns_token: token, environment: 'production', notification_id: 100 + id, kind: 'poke', title: 'Poke', body: 'Ann poked you 👋', route: { screen: 'home' }, badge: 1, ...extra });
const secrets = { PUSH_WORKER_SECRET: 'worker-secret-value', APNS_KEY_ID: 'KEY1234567', APNS_TEAM_ID: 'TEAM123456', APNS_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----' };
const apple = (status, reason) => new Response(reason ? JSON.stringify({ reason }) : '', { status });

function setup({ claimed = [], env = secrets, responses = [], now = () => 0 } = {}) {
  const finished = [], logs = [], queue = [...responses];
  let admins = 0;
  const rpc = vi.fn(async (name, args) => {
    if (name === 'claim_push_deliveries') { const rows = claimed; claimed = []; return { data: rows }; }
    if (name === 'finish_push_delivery') { finished.push(args); return { data: args.p_status === 'invalid_token' ? 'failed' : args.p_status }; }
    return { data: null };
  });
  const fetch = vi.fn(async () => { const next = queue.shift(); if (next instanceof Error) throw next; return next || apple(200); });
  const sign = vi.fn(async ({ pem }) => { if (!pem.includes('\nabc\n')) throw new Error('bad pem'); return 'provider.jwt'; });
  const handler = createPushHandler({
    env: key => env[key], fetch, sign, now, log: event => logs.push(event),
    admin: () => { admins++; return { rpc }; },
  });
  const call = (secret = secrets.PUSH_WORKER_SECRET, body = {}) => handler(new Request('https://x/functions/v1/send-push-notifications', { method: 'POST', headers: secret == null ? {} : { Authorization: `Bearer ${secret}` }, body: JSON.stringify(body) }));
  const wake = () => call();
  return { wake, call, fetch, sign, rpc, finished, logs, admins: () => admins };
}

describe('send-push-notifications', () => {
  it('sends to the production APNs endpoint with the app topic and an ES256 provider token', async () => {
    const t = setup({ claimed: [delivery(1, TOKEN_A)] });
    const body = await (await t.wake()).json();
    expect(body).toMatchObject({ claimed: 1, sent: 1, retried: 0, failed: 0 });
    const [url, init] = t.fetch.mock.calls[0];
    expect(url).toBe(`https://api.push.apple.com/3/device/${TOKEN_A}`);
    expect(init.headers).toMatchObject({ authorization: 'bearer provider.jwt', 'apns-topic': BUNDLE_ID, 'apns-push-type': 'alert', 'apns-collapse-id': '101' });
    expect(JSON.parse(init.body).aps.alert).toEqual({ title: 'Poke', body: 'Ann poked you 👋' });
    expect(t.sign).toHaveBeenCalledWith({ kid: 'KEY1234567', team: 'TEAM123456', pem: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----' });
    expect(t.finished).toEqual([expect.objectContaining({ p_delivery: 1, p_claim: 'claim-1', p_status: 'sent', p_http: 200 })]);
  });

  it('uses the sandbox endpoint for a Debug build device', async () => {
    const t = setup({ claimed: [delivery(1, TOKEN_A, { environment: 'sandbox' })] });
    await t.wake();
    expect(t.fetch.mock.calls[0][0]).toBe(`https://api.sandbox.push.apple.com/3/device/${TOKEN_A}`);
  });

  it('one dead or failing device does not block the others of the same account', async () => {
    const t = setup({ claimed: [delivery(1, TOKEN_A), delivery(2, TOKEN_B), delivery(3, 'c'.repeat(64))], responses: [apple(410, 'Unregistered'), new TypeError('network'), apple(200)] });
    const body = await (await t.wake()).json();
    expect(t.finished.map(f => [f.p_delivery, f.p_status])).toEqual([[1, 'invalid_token'], [2, 'retry'], [3, 'sent']]);
    expect(body).toMatchObject({ sent: 1, retried: 1, failed: 1 });
  });

  it('retries temporary Apple failures and gives up on permanent ones', async () => {
    const t = setup({ claimed: [delivery(1, TOKEN_A), delivery(2, TOKEN_B)], responses: [apple(503, 'ServiceUnavailable'), apple(400, 'PayloadTooLarge')] });
    await t.wake();
    expect(t.finished.map(f => f.p_status)).toEqual(['retry', 'failed']);
  });

  it('rejected credentials retry every claim, stop calling Apple and refresh the token next time', async () => {
    const t = setup({ claimed: [delivery(1, TOKEN_A), delivery(2, TOKEN_B)], responses: [apple(403, 'InvalidProviderToken')] });
    await t.wake();
    expect(t.fetch).toHaveBeenCalledTimes(1);
    expect(t.finished.map(f => [f.p_status, f.p_reason])).toEqual([['retry', 'InvalidProviderToken'], ['retry', 'InvalidProviderToken']]);
    expect(t.logs).toContainEqual({ event: 'apns_credentials_rejected', reason: 'InvalidProviderToken' });
  });

  it('missing secrets put the claims back without calling Apple', async () => {
    const t = setup({ claimed: [delivery(1, TOKEN_A)], env: { PUSH_WORKER_SECRET: secrets.PUSH_WORKER_SECRET } });
    const response = await t.wake();
    expect(response.status).toBe(500);
    expect(t.fetch).not.toHaveBeenCalled();
    expect(t.finished).toEqual([expect.objectContaining({ p_status: 'retry', p_reason: 'ApnsNotConfigured' })]);
  });

  it('an unusable key is reported as such and nothing is lost', async () => {
    const t = setup({ claimed: [delivery(1, TOKEN_A)], env: { ...secrets, APNS_PRIVATE_KEY: 'garbage' } });
    await t.wake();
    expect(t.finished).toEqual([expect.objectContaining({ p_status: 'retry', p_reason: 'ApnsKeyUnusable' })]);
  });

  it('a second wake with nothing queued sends nothing (no duplicate delivery)', async () => {
    const t = setup({ claimed: [delivery(1, TOKEN_A)] });
    await t.wake();
    const again = await (await t.wake()).json();
    expect(again).toMatchObject({ claimed: 0, sent: 0 });
    expect(t.fetch).toHaveBeenCalledTimes(1);
    expect(t.sign).toHaveBeenCalledTimes(1);
  });

  // From ImBored's handler.test.ts / workerCore.test.ts.
  it('a missing or wrong worker secret is rejected before any database access', async () => {
    for (const secret of [null, '', 'wrong', 'worker-secret-valu', 'user.jwt']) {
      const t = setup({ claimed: [delivery(1, TOKEN_A)] });
      expect((await t.call(secret)).status).toBe(401);
      expect(t.admins()).toBe(0); expect(t.fetch).not.toHaveBeenCalled();
    }
    const unset = setup({ env: { ...secrets, PUSH_WORKER_SECRET: '' } });
    expect((await unset.call('')).status).toBe(401);
  });
  it('worker secret comparison accepts only the complete secret', async () => {
    expect(await constantTimeEqual('correct', 'correct')).toBe(true);
    expect(await constantTimeEqual('correct', 'correc')).toBe(false);
    expect(await constantTimeEqual('correct', 'correct ')).toBe(false);
  });
  it('one notification fans out to production and sandbox devices in the same batch', async () => {
    const t = setup({ claimed: [delivery(1, TOKEN_A, { notification_id: 7 }), delivery(2, TOKEN_B, { notification_id: 7, environment: 'sandbox' })] });
    await t.wake();
    expect(t.fetch.mock.calls.map(([url]) => new URL(url).host)).toEqual(['api.push.apple.com', 'api.sandbox.push.apple.com']);
    expect(t.finished.map(f => f.p_status)).toEqual(['sent', 'sent']);
  });
  it('reuses a warm provider token and refreshes it before Apple expires it', async () => {
    let clock = 0;
    const t = setup({ claimed: [delivery(1, TOKEN_A)], now: () => clock });
    await t.wake();
    t.rpc.mockImplementationOnce(async () => ({ data: [delivery(2, TOKEN_B)] }));
    clock = PROVIDER_TOKEN_MS - 1; await t.wake();
    expect(t.sign).toHaveBeenCalledTimes(1);
    t.rpc.mockImplementationOnce(async () => ({ data: [delivery(3, TOKEN_B)] }));
    clock = PROVIDER_TOKEN_MS + 1; await t.wake();
    expect(t.sign).toHaveBeenCalledTimes(2);
  });
  it('a claim failure returns only a safe message', async () => {
    const t = setup();
    t.rpc.mockImplementationOnce(async () => ({ error: { code: '42883', message: 'function secret_detail does not exist' } }));
    const response = await t.wake();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('secret_detail');
  });
  it('apns-check asks Apple about the key with a dummy token and reports acceptance without sending to anyone', async () => {
    const accepted = setup({ responses: [apple(400, 'BadDeviceToken')] });
    expect(await (await accepted.call(undefined, { mode: 'apns-check' })).json()).toMatchObject({ mode: 'apns-check', http: 400, reason: 'BadDeviceToken', credentialsAccepted: true });
    expect(accepted.fetch.mock.calls[0][0]).toBe(`https://api.push.apple.com/3/device/${'0'.repeat(64)}`);
    expect(accepted.fetch.mock.calls[0][1].headers['apns-topic']).toBe(BUNDLE_ID);
    expect(accepted.admins()).toBe(0);
    const rejected = setup({ responses: [apple(403, 'InvalidProviderToken')] });
    expect(await (await rejected.call(undefined, { mode: 'apns-check' })).json()).toMatchObject({ credentialsAccepted: false, reason: 'InvalidProviderToken' });
    expect((await setup().call('wrong', { mode: 'apns-check' })).status).toBe(401);
  });

  it('logs delivery metadata but never device tokens, message text or key material', async () => {
    const t = setup({ claimed: [delivery(1, TOKEN_A)] });
    await t.wake();
    const text = JSON.stringify(t.logs);
    expect(text).toContain('apns_delivery');
    for (const secret of [TOKEN_A, 'Ann poked you', 'provider.jwt', 'PRIVATE KEY', 'KEY1234567', 'worker-secret-value']) expect(text).not.toContain(secret);
  });

  it('drains several full batches in one call and stops when a batch is short', async () => {
    const t = setup();
    const batches = [Array.from({ length: BATCH }, (_, i) => delivery(i + 1, TOKEN_A)), Array.from({ length: BATCH }, (_, i) => delivery(i + 100, TOKEN_A)), [delivery(500, TOKEN_B)]];
    t.rpc.mockImplementation(async (name, args) => name === 'claim_push_deliveries' ? { data: batches.shift() || [] } : { data: args.p_status });
    const body = await (await t.wake()).json();
    expect(body).toMatchObject({ claimed: 2 * BATCH + 1, sent: 2 * BATCH + 1 });
    expect(t.rpc.mock.calls.filter(([name]) => name === 'claim_push_deliveries')).toHaveLength(3);
  });

  it('never runs more than the bounded number of rounds in one call', async () => {
    const t = setup();
    let id = 0;
    t.rpc.mockImplementation(async (name, args) => name === 'claim_push_deliveries' ? { data: Array.from({ length: BATCH }, () => delivery(++id, TOKEN_A)) } : { data: args.p_status });
    await t.wake();
    expect(t.rpc.mock.calls.filter(([name]) => name === 'claim_push_deliveries')).toHaveLength(MAX_ROUNDS);
  });
});

