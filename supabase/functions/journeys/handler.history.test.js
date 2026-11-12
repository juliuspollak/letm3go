import { describe, expect, it } from 'vitest';
import { createJourneysHandler } from './handler.js';

// The historical backfill action: what it decides (consent, Home, which activities, what is published), with scripted
// clients. The database's own rules (eligibility, consent locks, withdrawal) are covered in tests/database.
const OWNER = '11111111-1111-4111-8111-111111111111';
const HOME = { kind: 'home', latitude: -34.5, longitude: 150.8, radius: 100 };
const route = [
  { latitude: -34.5, longitude: 150.8, timestamp: 1000.4, segment: 0 },   // at Home: must not be shared raw
  { latitude: -34.6, longitude: 150.9, timestamp: 1100.6, segment: 0 },
  { latitude: -34.61, longitude: 150.91, timestamp: 1160, segment: 0 },
];
const id = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const activity = n => ({ id: id(n), owner_id: OWNER, revision: n, title: `Drive ${n}`, activity: 'Driving', description: '', started_at: '2026-10-2' + n, ended_at: '2026-10-2' + n, distance_meters: 1000, duration_seconds: 160, route_points: route });

function world({ enabled = true, places = [HOME], pending = [1, 2, 3], notAllowed = [], failPublish = [], waitingAfter = 0 } = {}) {
  const w = { calls: [], published: [], queue: [...pending], lookups: 0 };
  const rows = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map(n => [id(n), activity(n)]));
  w.admin = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    rpc: async (name, args) => {
      w.calls.push([name, args]);
      if (name === 'consume_operation') return { data: true, error: null };
      if (name === 'auto_share_allowed') return { data: !notAllowed.includes(args.p_activity), error: null };
      if (name === 'publish_social_journey') {
        if (failPublish.includes(args.p_activity)) return { data: null, error: { message: 'Activity revision changed' } };
        w.published.push(args); w.queue = w.queue.filter(n => id(n) !== args.p_activity); return { data: 'token', error: null };
      }
      return { data: null, error: null };
    },
  };
  const thenable = result => { const b = { select: () => b, eq: () => b, in: () => b, maybeSingle: async () => result, then: (a, r) => Promise.resolve(result).then(a, r) }; return b; };
  w.client = header => ({
    auth: { getUser: async () => (header === 'Bearer owner' ? { data: { user: { id: OWNER } }, error: null } : { data: { user: null }, error: { message: 'bad' } }) },
    from: table => {
      if (table === 'saved_places') return thenable({ data: places, error: null });
      if (table === 'activities') { const b = { select: () => b, eq: (_c, value) => { b.id = value; return b; }, maybeSingle: async () => ({ data: rows[b.id] || null, error: null }) }; return b; }
      return thenable({ data: null, error: null });
    },
    rpc: async (name, args) => {
      w.calls.push([`owner:${name}`, args]);
      if (name === 'my_history_sharing') return { data: { enabled, waiting: w.queue.length || waitingAfter }, error: null };
      if (name === 'my_auto_share_pending') return { data: w.queue.filter(n => !(args.p_exclude || []).includes(id(n))).slice(0, args.p_limit).map(n => ({ activity_id: id(n), revision: n })), error: null };
      return { data: null, error: null };
    },
  });
  w.handler = createJourneysHandler({
    env: key => ({ SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' }[key]),
    createClient: (url, key, options) => (key === 'service' ? w.admin : w.client(options?.global?.headers?.Authorization || '')),
    storage: { signedGet: async () => '', put: async () => {}, remove: async () => {} },
  });
  w.post = (body = {}) => w.handler(new Request('https://x/functions/v1/journeys', { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'backfillHistory', ...body }) }));
  return w;
}
const json = async response => ({ status: response.status, body: await response.json() });

