import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { backupRope } from '../../src/lib/ropeSkipping.js';
import { viewMetadata } from '../../src/lib/cloudSync.js';
// 20261213000000_rope_skipping_view_metadata.sql against the whole migration chain: the jump
// summary is backed up inside view_metadata through the owner-checked backup RPC, and nothing
// else about the activity row changes.
const db = new PGlite();
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const session = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function as(role, user, sql) {
  await db.exec(`reset role; set role ${role}; select set_config('request.jwt.claim.sub','${user}',false); select set_config('request.jwt.claims','${JSON.stringify({ session_id: session })}',false);`);
  return db.query(sql);
}
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
}, 60000);
afterAll(() => db.close());

let n = 0;
const id = () => `${String(++n).padStart(8, '0')}-3333-4222-8333-444444444444`;
const payload = (tripID, view) => JSON.stringify({ id: tripID, title: 'Skipping', activity: 'Rope skipping', recording_mode: 'watch', started_at: '2026-11-17T00:00:00Z', ended_at: '2026-11-17T00:15:00Z', duration_seconds: 900, distance_meters: 0, route_points: [], view_metadata: view }).replaceAll("'", "''");
const backup = (owner, tripID, view, hash = 'a') => as('authenticated', owner, `select public.backup_private_activity('${owner}','${payload(tripID, view)}','${hash.repeat(64)}',null) as revision`);
const summary = (overrides = {}) => ({ jumps: 1250, totalSeconds: 900, activeSeconds: 690, intervalCount: 2, intervals: [{ start: 1000, end: 1300, jumps: 600 }, { start: 1500, end: 1900, jumps: 650 }], ...overrides });

it('backs up the summary the app sends, beside the other view keys', async () => {
  const tripID = id();
  const sent = viewMetadata({ ropeSkipping: { ...summary(), restSeconds: 210, averageCadence: 108.7 }, startPlace: 'Home', coverPhotoID: 'photo-1' });
  expect(Object.keys(sent).sort()).toEqual(['coverPhotoID', 'ropeSkipping', 'startPlace']);
  expect((await backup(a, tripID, sent)).rows[0].revision).toBe(1);
  const stored = (await as('authenticated', a, `select activity, view_metadata from public.activities where id='${tripID}'`)).rows[0];
  expect(stored.activity).toBe('Rope skipping');
  expect(stored.view_metadata.ropeSkipping).toEqual(backupRope(summary()));
  expect(stored.view_metadata.ropeSkipping.restSeconds).toBeUndefined();
});

it('accepts a zero-jump workout and an empty interval list', async () => {
  expect((await backup(a, id(), { ropeSkipping: summary({ jumps: 0, activeSeconds: 0, intervalCount: 0, intervals: [] }) })).rows[0].revision).toBe(1);
});

it('keeps every earlier view_metadata valid and still rejects unknown keys', async () => {
  expect((await backup(a, id(), { visibleRouteStart: 2, visibleRouteEnd: 40, startPlace: 'Home', endPlace: 'Beach', coverPhotoID: 'photo-1' })).rows[0].revision).toBe(1);
  expect((await backup(a, id(), {})).rows[0].revision).toBe(1);
  await expect(backup(a, id(), { somethingElse: 'x' })).rejects.toThrow();
});

it('rejects malformed summaries as a check failure, never a cast error', async () => {
  const bad = [
    summary({ jumps: -1 }), summary({ jumps: 100001 }), summary({ jumps: 'many' }), summary({ jumps: null }), summary({ totalSeconds: 'long' }),
    summary({ activeSeconds: 901 }), summary({ activeSeconds: -3 }), summary({ intervalCount: 1.5e9 }), summary({ intervals: 'x' }),
    summary({ intervals: [{ start: 5, end: 1, jumps: 3 }] }), summary({ intervals: [{ start: 1, end: 5, jumps: 0 }] }), summary({ intervals: [{ start: 1, end: 5 }] }),
    summary({ intervals: [{ start: 1, end: 5, jumps: 3, extra: 1 }] }), summary({ intervals: [42] }),
    summary({ intervals: Array.from({ length: 201 }, (_, i) => ({ start: i, end: i + 1, jumps: 1 })) }),
    summary({ extra: 'y'.repeat(2000) }), 'not an object', [], 42, null,
  ];
  for (const ropeSkipping of bad) {
    await expect(backup(a, id(), { ropeSkipping })).rejects.toThrow(/check|violat/i);
  }
});

it('stays private to its owner like every other activity row', async () => {
  const tripID = id();
  await backup(a, tripID, { ropeSkipping: summary() });
  expect((await as('authenticated', b, `select count(*)::int as n from public.activities where id='${tripID}'`)).rows[0].n).toBe(0);
});

// 20261214000000_rope_skipping_validation_fix.sql
const check = async (value) => (await db.query(`select public.valid_rope_skipping(${value === undefined ? 'null' : `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`}) as ok`)).rows[0].ok;

