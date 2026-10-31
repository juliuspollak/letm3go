import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES } from '../../src/lib/feedback.js';
// 20261110000000_feedback_storage_hardening.sql over the whole migration chain, as a
// database that already ran 20261109000000 will see it.
const db = new PGlite();
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const ticketA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ticketB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', closed = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const photo = n => `dddddddd-dddd-4ddd-8ddd-00000000000${n}.jpg`;
const as = async (user, sql) => {
  await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${user}',false);`);
  try { return await db.query(sql); } finally { await db.exec('reset role;'); }
};
const put = (user, name) => as(user, `insert into storage.objects(bucket_id,name) values('feedback-attachments','${name}')`);
beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}',raw_app_meta_data jsonb not null default '{}');
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
    insert into auth.users(id) values('${a}'),('${b}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
    grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
    grant usage on schema storage to authenticated,service_role;grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const name of (await readdir('supabase/migrations')).filter(n => n.endsWith('.sql')).sort()) await db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
  await db.exec(`insert into public.feedback(id,client_token,owner_id,category,description,status) values
    ('${ticketA}',gen_random_uuid(),'${a}','bug','x','open'),('${ticketB}',gen_random_uuid(),'${b}','bug','y','open'),('${closed}',gen_random_uuid(),'${a}','bug','z','closed')`);
}, 90000);
afterAll(() => db.close());

it('stores a photo only under the account\'s own open ticket, with a real key', async () => {
  await put(a, `${a}/${ticketA}/${photo(1)}`);
  await expect(put(a, `${a}/loose.jpg`)).rejects.toThrow(/row-level security/);
  await expect(put(a, `${a}/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/${photo(2)}`)).rejects.toThrow(/row-level security/);
  await expect(put(a, `${a}/${ticketB}/${photo(2)}`)).rejects.toThrow(/row-level security/);
  await expect(put(a, `${b}/${ticketB}/${photo(2)}`)).rejects.toThrow(/row-level security/);
  await expect(put(a, `${a}/${closed}/${photo(2)}`)).rejects.toThrow(/row-level security/);
  await expect(put(a, `${a}/${ticketA}/not-a-uuid.png`)).rejects.toThrow(/row-level security/);
});

it('caps stored objects per ticket even when none ever registers', async () => {
  for (const n of [2, 3, 4, 5]) await put(a, `${a}/${ticketA}/${photo(n)}`);
  await expect(put(a, `${a}/${ticketA}/${photo(6)}`)).rejects.toThrow(/row-level security/);
});

it('keeps a registered photo from losing its file, and lets an unregistered one be cleaned up', async () => {
  const id = 'dddddddd-dddd-4ddd-8ddd-000000000001', key = `${a}/${ticketA}/${photo(1)}`;
  await as(a, `insert into public.feedback_attachments(id,feedback_id,owner_id,object_key,byte_size,width,height) values('${id}','${ticketA}','${a}','${key}',10,10,10)`);
  expect((await as(a, `delete from storage.objects where name='${key}' returning id`)).rows).toEqual([]);
  expect((await as(a, `delete from storage.objects where name='${a}/${ticketA}/${photo(2)}' returning id`)).rows).toHaveLength(1);
  await expect(as(a, `delete from public.feedback_attachments where id='${id}'`)).rejects.toThrow(/permission denied/);
});

it('hides photos from another account and from one pending deletion', async () => {
  expect((await as(b, `select name from storage.objects`)).rows).toEqual([]);
  expect((await as(a, `select name from storage.objects`)).rows.length).toBeGreaterThan(0);
  await db.exec(`insert into public.account_deletion_requests(owner_id) values('${a}')`);
  expect((await as(a, `select name from storage.objects`)).rows).toEqual([]);
  await expect(put(a, `${a}/${ticketA}/${photo(7)}`)).rejects.toThrow(/row-level security/);
  await db.exec(`delete from public.account_deletion_requests where owner_id='${a}'`);
});

it('can be applied again', async () => {
  await db.exec(await readFile('supabase/migrations/20261110000000_feedback_storage_hardening.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20261111000000_feedback_upload_limits.sql', 'utf8'));
  expect((await db.query(`select count(*)::int as n from pg_policies where schemaname='storage' and policyname like 'feedback attachments%'`)).rows[0].n).toBe(4);
});

it('agrees on one size limit across the database and the bucket', async () => {
  const attachment = id => `insert into public.feedback_attachments(id,feedback_id,owner_id,object_key,byte_size,width,height)
    values('${id}','${ticketB}','${b}','${b}/${ticketB}/${id}.jpg',${size},10,10)`;
  let size = MAX_IMAGE_BYTES;
  await as(b, attachment('e0000000-0000-4000-8000-000000000001'));
  size = MAX_IMAGE_BYTES + 1;
  await expect(as(b, attachment('e0000000-0000-4000-8000-000000000002'))).rejects.toThrow(/byte_size_check/);
  const { rows: [bucket] } = await db.query(`select file_size_limit from storage.buckets where id='feedback-attachments'`);
  expect(Number(bucket.file_size_limit)).toBe(MAX_IMAGE_BYTES);
});

it('serialises both photo counts per ticket, reading what the last writer committed', async () => {
  const { rows } = await db.query(`select proname,provolatile from pg_proc where proname in ('can_write_feedback_object','enforce_feedback_attachment_limit') order by proname`);
  expect(rows).toEqual([{ proname: 'can_write_feedback_object', provolatile: 'v' }, { proname: 'enforce_feedback_attachment_limit', provolatile: 'v' }]);
  const held = async work => {
    await db.exec(`begin;set local role authenticated;select set_config('request.jwt.claim.sub','${b}',true);`);
    try {
      await db.query(work);
      return (await db.query(`select count(*)::int as n from pg_locks where locktype='advisory' and granted`)).rows[0].n;
    } finally { await db.exec('rollback'); }
  };
  expect(await held(`insert into public.feedback_attachments(id,feedback_id,owner_id,object_key,byte_size,width,height)
    values('e0000000-0000-4000-8000-000000000003','${ticketB}','${b}','${b}/${ticketB}/e0000000-0000-4000-8000-000000000003.jpg',10,10,10)`)).toBe(1);
  expect(await held(`insert into storage.objects(bucket_id,name) values('feedback-attachments','${b}/${ticketB}/e0000000-0000-4000-8000-000000000004.jpg')`)).toBe(1);
});
