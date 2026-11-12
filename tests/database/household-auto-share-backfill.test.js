import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it } from 'vitest';
// 20261206000000_household_auto_share_backfill.sql: people who were already in a household get the default (on).
const db = new PGlite();
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222', outsider = '33333333-3333-4333-8333-333333333333';
const house = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BACKFILL = '20261206000000';
const c = '44444444-4444-4444-8444-444444444444';
const as = async (role, user, sql) => {
  await db.exec(`reset role; set role ${role}; select set_config('request.jwt.claim.sub','${user}',false);`);
  try { return await db.query(sql); } finally { await db.exec('reset role;'); }
};
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
    insert into auth.users values('${a}','{}'),('${b}','{}'),('${outsider}','{}'),('${c}','{}');
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
  for (const name of (await readdir('supabase/migrations')).filter(n => n.endsWith('.sql') && !n.startsWith(BACKFILL)).sort()) await db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
}, 90000);
afterAll(() => db.close());

it('gives people already in a household the default (on, from now), and leaves anyone who chose alone', async () => {
  const houses = (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='households' and is_nullable='NO' and column_default is null`)).rows.map(x => x.column_name);
  const houseValues = { name: `'Home'`, owner_id: `'${a}'`, created_by: `'${a}'` };
  await db.exec(`insert into public.households(id${houses.map(x => ',' + x).join('')}) values('${house}'${houses.map(x => ',' + houseValues[x]).join('')})`);
  await db.exec(`insert into public.household_memberships(user_id,household_id,role) values('${a}','${house}','owner'),('${b}','${house}','member'),('${c}','${house}','member')`);
  // They joined before the default existed: no row. One of them had already chosen "off".
  await db.exec(`delete from public.activity_auto_share where user_id in ('${a}','${b}')`);
  await db.exec(`update public.activity_auto_share set enabled=false where user_id='${c}'`);
  expect((await db.query(`select count(*)::int as n from public.activity_auto_share where user_id in ('${a}','${b}')`)).rows[0].n).toBe(0);
  const before = Date.now();
  await db.exec(await readFile(`supabase/migrations/${BACKFILL}_household_auto_share_backfill.sql`, 'utf8'));
  const rows = (await db.query(`select user_id,enabled,since from public.activity_auto_share order by user_id`)).rows;
  const by = Object.fromEntries(rows.map(r => [r.user_id, r]));
  expect(by[a].enabled).toBe(true);
  expect(by[b].enabled).toBe(true);
  // From now: nothing recorded earlier is swept in.
  expect(new Date(by[a].since).getTime()).toBeGreaterThanOrEqual(before - 2000);
  // A choice already made is respected, and an outsider with no household gets nothing.
  expect(by[c].enabled).toBe(false);
  expect(by[outsider]).toBeUndefined();
  const seen = (await as('authenticated', b, 'select my_auto_share() as v')).rows[0].v;
  expect(seen.enabled).toBe(true);
});
it('can be applied twice without changing anyone', async () => {
  const first = (await db.query(`select user_id,enabled,since from public.activity_auto_share order by user_id`)).rows;
  await db.exec(await readFile(`supabase/migrations/${BACKFILL}_household_auto_share_backfill.sql`, 'utf8'));
  expect((await db.query(`select user_id,enabled,since from public.activity_auto_share order by user_id`)).rows).toEqual(first);
});
