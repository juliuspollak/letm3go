import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const mod = '33333333-3333-4333-8333-333333333333';
const geom = (lat0, lon0, n = 5) => JSON.stringify(Array.from({ length: n }, (_, i) => [lat0 + i * 0.001, lon0 + i * 0.001]));
async function as(role, user, sql) { await db.exec(`reset role; set role ${role}; select set_config('request.jwt.claim.sub','${user || ''}',false);`); return db.query(sql); }
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${owner}'),('${other}'),('${mod}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;`);
  await db.exec(await readFile('supabase/migrations/20261024010000_smart_activities.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20261102000000_mtb_trails_segments.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20261103000000_mtb_moderation.sql', 'utf8'));
}, 30000);
afterAll(() => db.close());

it('walks the full draft → submitted → approved lifecycle and publishes publicly', async () => {
  const segId = (await as('authenticated', owner, `select public.create_mtb_segment(p_name := 'Ridge DH', p_geometry := '${geom(-33, 151)}'::jsonb, p_direction := 'downhill', p_access := 'sanctioned')`)).rows[0].create_mtb_segment;
  expect(Number((await as('authenticated', other, 'select count(*) from public.mtb_segments_in_bbox(-33.5,-32.5,150.5,151.5)')).rows[0].count)).toBe(0);
  await expect(as('authenticated', other, `select public.submit_mtb('segment','${segId}')`)).rejects.toThrow();
  await as('authenticated', owner, `select public.submit_mtb('segment','${segId}')`);
  expect((await as('authenticated', owner, 'select status from public.mtb_segments')).rows[0].status).toBe('submitted');
  await expect(as('authenticated', owner, `select public.moderate_mtb('segment','${segId}','approved')`)).rejects.toThrow();
  await as('service_role', '', `insert into public.moderators(user_id) values('${mod}')`);
  await as('authenticated', mod, `select public.moderate_mtb('segment','${segId}','approved','Looks good')`);
  expect(Number((await as('authenticated', other, 'select count(*) from public.mtb_segments_in_bbox(-33.5,-32.5,150.5,151.5)')).rows[0].count)).toBe(1);
  expect((await as('authenticated', owner, 'select moderation_note from public.mtb_segments')).rows[0].moderation_note).toBe('Looks good');
});

it('keeps restricted trails private even after approval', async () => {
  const trailId = (await as('authenticated', owner, `select public.create_mtb_trail(p_name := 'Secret', p_geometry := '${geom(-33, 151)}'::jsonb, p_access := 'sensitive')`)).rows[0].create_mtb_trail;
  await as('authenticated', owner, `select public.submit_mtb('trail','${trailId}')`);
  await as('authenticated', mod, `select public.moderate_mtb('trail','${trailId}','approved')`);
  const row = (await as('authenticated', owner, `select status, visibility from public.mtb_trails where id='${trailId}'`)).rows[0];
  expect(row.status).toBe('approved');
  expect(row.visibility).toBe('private');
  expect(Number((await as('authenticated', other, 'select count(*) from public.mtb_trails_in_bbox(-33.5,-32.5,150.5,151.5)')).rows[0].count)).toBe(0);
});

it('requests changes, lists own submissions and edits a draft in place', async () => {
  const segId = (await as('authenticated', owner, `select public.create_mtb_segment(p_name := 'Rough', p_geometry := '${geom(-33, 151)}'::jsonb)`)).rows[0].create_mtb_segment;
  await as('authenticated', owner, `select public.mtb_set_geometry('segment','${segId}','${geom(-33, 151, 6)}'::jsonb, 500)`);
  expect(Number((await as('authenticated', owner, 'select version from public.mtb_segments')).rows[0].version)).toBe(1);
  await as('authenticated', owner, `select public.submit_mtb('segment','${segId}')`);
  await as('authenticated', mod, `select public.moderate_mtb('segment','${segId}','changes_requested','Too short')`);
  expect((await as('authenticated', owner, `select status from public.mtb_segments where id='${segId}'`)).rows[0].status).toBe('changes_requested');
  expect(Number((await as('authenticated', owner, 'select count(*) from public.mtb_my_submissions()')).rows[0].count)).toBe(3);
});

it('versions geometry on a moderator reroute and finds nearby duplicates', async () => {
  const segId = (await as('authenticated', owner, `select public.create_mtb_segment(p_name := 'V1', p_geometry := '${geom(-33, 151)}'::jsonb)`)).rows[0].create_mtb_segment;
  await as('authenticated', owner, `select public.submit_mtb('segment','${segId}')`);
  await as('authenticated', mod, `select public.moderate_mtb('segment','${segId}','approved')`);
  expect(Number((await as('authenticated', mod, `select version from public.mtb_segments where id='${segId}'`)).rows[0].version)).toBe(1);
  await as('authenticated', mod, `select public.mtb_set_geometry('segment','${segId}','${geom(-33, 151, 7)}'::jsonb, 600, 'Rerouted')`);
  expect(Number((await as('authenticated', mod, `select version from public.mtb_segments where id='${segId}'`)).rows[0].version)).toBe(2);
  expect(Number((await as('authenticated', mod, `select count(*) from public.mtb_segment_geometry where segment_id='${segId}'`)).rows[0].count)).toBe(2);
  const dup = (await as('authenticated', owner, `select public.create_mtb_segment(p_name := 'Dup', p_geometry := '${geom(-33.0005, 151.0005, 3)}'::jsonb)`)).rows[0].create_mtb_segment;
  await as('authenticated', owner, `select public.submit_mtb('segment','${dup}')`);
  await as('authenticated', mod, `select public.moderate_mtb('segment','${dup}','approved')`);
  expect(Number((await as('authenticated', mod, `select count(*) from public.mtb_segments_near('${segId}', 1000)`)).rows[0].count)).toBe(2);
});

