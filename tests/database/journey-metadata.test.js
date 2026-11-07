import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it } from 'vitest';
const db = new PGlite();
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const session = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function as(role, user, sql) {
  await db.exec(`reset role; set role ${role}; select set_config('request.jwt.claim.sub','${user}',false); select set_config('request.jwt.claims','${JSON.stringify({ session_id: session })}',false);`);
  return db.query(sql);
}
// The payloads are exactly what src/lib/journeyMetadata.js queues: record values
// keyed by domain, plus the once-per-account enrichment cutoff.
const snapshot = owner => `select public.journey_metadata_snapshot('${owner}') as data`;
const revision = owner => `select public.journey_metadata_revision('${owner}') as revision`;
const apply = (owner, changes, expected = 'null') =>
  `select public.journey_apply_changes('${owner}',$journey$${JSON.stringify(changes)}$journey$,${expected}) as data`;
const mine = (user, changes, expected = 'null') => as('authenticated', user, apply(user, changes, expected));
const read = async (user = a) => (await as('authenticated', user, snapshot(user))).rows[0].data;
// The pull answer carries the cloud revision next to the grouping; the app drops the
// bookkeeping keys before validating, so the test does the same.
const grouping = data => {
  const copy = { ...data };
  delete copy.revision;
  delete copy.updatedAt;
  return copy;
};
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
    insert into auth.users values('${a}','{}'),('${b}','{}'); insert into auth.sessions values('${session}','${a}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const name of (await readdir('supabase/migrations')).filter(n => n.endsWith('.sql')).sort()) await db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
}, 30000);
afterAll(() => db.close());

const journey = {
  enrichFrom: 1700000000000,
  activities: [
    { ref: 'a', title: 'Morning drive', type: 'Driving', manualTags: ['work', 'early'], hiddenTags: [], enrichedAt: 1700000100000 },
    { ref: 'b', title: null, type: 'Walking', manualTags: [], hiddenTags: ['internal'], enrichedAt: null },
  ],
  // Reversed on purpose: a merge is the same record whichever side it is sent from.
  pairs: [
    { relation: 'link', left: 'b', right: 'a' },
    { relation: 'cut', left: 'a', right: 'c' },
    { relation: 'source', left: 'b', right: 'd' },
  ],
  stops: [
    { ref: 'dwell:a:1700000000', name: 'Cafe Anna', tags: ['coffee'], replaceTags: true },
    { ref: 'native:c:1700000600', ignored: true },
  ],
  places: [{ ref: '52.5163,13.3777', lookup: { nearbyName: 'Brandenburg Gate', categories: ['park'] } }],
  roads: [{ ref: 'a:1700000000:1700000060', record: { version: 2, status: 'route', distanceMeters: 800, line: 'abc' } }],
  summaries: [{ ref: 'a', snapshot: { distanceMeters: 1200, pointCount: 340 } }],
};

it('hands back an empty grouping before anything is stored', async () => {
  const data = await read();
  expect(data).toMatchObject({ version: 1, owner: a, links: [], cuts: [], sourceLinks: [], history: [],
    titles: {}, types: {}, manualTags: {}, hiddenTags: {}, enriched: {}, places: {}, roads: {},
    stopEdits: {}, distanceSummaries: {}, enrichFrom: null, revision: null, updatedAt: null });
  expect((await as('authenticated', a, revision(a))).rows[0].revision).toBeNull();
  const parsed = await import('../../src/lib/journeyGrouping.js');
  expect(parsed.validateGrouping(grouping(data), a)).not.toBeNull();
});

