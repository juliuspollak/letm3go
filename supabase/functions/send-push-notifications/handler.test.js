import { describe, expect, it, vi } from 'vitest';
import { createPushHandler, BUNDLE_ID } from './handler.js';

const TOKEN_A = 'a'.repeat(64), TOKEN_B = 'b'.repeat(64);
const delivery = (id, token, extra = {}) => ({ delivery_id: id, claim_token: `claim-${id}`, apns_token: token, environment: 'production', notification_id: 100 + id, kind: 'poke', title: 'Poke', body: 'Ann poked you 👋', route: { screen: 'home' }, badge: 1, ...extra });
const secrets = { APNS_KEY_ID: 'KEY1234567', APNS_TEAM_ID: 'TEAM123456', APNS_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----' };
const apple = (status, reason) => new Response(reason ? JSON.stringify({ reason }) : '', { status });

function setup({ claimed = [], env = secrets, user = { id: 'u1' }, budget = true, responses = [] } = {}) {
  const finished = [], logs = [], queue = [...responses];
  const rpc = vi.fn(async (name, args) => {
    if (name === 'consume_operation') return { data: budget };
    if (name === 'claim_push_deliveries') { const rows = claimed; claimed = []; return { data: rows }; }
    if (name === 'finish_push_delivery') { finished.push(args); return { data: args.p_status === 'invalid_token' ? 'failed' : args.p_status }; }
    return { data: null };
  });
  const fetch = vi.fn(async () => { const next = queue.shift(); if (next instanceof Error) throw next; return next || apple(200); });
  const sign = vi.fn(async ({ pem }) => { if (!pem.includes('\nabc\n')) throw new Error('bad pem'); return 'provider.jwt'; });
  const handler = createPushHandler({
    env: key => env[key], fetch, sign, log: event => logs.push(event),
    caller: () => ({ auth: { getUser: async () => (user ? { data: { user } } : { data: { user: null }, error: { message: 'no' } }) } }),
    admin: () => ({ rpc }),
  });
  const wake = () => handler(new Request('https://x/functions/v1/send-push-notifications', { method: 'POST', headers: { Authorization: 'Bearer user.jwt' }, body: '{}' }));
  return { wake, fetch, sign, rpc, finished, logs };
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
    const t = setup({ claimed: [delivery(1, TOKEN_A)], env: {} });
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

  it('requires a signed-in caller and respects the wake budget', async () => {
    expect((await setup({ user: null }).wake()).status).toBe(401);
    const limited = setup({ budget: false, claimed: [delivery(1, TOKEN_A)] });
    expect(await (await limited.wake()).json()).toMatchObject({ rateLimited: true });
    expect(limited.fetch).not.toHaveBeenCalled();
  });

  it('logs delivery metadata but never device tokens, message text or key material', async () => {
    const t = setup({ claimed: [delivery(1, TOKEN_A)] });
    await t.wake();
    const text = JSON.stringify(t.logs);
    expect(text).toContain('apns_delivery');
    for (const secret of [TOKEN_A, 'Ann poked you', 'provider.jwt', 'PRIVATE KEY', 'KEY1234567']) expect(text).not.toContain(secret);
  });
});
