import { describe, expect, it, vi } from 'vitest';
import { createJourneysHandler } from './handler.js';

// Runtime tests of the journeys endpoint with scripted Supabase clients and storage: they
// check what the endpoint decides (who may read, what is published, what is redacted),
// not the database; the database's own enforcement is covered in tests/database.
const OWNER = '11111111-1111-4111-8111-111111111111', VIEWER = '22222222-2222-4222-8222-222222222222';
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', PHOTO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', PUBLIC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HOME = { kind: 'home', latitude: -34.5, longitude: 150.8, radius: 100 };
const route = [
  { latitude: -34.5, longitude: 150.8, timestamp: 1000.4, segment: 0, accuracy: 5, speed: 3 },   // at Home
  { latitude: -34.6, longitude: 150.9, timestamp: 1100.6, segment: 0, accuracy: 5, speed: 20 },
  { latitude: -34.61, longitude: 150.91, timestamp: 1160, segment: 0, accuracy: 5, speed: 21 },
];
const trip = (over = {}) => ({ id: ID, owner_id: OWNER, revision: 4, title: 'Drive', activity: 'Driving', description: '', started_at: 'a', ended_at: 'b', distance_meters: 1000, duration_seconds: 160, route_points: route, ...over });

function thenable(result) {
  const b = {};
  for (const m of ['select', 'eq', 'in', 'neq', 'order', 'limit', 'delete']) b[m] = (...a) => { b.calls.push([m, ...a]); return b; };
  b.calls = [];
  b.maybeSingle = async () => result; b.single = async () => result;
  b.insert = async row => { b.inserted = row; return { error: null }; };
  b.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return b;
}
function world(over = {}) {
  const w = {
    trip: trip(), places: [HOME], assets: [], deleting: null, budget: true, allowed: [true], rpcErrors: {},
    shared: null, snapshot: null, mediaCount: 0, calls: [], deletes: [], uploads: [], removed: [], ...over,
  };
  w.admin = {
    from: table => {
      if (table === 'account_deletion_requests') return thenable({ data: w.deleting, error: null });
      if (table === 'shared_journeys') { const b = thenable({ data: w.shared, error: null }); const del = b.delete; b.delete = () => { w.deletes.push('shared_journeys'); return del(); }; return b; }
      if (table === 'media_assets') { const b = thenable({ data: w.asset || null, error: null }); b.insert = async row => { w.uploads.push(row); return { error: w.insertError || null }; }; return b; }
      return thenable({ data: null, error: null });
    },
    rpc: async (name, args) => {
      w.calls.push([name, args]);
      if (name === 'consume_operation') return { data: w.budget, error: null };
      if (name === 'auto_share_allowed') return { data: w.allowed.length > 1 ? w.allowed.shift() : w.allowed[0], error: w.rpcErrors[name] || null };
      if (name === 'remember_manual_share') return { data: null, error: w.rpcErrors[name] || null };
      if (name === 'publish_social_journey' || name === 'commit_shared_journey') return { data: 'token-1', error: w.rpcErrors[name] || null };
      return { data: null, error: null };
    },
  };
  const userFor = header => (header === 'Bearer owner' ? { id: OWNER } : header === 'Bearer viewer' ? { id: VIEWER } : null);
  w.client = header => ({
    auth: { getUser: async () => { const user = userFor(header); return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'bad' } }; } },
    from: table => {
      if (table === 'activities') return thenable({ data: w.trip, error: null });
      if (table === 'saved_places') return thenable({ data: w.places, error: null });
      if (table === 'media_assets') { const b = thenable({ data: w.assets, count: w.mediaCount, error: null }); b.maybeSingle = async () => ({ data: w.asset || null, error: null }); return b; }
      return thenable({ data: null, error: null });
    },
    rpc: async (name, args) => {
      w.calls.push([`viewer:${name}`, args]);
      if (name === 'read_social_journey') return w.readError ? { data: null, error: w.readError } : { data: w.snapshot ? { snapshot: w.snapshot } : null, error: null };
      if (name === 'revoke_activity_publication') return { error: w.rpcErrors[name] || null };
      return { data: null, error: null };
    },
  });
  w.handler = createJourneysHandler({
    env: key => ({ SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' }[key]),
    createClient: (url, key, options) => (key === 'service' ? w.admin : w.client(options?.global?.headers?.Authorization || '')),
    storage: { signedGet: async key => `https://signed/${key}`, put: async (key, bytes) => { w.stored = key; }, remove: async key => { w.removed.push(key); } },
  });
  w.post = (body, auth = 'Bearer owner') => w.handler(new Request('https://x/functions/v1/journeys', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  w.get = (query, auth) => w.handler(new Request(`https://x/functions/v1/journeys?${query}`, { method: 'GET', headers: auth ? { Authorization: auth } : {} }));
  return w;
}
const publish = (w, over = {}, auth) => w.post({ action: 'publish', id: ID, revision: 4, placesConfirmed: true, audience: 'household', mode: 'household', recipients: [], ...over }, auth);
const published = w => w.calls.find(c => c[0] === 'publish_social_journey' || c[0] === 'commit_shared_journey');

describe('reading a private shared activity', () => {
  it('requires a signed-in viewer', async () => {
    const w = world();
    expect((await w.get(`activity=${ID}`)).status).toBe(401);
    expect((await w.get(`activity=${ID}`, 'Bearer nonsense')).status).toBe(401);
  });
  it('returns the snapshot the database authorises, and only that', async () => {
    const w = world({ snapshot: { title: 'Shared', points: [] } });
    const response = await w.get(`activity=${ID}`, 'Bearer viewer');
    expect(response.status).toBe(200);
    expect((await response.json()).snapshot.title).toBe('Shared');
    expect(w.calls.find(c => c[0] === 'viewer:read_social_journey')[1]).toEqual({ p_activity: ID });
  });
  it('answers 404 when the database does not authorise the viewer (private, revoked, not shared with them)', async () => {
    const w = world({ snapshot: null });
    expect((await w.get(`activity=${ID}`, 'Bearer viewer')).status).toBe(404);
  });
  it('answers 503 when private sharing is not set up, and 429 over budget', async () => {
    expect((await world({ readError: { message: 'x' } }).get(`activity=${ID}`, 'Bearer viewer')).status).toBe(503);
    expect((await world({ budget: false }).get(`activity=${ID}`, 'Bearer viewer')).status).toBe(429);
  });
  it('refuses a photo that is not in the authorised snapshot', async () => {
    const w = world({ snapshot: { title: 'S', points: [], photos: [{ id: PHOTO }] } });
    expect((await w.get(`activity=${ID}&photo=cccccccc-cccc-4ccc-8ccc-cccccccccccc`, 'Bearer viewer')).status).toBe(404);
    expect((await w.get(`activity=${ID}&photo=not-a-uuid`, 'Bearer viewer')).status).toBe(404);
  });
  it('does not accept an invalid activity identifier', async () => {
    expect((await world().get('activity=nope', 'Bearer viewer')).status).toBe(405);
  });
});

describe('publishing', () => {
  it('shares with the household: Home is hidden, capture times are included, no raw telemetry', async () => {
    const w = world();
    const response = await publish(w);
    expect(response.status).toBe(200);
    const [name, args] = published(w);
    expect(name).toBe('publish_social_journey');
    expect(args).toMatchObject({ p_owner: OWNER, p_activity: ID, p_revision: 4, p_audience: 'household', p_mode: 'household', p_recipients: [] });
    expect(args.p_snapshot.points).toEqual([
      { latitude: -34.6, longitude: 150.9, segment: 1, t: 1101 },
      { latitude: -34.61, longitude: 150.91, segment: 1, t: 1160 },
    ]);
    expect(JSON.stringify(args.p_snapshot)).not.toMatch(/accuracy|speed|timestamp/);
  });
  it('a public link never carries times and uses the public commit', async () => {
    const w = world();
    expect((await publish(w, { audience: 'public', mode: undefined })).status).toBe(200);
    const [name, args] = published(w);
    expect(name).toBe('commit_shared_journey');
    expect(args.p_snapshot.points.every(p => !('t' in p) && !('timestamp' in p))).toBe(true);
    expect(args.p_snapshot.points.length).toBe(2);
  });
  it('shares with chosen friends only, passing exactly those recipients', async () => {
    const w = world();
    expect((await publish(w, { audience: 'friends', mode: 'selected', recipients: [VIEWER] })).status).toBe(200);
    expect(published(w)[1]).toMatchObject({ p_audience: 'friends', p_mode: 'selected', p_recipients: [VIEWER] });
    expect(published(w)[1].p_snapshot.points[0].t).toBe(1101);
  });
  it('rejects bad audiences, modes and recipient lists', async () => {
    expect((await publish(world(), { audience: 'everyone' })).status).toBe(409);
    expect((await publish(world(), { audience: 'friends', mode: 'whatever' })).status).toBe(400);
    expect((await publish(world(), { audience: 'friends', mode: 'selected', recipients: 'x' })).status).toBe(400);
    expect((await publish(world(), { audience: 'friends', mode: 'selected', recipients: Array(101).fill(VIEWER) })).status).toBe(400);
  });
  it('fails closed without a saved Home, without confirmed places, or with a changed activity', async () => {
    expect((await publish(world({ places: [{ ...HOME, kind: 'work' }] }))).status).toBe(409);
    const unconfirmed = world();
    expect((await publish(unconfirmed, { placesConfirmed: false })).status).toBe(400);
    expect(published(unconfirmed)).toBeUndefined();
    expect((await publish(world(), { revision: 3 })).status).toBe(409);
  });
  it('only the owner of an existing activity can publish it', async () => {
    expect((await publish(world({ trip: null }))).status).toBe(404);
    expect((await publish(world({ trip: trip({ owner_id: VIEWER }) }))).status).toBe(404);
    expect((await publish(world(), {}, 'Bearer nobody')).status).toBe(401);
  });
  it('keeps a photo taken at Home out of the snapshot', async () => {
    const w = world({ assets: [{ id: PHOTO, caption: 'x', latitude: -34.5, longitude: 150.8 }, { id: PUBLIC, caption: 'y', latitude: -34.7, longitude: 151 }] });
    await publish(w, { photoIDs: [PHOTO, PUBLIC] });
    expect(published(w)[1].p_snapshot.photos.map(p => p.id)).toEqual([PUBLIC]);
  });
});

describe('automatic household sharing', () => {
  it('publishes when allowed', async () => {
    const w = world({ allowed: [true, true] });
    expect((await publish(w, { auto: true })).status).toBe(200);
    expect(published(w)).toBeTruthy();
    expect(w.deletes).toEqual([]);
  });
  it('is refused before anything is read when the owner already made it private', async () => {
    const w = world({ allowed: [false] });
    const response = await publish(w, { auto: true });
    expect(response.status).toBe(409);
    expect(published(w)).toBeUndefined();
  });
  it('a privacy decision that lands while the request is in flight removes the copy it just made', async () => {
    const w = world({ allowed: [true, false] });          // allowed at the start, private by the time it is published
    const response = await publish(w, { auto: true });
    expect(response.status).toBe(409);
    expect(published(w)).toBeTruthy();                    // it had been published ...
    expect(w.deletes).toEqual(['shared_journeys']);       // ... and is taken straight back down
  });
  it('treats a failed re-check as private, never as allowed', async () => {
    const w = world({ allowed: [true, undefined] });
    expect((await publish(w, { auto: true })).status).toBe(409);
    expect(w.deletes).toEqual(['shared_journeys']);
  });
  it('a manual share is not subject to the automatic check, and is remembered as the owner\'s decision', async () => {
    const w = world({ allowed: [false] });
    expect((await publish(w)).status).toBe(200);
    expect(w.calls.some(c => c[0] === 'auto_share_allowed')).toBe(false);
    expect(w.calls).toContainEqual(['remember_manual_share', { p_owner: OWNER, p_activity: ID }]);
  });
  it('a manual share whose decision could not be recorded is reported as failed so the client retries (publishing is idempotent)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = world({ rpcErrors: { remember_manual_share: new Error('x') } });
    expect((await publish(w)).status).toBe(500);
  });
  it('an automatic share is NOT recorded as a decision, so it can be shared again after the system removes it', async () => {
    const w = world({ allowed: [true, true] });
    await publish(w, { auto: true });
    expect(w.calls.some(c => c[0] === 'remember_manual_share')).toBe(false);
  });
});

describe('status, revoking and request validation', () => {
  it('reports private for something never shared, and the audience when shared', async () => {
    expect(await (await world().post({ action: 'status', id: ID })).json()).toEqual({ audience: 'private', token: null });
    expect(await (await world({ shared: { audience: 'household', token: 't' } }).post({ action: 'status', id: ID })).json()).toEqual({ audience: 'household', token: 't' });
  });
  it('revokes through the owner-checked database function and reports failure', async () => {
    const ok = world();
    expect(await (await ok.post({ action: 'revoke', id: ID })).json()).toEqual({ revoked: true });
    const bad = world({ rpcErrors: { revoke_activity_publication: new Error('x') } });
    expect((await bad.post({ action: 'revoke', id: ID })).status).toBe(500);
  });
  it('rejects missing identifiers, unknown actions and unsupported methods', async () => {
    expect((await world().post({ action: 'status' })).status).toBe(400);
    expect((await world().post({ action: 'explode', id: ID })).status).toBe(400);
    expect((await world().handler(new Request('https://x/', { method: 'PUT' }))).status).toBe(405);
    expect((await world().post({ action: 'status', id: ID }, '')).status).toBe(401);
  });
  it('refuses while an account deletion is in progress and when over budget', async () => {
    expect((await world({ deleting: { owner_id: OWNER } }).post({ action: 'status', id: ID })).status).toBe(409);
    expect((await world({ budget: false }).post({ action: 'status', id: ID })).status).toBe(429);
  });
  it('answers a database failure with a generic error that names the stage but not the cause', async () => {
    const w = world({ rpcErrors: { publish_social_journey: Object.assign(new Error('secret db detail'), { name: 'PostgrestError' }) } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await publish(w);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/secret db detail/);
  });
  it('a public link for something not shared publicly is unavailable', async () => {
    expect((await world({ shared: null }).get(`token=${PUBLIC}`)).status).toBe(404);
  });
});