it('stores every decision and derived answer as one record each', async () => {
  expect((await mine(a, journey)).rows[0].data.revision).toBe(1);
  const data = await read();
  expect(data).toMatchObject({
    titles: { a: 'Morning drive' }, types: { a: 'Driving', b: 'Walking' },
    manualTags: { a: ['work', 'early'] }, hiddenTags: { b: ['internal'] },
    enriched: { a: 1700000100000 },
    links: ['["a","b"]'], cuts: ['["a","c"]'], sourceLinks: [['b', 'd']],
    stopEdits: { 'dwell:a:1700000000': { name: 'Cafe Anna', tags: ['coffee'], replaceTags: true },
      'native:c:1700000600': { ignored: true } },
    enrichFrom: 1700000000000, revision: 1,
  });
  expect(data.places['52.5163,13.3777']).toEqual({ nearbyName: 'Brandenburg Gate', categories: ['park'] });
  expect(data.roads['a:1700000000:1700000060'].distanceMeters).toBe(800);
  expect(data.distanceSummaries.a.pointCount).toBe(340);
  expect(Number.isFinite(Date.parse(data.updatedAt))).toBe(true);
  // The same answer the app validates locally, so a pull needs no translation.
  const parsed = await import('../../src/lib/journeyGrouping.js');
  expect(parsed.validateGrouping(grouping(data), a)).toMatchObject({ owner: a, titles: { a: 'Morning drive' } });
  const counts = await as('authenticated', a, `select
    (select count(*) from public.journey_activity_metadata where owner_id='${a}') as activities,
    (select count(*) from public.journey_pair_metadata where owner_id='${a}') as pairs,
    (select count(*) from public.journey_stop_metadata where owner_id='${a}') as stops`);
  expect(counts.rows[0]).toMatchObject({ activities: 2, pairs: 3, stops: 2 });
});

it('re-sends a value without duplicating it and refuses a stale write', async () => {
  // A retried request is the same records: one row, one more revision.
  expect((await mine(a, { activities: [journey.activities[0]] }, 1)).rows[0].data.revision).toBe(2);
  expect((await as('authenticated', a, `select count(*) as total from public.journey_activity_metadata where owner_id='${a}'`)).rows[0].total).toBe(2);
  await expect(mine(a, { activities: [{ ref: 'a', title: 'Stale' }] }, 1)).rejects.toThrow('conflict');
  expect((await read()).titles.a).toBe('Morning drive');
  expect((await mine(a, { activities: [{ ref: 'a', title: 'Renamed' }] }, 2)).rows[0].data.revision).toBe(3);
  expect((await read()).titles.a).toBe('Renamed');
});

it('writes nothing at all when one record in a batch is refused', async () => {
  await expect(mine(a, { activities: [{ ref: 'e', title: 'New' }], places: [{ ref: '0,0', lookup: 'nonsense' }] }, 3))
    .rejects.toThrow('Invalid place answer');
  const data = await read();
  expect(data.titles.e).toBeUndefined();
  expect(data.revision).toBe(3);
});

it('removes what the user undid and leaves everything else alone', async () => {
  expect((await mine(a, {
    activities: [{ ref: 'a', delete: true }],
    pairs: [{ relation: 'link', left: 'a', right: 'b', delete: true }],
    stops: [{ ref: 'dwell:a:1700000000', name: null }],
    roads: [{ ref: 'a:1700000000:1700000060', delete: true }],
  }, 3)).rows[0].data.revision).toBe(4);
  const data = await read();
  expect(data.titles.a).toBeUndefined();
  expect(data.links).toEqual([]);
  expect(data.cuts).toEqual(['["a","c"]']);
  expect(data.stopEdits['dwell:a:1700000000']).toBeUndefined();
  expect(data.roads).toEqual({});
  // Domains the batch did not mention keep their answers.
  expect(data.distanceSummaries.a).toEqual({ distanceMeters: 1200, pointCount: 340 });
  expect(data.places['52.5163,13.3777'].nearbyName).toBe('Brandenburg Gate');
});

it('decides the enrichment cutoff once per account', async () => {
  expect((await mine(a, { enrichFrom: 1800000000000 }, 4)).rows[0].data.revision).toBe(5);
  expect((await read()).enrichFrom).toBe(1700000000000);
  expect((await mine(b, { enrichFrom: 1900000000000 })).rows[0].data.revision).toBe(1);
  expect((await read(b)).enrichFrom).toBe(1900000000000);
});

it('refuses another account and hides its records', async () => {
  await expect(as('authenticated', a, snapshot(b))).rejects.toThrow('owner mismatch');
  await expect(as('authenticated', a, apply(b, { activities: [{ ref: 'x', title: 'Hijack' }] }))).rejects.toThrow();
  await expect(as('authenticated', a, revision(b))).rejects.toThrow('owner mismatch');
  expect((await as('authenticated', b, `select count(*) as total from public.journey_activity_metadata where owner_id='${a}'`)).rows[0].total).toBe(0);
  expect((await as('authenticated', b, `select count(*) as total from public.journey_metadata_state where owner_id='${a}'`)).rows[0].total).toBe(0);
  await expect(as('anon', '', snapshot(a))).rejects.toThrow(/owner mismatch|permission denied/);
  await expect(as('anon', '', `select count(*) from public.journey_activity_metadata`)).rejects.toThrow();
});

