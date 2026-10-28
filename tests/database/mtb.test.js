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
}, 30000);
afterAll(() => db.close());

it('creates a private trail draft only through the RPC and hides it from others', async () => {
  const id = (await as('authenticated', owner, `select public.create_mtb_trail(p_name := 'Hidden singletrack', p_geometry := '${geom(-33, 151)}'::jsonb, p_surface := 'loam', p_difficulty := 'black', p_access := 'unsanctioned', p_source := 'manual', p_direction := 'both', p_distance_meters := 500)`)).rows[0].create_mtb_trail;
  expect(id).toBeTruthy();
  const own = (await as('authenticated', owner, 'select * from public.mtb_trails')).rows;
  expect(own).toHaveLength(1);
  expect(own[0].status).toBe('draft');
  expect(own[0].visibility).toBe('private');
  expect(own[0].creator_id).toBe(owner);
  expect((await as('authenticated', other, 'select * from public.mtb_trails')).rows).toHaveLength(0);
  await expect(as('anon', '', 'select * from public.mtb_trails')).rejects.toThrow();
  await expect(as('authenticated', owner, `insert into public.mtb_trails(name,source,status) values('X','manual','draft')`)).rejects.toThrow();
  const g = (await as('authenticated', owner, 'select * from public.mtb_trail_geometry')).rows[0];
  expect(Number(g.min_lat)).toBeCloseTo(-33);
  expect(Number(g.max_lon)).toBeGreaterThan(151);
});

it('bbox query returns only approved public geometry', async () => {
  await as('service_role', '', `update public.mtb_trails set status='approved', visibility='public'`);
  expect(Number((await as('authenticated', other, 'select count(*) from public.mtb_trails_in_bbox(-33.5,-32.5,150.5,151.5)')).rows[0].count)).toBe(1);
  expect(Number((await as('authenticated', other, 'select count(*) from public.mtb_trails_in_bbox(-35,-34,150,151)')).rows[0].count)).toBe(0);
  await expect(as('anon', '', 'select * from public.mtb_trails_in_bbox(-33.5,-32.5,150.5,151.5)')).rejects.toThrow();
});

it('does not let ordinary users self-approve or grant moderation', async () => {
  expect((await as('authenticated', owner, 'select public.is_moderator()')).rows[0].is_moderator).toBe(false);
  await expect(as('authenticated', owner, `update public.mtb_trails set status='approved'`)).rejects.toThrow();
  await expect(as('authenticated', owner, `insert into public.moderators(user_id) values('${owner}')`)).rejects.toThrow();
  await as('service_role', '', `insert into public.moderators(user_id) values('${mod}')`);
  expect((await as('authenticated', mod, 'select public.is_moderator()')).rows[0].is_moderator).toBe(true);
  expect((await as('authenticated', mod, 'select * from public.mtb_trails')).rows).toHaveLength(1);
});

it('creates a segment draft associated with a trail and hides it from non-moderators', async () => {
  const trailId = (await as('authenticated', owner, 'select id from public.mtb_trails limit 1')).rows[0].id;
  await as('authenticated', owner, `select public.create_mtb_segment(p_name := 'Downhill blast', p_geometry := '${geom(-33, 151, 4)}'::jsonb, p_trail_id := '${trailId}', p_direction := 'downhill', p_difficulty := 'double_black', p_access := 'sanctioned', p_distance_meters := 330)`);
  expect(Number((await as('authenticated', owner, 'select count(*) from public.mtb_segments')).rows[0].count)).toBe(1);
  expect(Number((await as('authenticated', other, 'select count(*) from public.mtb_segments')).rows[0].count)).toBe(0);
  const seg = (await as('authenticated', owner, 'select * from public.mtb_segments')).rows[0];
  expect(seg.direction).toBe('downhill');
  expect(seg.difficulty).toBe('double_black');
});

it('rejects invalid geometry and OSM self-import', async () => {
  await expect(as('authenticated', owner, `select public.create_mtb_trail(p_name := 'Bad', p_geometry := '[[-33,151]]'::jsonb)`)).rejects.toThrow();
  await expect(as('authenticated', owner, `select public.create_mtb_trail(p_name := 'OSM', p_geometry := '${geom(-33, 151)}'::jsonb, p_source := 'osm')`)).rejects.toThrow();
});

it('records community reports and restricts them to the reporter (or a moderator)', async () => {
  const trailId = (await as('authenticated', owner, 'select id from public.mtb_trails limit 1')).rows[0].id;
  await as('authenticated', other, `insert into public.mtb_reports(trail_id,target_kind,kind,note,reporter_id) values('${trailId}','trail','closed','Closed for logging','${other}')`);
  expect(Number((await as('authenticated', other, 'select count(*) from public.mtb_reports')).rows[0].count)).toBe(1);
  expect(Number((await as('authenticated', owner, 'select count(*) from public.mtb_reports')).rows[0].count)).toBe(0);
  await expect(as('authenticated', other, `insert into public.mtb_reports(trail_id,target_kind,kind,reporter_id) values('${trailId}','trail','closed','${owner}')`)).rejects.toThrow();
});

