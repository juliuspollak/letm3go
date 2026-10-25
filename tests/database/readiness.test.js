import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it } from 'vitest';
const db = new PGlite();
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const session = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', installation = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const trip = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
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
it('denies service-only APNs lookup even with hosted default EXECUTE grants', async () => {
  await as('authenticated', a, `select public.register_push_device('${installation}','${'a'.repeat(64)}','sandbox','${a}')`);
  await expect(as('authenticated', b, `select * from public.eligible_push_devices('${a}')`)).rejects.toThrow();
  await expect(as('anon', '', `select * from public.eligible_push_devices('${a}')`)).rejects.toThrow();
  expect((await as('service_role', '', `select * from public.eligible_push_devices('${a}')`)).rows).toHaveLength(1);
});
it('protects all private tables and privileged functions with hosted default grants', async () => {
  for (const table of ['profiles','saved_places','vehicles','connected_services','activities','activity_stops','media_assets','activity_tombstones','media_cleanup','trusted_contacts','activity_grants','account_preferences','households','household_memberships','household_invitations','push_devices','provider_credentials','provider_oauth_states','account_deletion_requests','operation_budgets']) {
    await expect(as('anon', '', `select * from public.${table}`)).rejects.toThrow();
  }
  await expect(as('authenticated', a, 'select * from public.provider_credentials')).rejects.toThrow();
  await expect(as('authenticated', a, "select public.consume_operation('forged',999)")).rejects.toThrow();
});
it('keeps profile ownership and server timestamps protected', async () => {
  await as('authenticated', a, `insert into public.profiles(id,display_name) values('${a}','A')`);
  expect((await as('authenticated', b, 'select * from public.profiles')).rows).toHaveLength(0);
  await expect(as('authenticated', b, `insert into public.profiles(id,created_at) values('${b}',now())`)).rejects.toThrow();
  await expect(as('authenticated', b, `insert into public.profiles(id,display_name) values('${a}','Spoof')`)).rejects.toThrow();
});
it('stores private stops only against the owning activity and saved place', async () => {
  await as('authenticated', a, `insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters) values('${trip}','Walk','Walking','automatic',now(),now(),1,1)`);
  await as('authenticated', a, `insert into public.saved_places(id,name,kind,latitude,longitude,radius) values('${trip}','Home','home',-33,151,150)`);
  await as('authenticated', a, `insert into public.activity_stops(activity_id,saved_place_id,latitude,longitude,started_at,ended_at) values('${trip}','${trip}',-33,151,now(),now())`);
  expect((await as('authenticated', b, 'select * from public.activity_stops')).rows).toHaveLength(0);
  await expect(as('authenticated', b, `insert into public.activity_stops(activity_id,latitude,longitude,started_at,ended_at) values('${trip}',0,0,now(),now())`)).rejects.toThrow();
  await expect(as('service_role', '', `insert into public.activity_stops(owner_id,activity_id,latitude,longitude,started_at,ended_at) values('${b}','${trip}',0,0,now(),now())`)).rejects.toThrow();
  await as('authenticated', a, `delete from public.saved_places where id='${trip}'`);
  expect((await as('authenticated', a, 'select saved_place_id from public.activity_stops')).rows[0].saved_place_id).toBeNull();
});
it('rejects service-side media owner/key mismatches', async () => {
  const media = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await expect(as('service_role', '', `insert into public.media_assets(id,owner_id,activity_id,object_key,byte_size,mime_type) values('${media}','${b}','${trip}','${b}/${trip}/${media}.jpg',1,'image/jpeg')`)).rejects.toThrow();
  await expect(as('service_role', '', `insert into public.media_assets(id,owner_id,activity_id,object_key,byte_size,mime_type) values('${media}','${a}','${trip}','wrong-owner/key.jpg',1,'image/jpeg')`)).rejects.toThrow();
  await as('service_role', '', `insert into public.media_assets(id,owner_id,activity_id,object_key,byte_size,mime_type) values('${media}','${a}','${trip}','${a}/${trip}/${media}.jpg',1,'image/jpeg')`);
});
it('scopes Tesla vehicle uniqueness per user while permitting manual vehicles', async () => {
  for (const owner of [a, b]) await as('authenticated', owner, `insert into public.vehicles(id,name,tesla_vehicle_id) values(gen_random_uuid(),'Tesla','same-provider-vehicle')`);
  await expect(as('authenticated', a, "insert into public.vehicles(id,name,tesla_vehicle_id) values(gen_random_uuid(),'Duplicate','same-provider-vehicle')")).rejects.toThrow();
  await as('authenticated', a, "insert into public.vehicles(id,name) values(gen_random_uuid(),'Bike'),(gen_random_uuid(),'Car')");
});
it('backs up atomically with owner checks, idempotent receipts, conflict rejection and tombstones',async()=>{
 const id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 const row={id,title:'Backup',activity:'Walking',recording_mode:'automatic',started_at:'2026-10-25T00:00:00Z',ended_at:'2026-10-25T00:01:00Z',duration_seconds:60,distance_meters:100,route_points:[]};
 const call=(owner,hash,revision='null')=>`select public.backup_private_activity('${owner}','${JSON.stringify(row)}','${hash.repeat(64)}',${revision}) as revision`;
 await expect(as('anon','',call(a,'a'))).rejects.toThrow();
 expect((await as('authenticated',a,call(a,'a'))).rows[0].revision).toBe(1);
 expect((await as('authenticated',a,call(a,'a'))).rows[0].revision).toBe(1);
 await expect(as('authenticated',b,call(a,'b',1))).rejects.toThrow('owner mismatch');
 await expect(as('authenticated',a,call(a,'b'))).rejects.toThrow('conflict');
 expect((await as('authenticated',a,call(a,'b',1))).rows[0].revision).toBe(2);
 await expect(as('authenticated',a,call(a,'c',1))).rejects.toThrow('conflict');
 await as('authenticated',a,`delete from public.activities where id='${id}'`);
 await expect(as('authenticated',a,call(a,'b'))).rejects.toThrow('deleted');
});
it('reserves Tesla rotation leases for service role and prevents stale or cross-owner writes',async()=>{
 for(const role of ['anon','authenticated'])await expect(as(role,a,`select public.acquire_tesla_token_lease('${a}')`)).rejects.toThrow();
 const lease=(await as('service_role','',`select public.acquire_tesla_token_lease('${a}') as lease`)).rows[0].lease;
 expect(lease).toBeTruthy();
 expect((await as('service_role','',`select public.acquire_tesla_token_lease('${a}') as lease`)).rows[0].lease).toBeNull();
 await expect(as('service_role','',`select public.save_tesla_credentials('${b}','${lease}','encrypted')`)).rejects.toThrow('lease expired');
 await as('service_role','',`select public.save_tesla_credentials('${a}','${lease}','encrypted')`);
 await expect(as('authenticated',b,'select * from public.tesla_token_leases')).rejects.toThrow();
 await as('service_role','',`select public.release_tesla_token_lease('${a}','${lease}')`);
 await expect(as('service_role','',`select public.save_tesla_credentials('${a}','${lease}','stale')`)).rejects.toThrow('lease expired');
});
it('freezes direct client and service writes during deletion then cascades without restoring tombstones', async () => {
  await as('authenticated', a, `insert into public.saved_places(id,name,kind,latitude,longitude,radius) values('${trip}','Home','home',-33,151,150)`);
  await as('authenticated', a, `update public.activity_stops set saved_place_id='${trip}' where activity_id='${trip}'`);
  const revision = (await as('authenticated', a, `select revision from public.activities where id='${trip}'`)).rows[0].revision;
  await as('service_role', '', `select public.commit_shared_journey('${trip}','${a}',${revision},'public','{}')`);
  await as('authenticated', a, "select * from public.create_household('Family')");
  const invite = (await as('authenticated', a, 'select public.invite_to_household() as token')).rows[0].token;
  await as('service_role', '', `insert into public.account_deletion_requests(owner_id) values('${a}')`);
  expect((await as('anon', '', 'select snapshot from public.shared_journeys')).rows).toHaveLength(0);
  expect((await as('authenticated', a, 'select * from public.activities')).rows).toHaveLength(0);
  expect((await as('authenticated', a, 'select * from public.my_household()')).rows).toHaveLength(0);
  await expect(as('authenticated', a, "select * from public.create_household('Another')")).rejects.toThrow('Account unavailable');
  await expect(as('authenticated', a, 'select public.invite_to_household()')).rejects.toThrow('Account unavailable');
  await expect(as('authenticated', b, `select * from public.accept_household_invitation('${invite}')`)).rejects.toThrow('Invitation invalid or expired');
  await expect(as('authenticated', a, "insert into public.vehicles(id,name) values(gen_random_uuid(),'Late')")).rejects.toThrow();
  await expect(as('service_role', '', `insert into public.provider_credentials(owner_id,provider,ciphertext) values('${a}','apple','test')`)).rejects.toThrow();
  await expect(as('service_role', '', `select public.commit_shared_journey('${trip}','${a}',${revision},'public','{}')`)).rejects.toThrow();
  await db.exec(`reset role; delete from auth.users where id='${a}'`);
  expect((await as('service_role', '', `select * from public.activity_stops where owner_id='${a}'`)).rows).toHaveLength(0);
  expect((await as('service_role', '', `select * from public.activity_tombstones where owner_id='${a}'`)).rows).toHaveLength(0);
  expect((await as('service_role', '', 'select * from public.media_cleanup')).rows).toHaveLength(1);
});