it('refuses changes the grouping screen could not have produced', async () => {
  await expect(mine(a, { history: [] })).rejects.toThrow('Unsupported journey change domain');
  await expect(mine(a, { titles: {} })).rejects.toThrow('Unsupported journey change domain');
  await expect(mine(a, { activities: 'nope' })).rejects.toThrow('must be lists');
  await expect(mine(a, { activities: [{ ref: 'a', type: 'Teleporting' }] })).rejects.toThrow('activity type');
  await expect(mine(a, { activities: [{ ref: 'x'.repeat(81), title: 'Long' }] })).rejects.toThrow('Invalid activity reference');
  await expect(mine(a, { activities: [{ ref: 'a', title: 'x'.repeat(151) }] })).rejects.toThrow('Invalid journey title');
  await expect(mine(a, { activities: [{ ref: 'a', manualTags: Array.from({ length: 21 }, (_, index) => `t${index}`) }] }))
    .rejects.toThrow('Too many journey tags');
  await expect(mine(a, { pairs: [{ relation: 'link', left: 'a', right: 'a' }] })).rejects.toThrow('Invalid journey pair');
  await expect(mine(a, { pairs: [{ relation: 'merge', left: 'a', right: 'b' }] })).rejects.toThrow('pair relation');
  await expect(mine(a, { stops: [{ ref: 'nope', name: 'x'.repeat(101) }] })).rejects.toThrow('Invalid stop name');
  await expect(mine(a, { summaries: [{ ref: 'a', snapshot: [] }] })).rejects.toThrow('Invalid distance summary answer');
  expect((await read()).revision).toBe(5);
});

it('reports a record it replaced instead of replacing it silently', async () => {
  // Two devices answer the same question at the same time. The later write still wins,
  // because a record is a value, but its answer names what it replaced.
  expect((await mine(a, { activities: [{ ref: 'a', title: 'Renamed on the iPhone' }] }, 5)).rows[0].data)
    .toEqual({ revision: 6, overwritten: [] });
  const second = (await mine(a, { activities: [{ ref: 'a', title: 'Renamed on the iPad' }] }, 6)).rows[0].data;
  expect(second.revision).toBe(7);
  expect(second.overwritten).toEqual([{ domain: 'activities', ref: 'a' }]);
  // Re-sending the value the cloud already holds is not an overwrite.
  expect((await mine(a, { activities: [{ ref: 'a', title: 'Renamed on the iPad' }] }, 7)).rows[0].data)
    .toEqual({ revision: 8, overwritten: [] });
  // Stop corrections and derived answers report the same way, in the order they land.
  expect((await mine(a, {
    stops: [{ ref: 'native:c:1700000600', name: 'Supermarket' }],
    places: [{ ref: '52.5163,13.3777', lookup: { nearbyName: 'Pariser Platz' } }],
  }, 8)).rows[0].data.overwritten).toEqual([
    { domain: 'stops', ref: 'native:c:1700000600' },
    { domain: 'places', ref: '52.5163,13.3777' },
  ]);
});

it('removes every record with the account', async () => {
  const c = '33333333-3333-4333-8333-333333333333';
  await db.exec(`reset role; insert into auth.users values('${c}','{}')`);
  await mine(c, { activities: [{ ref: 'z', title: 'Last drive' }], places: [{ ref: '1,2', lookup: { kind: 'park' } }] });
  expect((await as('service_role', '', `select count(*) as total from public.journey_activity_metadata where owner_id='${c}'`)).rows[0].total).toBe(1);
  await db.exec(`reset role; delete from auth.users where id='${c}'`);
  const left = await as('service_role', '', `select
    (select count(*) from public.journey_metadata_state where owner_id='${c}') as state,
    (select count(*) from public.journey_activity_metadata where owner_id='${c}') as activities,
    (select count(*) from public.journey_place_metadata where owner_id='${c}') as places`);
  expect(left.rows[0]).toEqual({ state: 0, activities: 0, places: 0 });
});
