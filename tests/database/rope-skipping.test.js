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