it('answers true or false for any value and never raises', async () => {
  const odd = [
    undefined, null, 'x', 7, true, [], {}, { jumps: 1 },
    summary({ intervals: 'x' }), summary({ intervals: {} }), summary({ intervals: 5 }), summary({ intervals: null }), summary({ intervals: [null] }), summary({ intervals: [[1, 2]] }),
    summary({ jumps: {} }), summary({ jumps: [] }), summary({ totalSeconds: null }), summary({ activeSeconds: 'x' }), summary({ intervalCount: false }),
    summary({ intervals: [{ start: 'a', end: 2, jumps: 1 }] }), summary({ intervals: [{ start: 1, end: {}, jumps: 1 }] }),
  ];
  for (const value of odd) expect([true, false], JSON.stringify(value)).toContain(await check(value));
  for (const value of odd) expect(await check(value), JSON.stringify(value)).toBe(false);
  expect((await db.query(`select public.valid_rope_skipping(null::jsonb) as ok`)).rows[0].ok).toBe(false);
  expect((await db.query(`select public.valid_rope_skipping('null'::jsonb) as ok`)).rows[0].ok).toBe(false);
});

it('requires every field, including intervals', async () => {
  expect(await check(summary())).toBe(true);
  for (const field of ['jumps', 'totalSeconds', 'activeSeconds', 'intervalCount', 'intervals']) {
    const value = summary(); delete value[field];
    expect(await check(value), `missing ${field}`).toBe(false);
  }
  expect(await check(summary({ extra: 1 }))).toBe(false);
});

it('keeps its bounds, at and either side of each', async () => {
  expect(await check(summary({ jumps: 0, activeSeconds: 0, totalSeconds: 0, intervalCount: 0, intervals: [] }))).toBe(true);
  expect(await check(summary({ jumps: 10, activeSeconds: 0 }))).toBe(true);          // 5 a second plus a little slack
  expect(await check(summary({ jumps: 11, activeSeconds: 0 }))).toBe(false);
  expect(await check(summary({ jumps: 100000, totalSeconds: 1000000, activeSeconds: 20000 }))).toBe(true);
  expect(await check(summary({ jumps: 100001, totalSeconds: 1000000, activeSeconds: 100000 }))).toBe(false);
  expect(await check(summary({ totalSeconds: 1000000, activeSeconds: 1000000, jumps: 5 }))).toBe(true);
  expect(await check(summary({ totalSeconds: 1000001 }))).toBe(false);
  expect(await check(summary({ activeSeconds: 900 }))).toBe(true);
  expect(await check(summary({ activeSeconds: 900.5 }))).toBe(false);
  expect(await check(summary({ intervalCount: 10000 }))).toBe(true);
  expect(await check(summary({ intervalCount: 10001 }))).toBe(false);
  const many = n => Array.from({ length: n }, (_, i) => ({ start: i, end: i + 1, jumps: 1 }));
  expect(await check(summary({ intervals: many(200) }))).toBe(true);
  expect(await check(summary({ intervals: many(201) }))).toBe(false);
  expect(await check(summary({ intervals: [{ start: 1, end: 1, jumps: 1 }] }))).toBe(true);
  expect(await check(summary({ intervals: [{ start: 2, end: 1, jumps: 1 }] }))).toBe(false);
  expect(await check(summary({ intervals: [{ start: 1, end: 2, jumps: 100000 }] }))).toBe(true);
  expect(await check(summary({ intervals: [{ start: 1, end: 2, jumps: 100001 }] }))).toBe(false);
});

it('still accepts what the app sends', async () => {
  const sent = backupRope({ ...summary(), restSeconds: 210, averageCadence: 108.7 });
  expect(await check(sent)).toBe(true);
  expect((await backup(a, id(), { ropeSkipping: sent })).rows[0].revision).toBe(1);
});

it('a summary without intervals is a clean check failure, not a pass and not a crash', async () => {
  const value = summary(); delete value.intervals;
  await expect(backup(a, id(), { ropeSkipping: value })).rejects.toThrow(/check|violat/i);
  await expect(backup(a, id(), { ropeSkipping: summary({ intervals: 'x' }) })).rejects.toThrow(/check|violat/i);
  // A bad summary on one activity does not affect another activity's backup.
  expect((await backup(a, id(), { startPlace: 'Home' })).rows[0].revision).toBe(1);
});

it('treats a NULL answer from a nested validator as invalid in view_metadata', async () => {
  const ok = async (view) => (await db.query(`select public.valid_view_metadata('${JSON.stringify(view)}'::jsonb) as ok`)).rows[0].ok;
  expect(await ok({ ropeSkipping: summary() })).toBe(true);
  expect(await ok({ ropeSkipping: { jumps: 1 } })).toBe(false);
  expect(await ok({ ropeSkipping: summary({ intervals: null }) })).toBe(false);
  expect(await ok({ namedSegments: 'x' })).toBe(false);
  expect(await ok({ startPlace: 'Home', ropeSkipping: summary(), visibleRouteStart: 1, visibleRouteEnd: 2, endPlace: 'x', coverPhotoID: 'p' })).toBe(true);
});

it('accepts Rope skipping as a journey activity type, like every other', async () => {
  const insert = type => db.exec(`reset role; insert into public.journey_activity_metadata(owner_id,ref,type) values('${a}','${id()}','${type}')`);
  for (const type of ['Gym', 'Rope skipping', 'MTB', 'Unknown']) await insert(type);
  await expect(insert('Underwater basket weaving')).rejects.toThrow(/check|violat/i);
});
