import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it } from 'vitest';
// 20261108000000_household_realtime_signals.sql against the whole migration chain,
// with a stand-in for Supabase's realtime schema that records what is broadcast.
const db = new PGlite();
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222', outsider = '33333333-3333-4333-8333-333333333333';
const house = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token = 'a'.repeat(64);
const as = async (role, user, sql) => {
  await db.exec(`reset role; set role ${role}; select set_config('request.jwt.claim.sub','${user}',false);`);
  try { return await db.query(sql); } finally { await db.exec('reset role;'); }
};
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
    insert into auth.users values('${a}','{}'),('${b}','{}'),('${outsider}','{}');
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
}, 90000);
afterAll(() => db.close());

it('broadcasts that a location changed, with no position, only to the household channel', async () => {
  const houses = (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='households' and is_nullable='NO' and column_default is null`)).rows.map(c => c.column_name);
  const houseValues = { name: `'Home'`, owner_id: `'${a}'`, created_by: `'${a}'` };
  await db.exec(`insert into public.households(id${houses.map(c => ',' + c).join('')}) values('${house}'${houses.map(c => ',' + houseValues[c]).join('')})`);
  await db.exec(`insert into public.household_memberships(user_id,household_id,role) values('${a}','${house}','owner'),('${b}','${house}','member')`);
  await db.exec(`insert into public.household_live_locations(user_id,enabled,publish_token_hash,publish_token_expires_at) values('${a}',true,sha256(convert_to('${token}','UTF8')),now()+interval '1 day')`);
  await db.exec('delete from realtime.messages');
  const published = await as('anon', a, `select public.publish_live_location('${token}',-33.8,151.2,5,40) as ok`);
  expect(published.rows[0].ok).toBe(true);
  const messages = (await db.query('select topic,event,payload from realtime.messages')).rows;
  expect(messages).toHaveLength(1);
  expect(messages[0].topic).toBe(`household:${house}`);
  expect(messages[0].event).toBe('location');
  expect(Object.keys(messages[0].payload)).toEqual(['user_id']);
  expect(JSON.stringify(messages[0])).not.toMatch(/33\.8|151\.2/);
});

it('lets the other phone read the published position right after the signal', async () => {
  const row = (await as('authenticated', b, 'select latitude,location_at,server_now from public.my_household_location_status()')).rows[0];
  expect(row.latitude).toBe(-33.8);
  expect(row.location_at).not.toBeNull();
});

it('still accepts the arguments earlier app builds send', async () => {
  expect((await as('anon', a, `select public.publish_live_location('${token}',-33.81,151.2)  as ok`)).rows[0].ok).toBe(true);
});

it('bounds the capture time and never lets a late fix replace a newer one', async () => {
  await as('anon', a, `select public.publish_live_location('${token}',-33.82,151.2,5,40,now()+interval '1 hour')`);
  const future = (await db.query(`select location_at<=now() as ok from public.household_live_locations where user_id='${a}'`)).rows[0];
  expect(future.ok).toBe(true);
  await db.exec(`update public.household_live_locations set location_at=now(),latitude=-33.9 where user_id='${a}'`);
  await as('anon', a, `select public.publish_live_location('${token}',-1,1,5,40,now()-interval '25 seconds')`);
  expect((await db.query(`select latitude from public.household_live_locations where user_id='${a}'`)).rows[0].latitude).toBe(-33.9);
});

it('gives each member their own channel and nothing to anyone else', async () => {
  expect((await as('authenticated', b, 'select topic from public.my_household_signal_topics()')).rows).toEqual([{ topic: `household:${house}` }]);
  expect((await as('authenticated', outsider, 'select topic from public.my_household_signal_topics()')).rows).toEqual([]);
  await db.exec(`insert into realtime.messages(topic,event,payload) values('household:${house}','location','{}')`);
  await db.exec(`select set_config('realtime.topic','household:${house}',false)`);
  expect((await as('authenticated', b, 'select count(*)::int as n from realtime.messages')).rows[0].n).toBeGreaterThan(0);
  expect((await as('authenticated', outsider, 'select count(*)::int as n from realtime.messages')).rows[0].n).toBe(0);
});

it('does not fail a publish when Realtime is unavailable', async () => {
  await db.exec('drop function realtime.send(jsonb,text,text,boolean)');
  expect((await as('anon', a, `select public.publish_live_location('${token}',-33.83,151.2) as ok`)).rows[0].ok).toBe(true);
});
