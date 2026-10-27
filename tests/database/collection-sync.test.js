import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it } from 'vitest';
const db = new PGlite();
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const session = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const car = '11111111-2222-4333-8444-555555555555', kite = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const boat = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', board = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const hash = (seed = 'a') => Array.from({ length: 64 }, (_, index) => 'abcdef0123456789'[(seed.charCodeAt(0) + index) % 16]).join('');
async function as(role, user, sql) {
  await db.exec(`reset role; set role ${role}; select set_config('request.jwt.claim.sub','${user}',false); select set_config('request.jwt.claims','${JSON.stringify({ session_id: session })}',false);`);
  return db.query(sql);
}
const item = (id, extra = {}) => JSON.stringify({
  id, category: 'bicycle', name: 'Gravel bike', make: 'Trek', model: 'Checkpoint', attributes: { year: '2024', colour: 'Green' }, source: 'manual', archived: false, ...extra,
});
const upsert = (owner, payload, fingerprint = 'a', revision = 'null') =>
  `select public.backup_collection_item('${owner}','${payload}','${hash(fingerprint)}',${revision}) as revision`;
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

it('backs up a Collection item for its owner only', async () => {
  expect((await as('authenticated', a, upsert(a, item(car)))).rows[0].revision).toBe(1);
  const mine = await as('authenticated', a, `select category,name,make,model,attributes,archived,source from public.collection_items where id='${car}'`);
  expect(mine.rows[0]).toMatchObject({ category: 'bicycle', name: 'Gravel bike', make: 'Trek', model: 'Checkpoint', archived: false, source: 'manual' });
  expect(mine.rows[0].attributes).toEqual({ year: '2024', colour: 'Green' });
  expect((await as('authenticated', b, `select id from public.collection_items where id='${car}'`)).rows).toHaveLength(0);
  await expect(as('anon', '', 'select id from public.collection_items')).rejects.toThrow();
});

it('is idempotent for a repeated fingerprint and refuses a stale overwrite', async () => {
  const id = kite;
  expect((await as('authenticated', a, upsert(a, item(id)))).rows[0].revision).toBe(1);
  expect((await as('authenticated', a, upsert(a, item(id)))).rows[0].revision).toBe(1);
  expect((await as('authenticated', a, upsert(a, item(id, { name: 'Renamed bike' }), 'b', 1))).rows[0].revision).toBe(2);
  expect((await as('authenticated', a, `select name from public.collection_items where id='${id}'`)).rows[0].name).toBe('Renamed bike');
  await expect(as('authenticated', a, upsert(a, item(id, { name: 'Stale' }), 'c', 1))).rejects.toThrow('conflict');
  expect((await as('authenticated', a, upsert(a, item(id, { name: 'Fresh' }), 'd', 2))).rows[0].revision).toBe(3);
  await expect(as('authenticated', b, upsert(b, item(id, { name: 'Hijack' }), 'e', 3))).rejects.toThrow();
  expect((await as('authenticated', a, `select name from public.collection_items where id='${id}'`)).rows[0].name).toBe('Fresh');
});

it('accepts only attributes the native preference file also accepts', async () => {
  const id = boat;
  const invalid = [
    { attributes: { Year: '2024' } },
    { attributes: { size: 9 } },
    { attributes: { size: 'x'.repeat(121) } },
    { attributes: Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`k${index}`, 'v'])) },
    { attributes: ['size'] },
  ];
  for (const extra of invalid) await expect(as('authenticated', a, upsert(a, item(id, extra), 'f'))).rejects.toThrow();
  expect((await as('authenticated', a, upsert(a, item(id, { category: 'kite', attributes: { size: '9' } }), 'g'))).rows[0].revision).toBe(1);
});

it('binds a stored photo key to the owner and item, so another account’s object cannot be referenced', async () => {
  const id = board, owned = `${a}/collection/${id}.jpg`;
  await as('authenticated', a, upsert(a, item(id, { photo_object_key: owned, photo_sha256: hash('b') }), 'h'));
  expect((await as('authenticated', a, `select photo_object_key from public.collection_items where id='${id}'`)).rows[0].photo_object_key).toBe(owned);
  await expect(as('authenticated', a, upsert(a, item(id, { photo_object_key: `${b}/collection/${id}.jpg`, photo_sha256: hash('b') }), 'i', 1))).rejects.toThrow();
  await expect(as('authenticated', a, upsert(a, item(id, { photo_object_key: owned }), 'j', 1))).rejects.toThrow();
});

it('keeps a deleted item as a tombstone that a restore cannot resurrect', async () => {
  expect((await as('authenticated', a, `select public.delete_collection_item('${a}','${board}') as revision`)).rows[0].revision).toBe(2);
  expect((await as('authenticated', a, `select deleted_at is not null as deleted from public.collection_items where id='${board}'`)).rows[0].deleted).toBe(true);
  await expect(as('authenticated', a, upsert(a, item(board, { name: 'Back again' }), 'k'))).rejects.toThrow('removed');
  expect((await as('authenticated', a, `select deleted_at from public.collection_items where id='${board}'`)).rows[0].deleted_at).not.toBeNull();
  await expect(as('authenticated', b, `select public.delete_collection_item('${a}','${board}') as revision`)).rejects.toThrow();
});

it('stores whitelisted account settings per owner with a size and shape cap', async () => {
  const settings = JSON.stringify({ displayName: 'Jules', avatar: `data:image/jpeg;base64,${'A'.repeat(500)}`, distanceUnit: 'mi', bookmarks: ['trip-1'], archivedTrips: ['trip-2'], journeyGrouping: '{"version":1}' });
  expect((await as('authenticated', a, `select public.backup_account_settings('${a}','${settings}','${hash('a')}',null) as revision`)).rows[0].revision).toBe(1);
  expect((await as('authenticated', a, `select payload->>'displayName' as name from public.account_settings`)).rows[0].name).toBe('Jules');
  expect((await as('authenticated', b, 'select owner_id from public.account_settings')).rows).toHaveLength(0);
  expect((await as('authenticated', a, `select public.backup_account_settings('${a}','${settings}','${hash('a')}',null) as revision`)).rows[0].revision).toBe(1);
  await expect(as('authenticated', a, `select public.backup_account_settings('${a}','{"unknown":"x"}','${hash('b')}',1)`)).rejects.toThrow('Unsupported');
  await expect(as('authenticated', a, `select public.backup_account_settings('${a}','{"avatar":"javascript:alert(1)"}','${hash('c')}',1)`)).rejects.toThrow('profile image');
  await expect(as('authenticated', a, `select public.backup_account_settings('${a}','{"bookmarks":"not-an-array"}','${hash('d')}',1)`)).rejects.toThrow('favourite');
});

it('lets the owner store a profile photo that nobody else can read or change', async () => {
  const avatar = `data:image/jpeg;base64,${'A'.repeat(400)}`;
  await as('authenticated', a, `insert into public.profiles(id,display_name) values('${a}','Jules') on conflict(id) do nothing`);
  await as('authenticated', a, `update public.profiles set avatar='${avatar}' where id='${a}'`);
  expect((await as('authenticated', a, `select length(avatar) as size from public.profiles where id='${a}'`)).rows[0].size).toBe(avatar.length);
  expect((await as('authenticated', b, `select avatar from public.profiles where id='${a}'`)).rows).toHaveLength(0);
  await expect(as('authenticated', a, `update public.profiles set avatar='not-a-data-url' where id='${a}'`)).rejects.toThrow();
});

