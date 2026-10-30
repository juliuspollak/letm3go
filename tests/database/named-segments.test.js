import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { backupSegments } from '../../src/lib/cloudSync.js';
// 20261107000000_activity_named_segments.sql against the whole migration chain:
// named segments in view_metadata and Apple Watch recordings, through the
// owner-checked backup RPC.
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
const id = () => `${String(++n).padStart(8, '0')}-1111-4222-8333-444444444444`;
const segment = (overrides = {}) => ({ id: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Rock Garden Descent', startIndex: 2, endIndex: 12, startTimestamp: 1020, endTimestamp: 1120, distanceMeters: 240, durationSeconds: 100, gapSeconds: 0, pointCount: 11, colorIndex: 0, visibility: 'private', createdAt: 1, updatedAt: 2, ...overrides });
const payload = (tripID, view, mode = 'manual') => JSON.stringify({ id: tripID, title: 'Ride', activity: 'MTB', recording_mode: mode, started_at: '2026-10-30T00:00:00Z', ended_at: '2026-10-30T00:30:00Z', duration_seconds: 1800, distance_meters: 5000, route_points: [], view_metadata: view }).replaceAll("'", "''");
const backup = (owner, tripID, view, mode, hash = 'a') => as('authenticated', owner, `select public.backup_private_activity('${owner}','${payload(tripID, view, mode)}','${hash.repeat(64)}',null) as revision`);

it('accepts the segments the app sends, alongside the existing view keys', async () => {
  const tripID = id();
  const view = { visibleRouteStart: 1, visibleRouteEnd: 40, startPlace: 'Home', endPlace: 'Trailhead', coverPhotoID: 'photo-1',
    namedSegments: backupSegments([{ ...segment(), geometry: [[[1, 2], [3, 4]]] }, segment({ id: 'a1b2c3d4-0000-4000-8000-000000000002', name: 'Climb', startIndex: 8, endIndex: 30, colorIndex: 1 })]) };
  expect((await backup(a, tripID, view)).rows[0].revision).toBe(1);
  const stored = (await as('authenticated', a, `select view_metadata from public.activities where id='${tripID}'`)).rows[0].view_metadata;
  expect(stored.namedSegments.map(s => s.name)).toEqual(['Rock Garden Descent', 'Climb']);
  expect(stored.namedSegments[0].geometry).toBeUndefined();
});

it('keeps every view_metadata valid before the migration valid', async () => {
  expect((await backup(a, id(), { visibleRouteStart: 2, visibleRouteEnd: 40, startPlace: 'Home', endPlace: 'Beach', coverPhotoID: 'photo-1' })).rows[0].revision).toBe(1);
  expect((await backup(a, id(), {})).rows[0].revision).toBe(1);
  await expect(backup(a, id(), { somethingElse: 'x' })).rejects.toThrow();
});

it('rejects malformed segments as a check failure, never a cast error', async () => {
  const bad = [
    [segment({ startIndex: 'abc' })], [segment({ endIndex: null })], [segment({ startIndex: 12, endIndex: 2 })], [segment({ startIndex: 1.5 })],
    [segment({ startIndex: -1 })], [segment({ endIndex: 50000 })], [segment({ name: '   ' })], [segment({ name: 'x'.repeat(81) })],
    [segment({ id: 'not-a-uuid' })], [segment({ visibility: 'public' })], [segment({ geometry: [] })], [segment({ distanceMeters: -5 })],
    [segment({ durationSeconds: 'long' })], [segment(), segment()], Array.from({ length: 21 }, (_, i) => segment({ id: `a1b2c3d4-0000-4000-8000-0000000001${String(i).padStart(2, '0')}` })),
    [], 'not an array', [42], [segment({ name: 'x'.repeat(40), extra: 'y'.repeat(1000) })],
  ];
  for (const namedSegments of bad) {
    await expect(backup(a, id(), { namedSegments }), JSON.stringify(namedSegments).slice(0, 80)).rejects.toThrow(/activities_view_metadata_shape|check constraint/);
  }
});

it('keeps segments owner-only: another account can neither read nor write them', async () => {
  const tripID = id();
  await backup(a, tripID, { namedSegments: backupSegments([segment()]) });
  expect((await as('authenticated', b, `select view_metadata from public.activities where id='${tripID}'`)).rows).toHaveLength(0);
  await expect(as('authenticated', b, `select public.backup_private_activity('${a}','${payload(tripID, {})}','${'b'.repeat(64)}',1)`)).rejects.toThrow('owner mismatch');
  await expect(as('authenticated', b, `update public.activities set view_metadata='{}' where id='${tripID}'`).then(r => r.affectedRows)).resolves.toBe(0);
});

it('accepts Apple Watch recordings with their own recording mode, and the manual fallback', async () => {
  expect((await backup(a, id(), {}, 'watch')).rows[0].revision).toBe(1);
  expect((await backup(a, id(), {}, 'manual')).rows[0].revision).toBe(1);
  await expect(backup(a, id(), {}, 'phone')).rejects.toThrow();
});