describe('backfillHistory', () => {
  it('does nothing for an owner who has not agreed, and never infers consent', async () => {
    const w = world({ enabled: false });
    const { status, body } = await json(await w.post());
    expect(status).toBe(403);
    expect(w.published).toHaveLength(0);
    expect(w.calls.some(c => c[0] === 'owner:my_auto_share_pending')).toBe(false);
  });
  it('without a saved Home place it publishes nothing (the route could not be masked) and says why', async () => {
    const w = world({ places: [] });
    const { body } = await json(await w.post());
    expect(body).toMatchObject({ published: 0, needsHome: true, remaining: 3 });
    expect(w.published).toHaveLength(0);
  });
  it('publishes the stored activities through the one atomic path, masked, to the household only', async () => {
    const w = world({ pending: [1, 2] });
    const { body } = await json(await w.post());
    expect(body).toMatchObject({ published: 2, failed: 0, remaining: 0, needsHome: false });
    expect(w.published).toHaveLength(2);
    for (const args of w.published) {
      expect(args).toMatchObject({ p_owner: OWNER, p_audience: 'household', p_mode: 'household', p_recipients: [], p_auto: true });
      // Masked: the point at Home is not in what recipients get, and capture times are (private audience).
      const points = args.p_snapshot.points;
      expect(JSON.stringify(points)).not.toContain('-34.5,');
      expect(points.length).toBeGreaterThan(0);
      expect(points[0]).toHaveProperty('t');
      expect(args.p_snapshot.photos).toEqual([]);
    }
  });
  it('is a bounded batch: asks for few at a time and reports what is left, so the caller continues', async () => {
    const w = world({ pending: [1, 2, 3, 4, 5, 6, 7, 8] });
    const { body } = await json(await w.post());
    expect(body.published).toBe(5);
    expect(body.remaining).toBe(3);
    const asked = w.calls.filter(c => c[0] === 'owner:my_auto_share_pending').map(c => c[1].p_limit);
    expect(Math.max(...asked)).toBeLessThanOrEqual(5);
  });
  it('asks the database again before each publication, and skips one that is no longer allowed (made private meanwhile)', async () => {
    const w = world({ pending: [1, 2], notAllowed: [id(1)] });
    const { body } = await json(await w.post());
    expect(w.published.map(a => a.p_activity)).toEqual([id(2)]);
    expect(body.failed).toBe(1);
  });
  it('a failing activity does not hold up the rest, and a retry picks up exactly what is left', async () => {
    const w = world({ pending: [1, 2, 3], failPublish: [id(1)] });
    const first = (await json(await w.post())).body;
    expect(first).toMatchObject({ published: 2, failed: 1 });
    expect(w.published.map(a => a.p_activity).sort()).toEqual([id(2), id(3)]);
    // Retried later (the revision conflict has cleared): only the one left is published, nothing twice.
    const second = world({ pending: [1] });
    const again = (await json(await second.post())).body;
    expect(again).toMatchObject({ published: 1, failed: 0, remaining: 0 });
  });
  it('sets aside a recording with no route instead of publishing or failing it', async () => {
    const w = world({ pending: [1, 2] });
    const original = w.client;
    w.client = header => { const c = original(header); const from = c.from; c.from = table => { if (table === 'activities') { const b = { select: () => b, eq: (_k, v) => { b.id = v; return b; }, maybeSingle: async () => ({ data: { ...activity(b.id === id(1) ? 1 : 2), route_points: b.id === id(1) ? [] : route }, error: null }) }; return b; } return from(table); }; return c; };
    const { body } = await json(await w.post());
    expect(w.published.map(a => a.p_activity)).toEqual([id(2)]);
    expect(body.failed).toBe(0);
  });
  it('running it again when nothing is left publishes nothing', async () => {
    const w = world({ pending: [] });
    const { body } = await json(await w.post());
    expect(body).toMatchObject({ published: 0, failed: 0, remaining: 0 });
    expect(w.published).toHaveLength(0);
  });
  it('requires a signed-in owner', async () => {
    const w = world();
    const response = await w.handler(new Request('https://x/functions/v1/journeys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'backfillHistory' }) }));
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
