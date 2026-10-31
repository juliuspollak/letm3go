import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it } from 'vitest';
// 20261113000000_household_live_hardening.sql against the whole migration chain.
// It proves newer-wins, true captured age, explicit activity clearing, and that
// an old five-argument client still works.
const db = new PGlite();
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const house = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const as = async (role, user, sql) => {
  await db.exec(`reset role; set role ${role}; select set_config('request.jwt.claim.sub','${user}',false);`);
  try { return await db.query(sql); } finally { await db.exec('reset role;'); }
};
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
    insert into auth.users values('${a}','{}'),('${b}','{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    create schema realtime;
    create table realtime.messages(id bigserial primary key,topic text,extension text default 'broadcast',event text,payload jsonb);
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to authenticated; grant select on realtime.messages to authenticated;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
    create function realtime.send(payload jsonb,event text,topic text,private boolean default true) returns void language sql as $$insert into realtime.messages(topic,event,payload) values(topic,event,payload)$$;`);
  for (const name of (await readdir('supabase/migrations')).filter(n => n.endsWith('.sql')).sort()) await db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
  const houses = (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='households' and is_nullable='NO' and column_default is null`)).rows.map(c => c.column_name);
  const values = { name: `'Home'`, owner_id: `'${a}'`, created_by: `'${a}'` };
  await db.exec(`insert into public.households(id${houses.map(c => ',' + c).join('')}) values('${house}'${houses.map(c => ',' + values[c]).join('')})`);
  await db.exec(`insert into public.household_memberships(user_id,household_id,role) values('${a}','${house}','owner'),('${b}','${house}','member')`);
}, 90000);
afterAll(() => db.close());

const call = (args) => as('authenticated', a, `select public.set_my_live_location(${args})`);
const row = async () => (await db.query(`select enabled,latitude,longitude,activity,location_at from public.household_live_locations where user_id='${a}'`)).rows[0];

it('keeps the true captured age and newer-wins on the in-app publisher', async () => {
  await call(`true,-33.90,151.20,5,40,now()-interval '5 minutes','driving'`);
  let seen = await row();
  expect(seen.activity).toBe('driving');
  const age=(Date.now()-Date.parse(seen.location_at))/1000;
  expect(age).toBeGreaterThan(240);
  expect(age).toBeLessThan(320);
  // A newer position arrives.
  await call(`true,-33.91,151.21,5,40,now(),'walking'`);
  const newer = await row();
  expect(newer.latitude).toBeCloseTo(-33.91, 5);
  // A delayed request from the older position must not move it backwards.
  await call(`true,-33.80,151.10,5,40,now()-interval '10 minutes','driving'`);
  const stillNewer = await row();
  expect(stillNewer.latitude).toBeCloseTo(-33.91, 5);
  expect(stillNewer.activity).toBe('walking');
});

it('clears activity without inventing a new position and clears everything on disable', async () => {
  await call(`true,null,null,null,null,null,null`);
  let seen = await row();
  expect(seen.activity).toBeNull();
  expect(seen.latitude).toBeCloseTo(-33.91, 5);
  await call(`false`);
  seen = await row();
  expect(seen).toMatchObject({ enabled: false, latitude: null, longitude: null, activity: null });
});

it('keeps the old five-argument call working', async () => {
  await call(`true,-33.70,151.20,5,30`);
  expect((await row()).latitude).toBeCloseTo(-33.70, 5);
});

it('applies newer-wins to the device credential too', async () => {
  const token = (await as('authenticated', a, `select * from public.issue_my_live_location_token()`)).rows[0].publish_token;
  const publish = (lat, captured) => as('anon', '', `select public.publish_live_location('${token}',${lat},151.2,5,40,${captured},'driving') as ok`);
  expect((await publish(-33.60, 'now()')).rows[0].ok).toBe(true);
  expect((await publish(-33.50, `now()-interval '10 minutes'`)).rows[0].ok).toBe(true);
  expect((await row()).latitude).toBeCloseTo(-33.60, 5);
});

it('can be applied twice and leaves one function of each name', async () => {
  await db.exec(await readFile('supabase/migrations/20261113000000_household_live_hardening.sql', 'utf8'));
  expect((await db.query(`select count(*)::int as n from pg_proc where proname='set_my_live_location'`)).rows[0].n).toBe(1);
  expect((await db.query(`select count(*)::int as n from pg_proc where proname='publish_live_location'`)).rows[0].n).toBe(1);
});
