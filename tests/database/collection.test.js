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
const trip = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const car = '11111111-2222-4333-8444-555555555555', kite = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const row = (id, equipment) => JSON.stringify({ id, title: 'Geely drive', activity: 'Driving', recording_mode: 'manual', started_at: '2026-10-30T00:00:00Z', ended_at: '2026-10-30T00:30:00Z', duration_seconds: 1800, distance_meters: 24600, route_points: [], equipment });
it('stores an ordered equipment list with stable ids and labels', async () => {
  await as('authenticated', a, `insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,equipment) values('${trip}','Geely drive','Driving','manual',now(),now(),1800,24600,'[{"id":"${car}","name":"Geely"}]')`);
  expect((await as('authenticated', a, `select equipment from public.activities where id='${trip}'`)).rows[0].equipment).toEqual([{ id: car, name: 'Geely' }]);
  expect((await as('authenticated', b, `select equipment from public.activities where id='${trip}'`)).rows).toHaveLength(0);
  await expect(as('anon', '', 'select equipment from public.activities')).rejects.toThrow();
});

it('rejects malformed and oversized assignments', async () => {
  await expect(as('authenticated', a, `update public.activities set equipment='{"id":"${car}"}' where id='${trip}'`)).rejects.toThrow();
  await expect(as('authenticated', a, `update public.activities set equipment='[{"name":"No id"}]' where id='${trip}'`)).rejects.toThrow();
  await expect(as('authenticated', a, `update public.activities set equipment='[{"id":"${car}","name":"${'x'.repeat(101)}"}]' where id='${trip}'`)).rejects.toThrow();
  await expect(as('authenticated', a, `update public.activities set equipment='${JSON.stringify(Array.from({ length: 9 }, (_, index) => ({ id: `${car}-${index}`, name: 'Item' })))}' where id='${trip}'`)).rejects.toThrow();
  await as('authenticated', a, `update public.activities set equipment='[{"id":"${car}","name":"Geely"},{"id":"${kite}","name":"Duotone"}]' where id='${trip}'`);
  expect((await as('authenticated', a, `select jsonb_array_length(equipment) as count from public.activities where id='${trip}'`)).rows[0].count).toBe(2);
});
const backupTrip = 'ffffffff-1111-4222-8333-444444444444';
it('keeps equipment through the private backup contract and conflict checks', async () => {
  const equipment = [{ id: car, name: 'Geely' }, { id: kite, name: 'Duotone' }];
  const call = (payload, hash, revision = 'null') => `select public.backup_private_activity('${a}','${payload}','${hash.repeat(64)}',${revision}) as revision`;
  expect((await as('authenticated', a, call(row(backupTrip, equipment), 'a'))).rows[0].revision).toBe(1);
  expect((await as('authenticated', a, `select equipment from public.activities where id='${backupTrip}'`)).rows[0].equipment).toEqual(equipment);
  expect((await as('authenticated', a, call(row(backupTrip, equipment), 'a'))).rows[0].revision).toBe(1);
  expect((await as('authenticated', a, call(row(backupTrip, [equipment[0]]), 'b', 1))).rows[0].revision).toBe(2);
  expect((await as('authenticated', a, `select equipment from public.activities where id='${backupTrip}'`)).rows[0].equipment).toEqual([equipment[0]]);
  await expect(as('authenticated', b, call(row(backupTrip, equipment), 'c', 2))).rejects.toThrow('owner mismatch');
});
it('keeps the trimmed route window and chosen cover photo through backup and restore', async () => {
  const id = 'abcdefab-1111-4222-8333-444444444444';
  const payload = (view) => JSON.stringify({ id, title: 'Geely drive', activity: 'Driving', recording_mode: 'manual', started_at: '2026-10-30T00:00:00Z', ended_at: '2026-10-30T00:30:00Z', duration_seconds: 1800, distance_meters: 24600, route_points: [], view_metadata: view });
  const call = (view, hash) => `select public.backup_private_activity('${a}','${payload(view)}','${hash.repeat(64)}',null) as revision`;
  const view = { visibleRouteStart: 2, visibleRouteEnd: 40, startPlace: 'Home', endPlace: 'Beach', coverPhotoID: 'photo-1' };
  expect((await as('authenticated', a, call(view, 'a'))).rows[0].revision).toBe(1);
  expect((await as('authenticated', a, `select view_metadata from public.activities where id='${id}'`)).rows[0].view_metadata).toEqual(view);
  await expect(as('authenticated', a, call({ visibleRouteStart: 'two' }, 'b'))).rejects.toThrow();
  await expect(as('authenticated', a, call({ startPlace: 'x'.repeat(121) }, 'c'))).rejects.toThrow();
  await expect(as('authenticated', a, call({ somethingElse: 'x' }, 'd'))).rejects.toThrow();
});

it('never lets a client rewrite the vehicle recorded by a Tesla car', async () => {
  const vehicle = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await as('service_role', '', `insert into public.vehicles(id,owner_id,name,tesla_vehicle_id) values('${vehicle}','${a}','Tesla','123')`);
  await as('service_role', '', `insert into public.activities(id,owner_id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,route_points,vehicle_id) values('${kite}','${a}','Tesla drive','Driving','tesla',now(),now(),60,500,'[]','${vehicle}')`);
  await as('authenticated', a, `update public.activities set title='Renamed' where id='${kite}'`);
  await expect(as('authenticated', a, `update public.activities set equipment='[{"id":"${car}","name":"Geely"}]' where id='${kite}'`)).rejects.toThrow('server-managed');
});
