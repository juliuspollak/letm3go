import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it } from 'vitest';
// 20261116000000_feedback_admin_and_reports.sql over the whole migration chain:
// ticket numbers, app admins, reports with tickets and file removal on close.
const db = new PGlite();
const user = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', admin = '99999999-9999-4999-8999-999999999999';
const report = n => `eeeeeeee-eeee-4eee-8eee-00000000000${n}`;
const photo = n => `dddddddd-dddd-4ddd-8ddd-00000000000${n}`;
const as = async (who, sql) => {
  await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${who}',false);`);
  try { return await db.query(sql); } finally { await db.exec('reset role;'); }
};
// `select * from f()` calls it once; `select (f()).*` would call it once per column.
const submit = (who, description) => as(who, `select * from public.submit_feedback(gen_random_uuid(),'bug','','${description}')`).then(r => r.rows[0]);
const put = (who, name) => as(who, `insert into storage.objects(bucket_id,name) values('feedback-attachments','${name}')`);
const addReport = (who, ticket, id, ext = 'txt', kind = 'recording') => as(who, `insert into public.feedback_reports(id,feedback_id,kind,object_key,mime_type,byte_size)
  values('${id}','${ticket.id}','${kind}','${who}/${ticket.id}/${id}.${ext}','${ext === 'txt' ? 'text/plain' : 'application/gzip'}',100)`);
beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}',raw_app_meta_data jsonb not null default '{}');
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
    insert into auth.users(id,email) values('${user}','julia@example.com'),('${other}','other@example.com'),('${admin}','owner@example.com');
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
  await db.exec(`insert into public.profiles(id,display_name) values('${user}','Julia'),('${admin}','Julius') on conflict(id) do update set display_name=excluded.display_name;`);
  // The documented way to make someone an admin.
  await db.exec(`insert into public.app_admins(user_id) select id from auth.users where email='owner@example.com' on conflict do nothing;`);
}, 90000);
afterAll(() => db.close());

it('numbers every ticket for quoting', async () => {
  const first = await submit(user, 'GPS stopped on a drive');
  const second = await submit(other, 'Another issue');
  expect(Number(second.number)).toBeGreaterThan(Number(first.number));
});

it('only SQL can make someone an admin; users cannot see or change the admin list', async () => {
  await expect(as(user, `insert into public.app_admins(user_id) values('${user}')`)).rejects.toThrow();
  await expect(as(user, 'select * from public.app_admins')).rejects.toThrow();
  expect((await as(user, 'select public.is_app_admin() as yes')).rows[0].yes).toBe(false);
  expect((await as(admin, 'select public.is_app_admin() as yes')).rows[0].yes).toBe(true);
});

it('an admin reads every ticket with who sent it; a user still sees only their own', async () => {
  expect((await as(user, 'select * from public.feedback')).rows.every(t => t.owner_id === user)).toBe(true);
  const all = (await as(admin, 'select * from public.feedback')).rows;
  expect(new Set(all.map(t => t.owner_id))).toEqual(new Set([user, other]));
  const authors = (await as(admin, `select * from public.admin_feedback_authors(array['${user}']::uuid[])`)).rows;
  expect(authors).toEqual([{ id: user, display_name: 'Julia' }]);
  await expect(as(user, `select * from public.admin_feedback_authors(array['${admin}']::uuid[])`)).rejects.toThrow(/Only an admin/);
});

it('reports attach to the sender\'s own open ticket only, at most three, and admins can read them', async () => {
  const ticket = (await as(user, 'select * from public.feedback')).rows[0];
  await put(user, `${user}/${ticket.id}/${report(1)}.txt`);
  await addReport(user, ticket, report(1));
  await put(user, `${user}/${ticket.id}/${report(2)}.json.gz`);
  await addReport(user, ticket, report(2), 'json.gz', 'diagnosticLog');
  await put(user, `${user}/${ticket.id}/${report(3)}.txt`);
  await addReport(user, ticket, report(3));
  await expect(put(user, `${user}/${ticket.id}/${report(4)}.txt`)).rejects.toThrow(/row-level security/);
  await expect(addReport(user, ticket, report(4))).rejects.toThrow(/up to 3 reports/);
  // Photos keep their own five, independent of reports.
  await put(user, `${user}/${ticket.id}/${photo(1)}.jpg`);
  await as(user, `insert into public.feedback_attachments(id,feedback_id,object_key,byte_size,width,height) values('${photo(1)}','${ticket.id}','${user}/${ticket.id}/${photo(1)}.jpg',10,10,10)`);
  await expect(put(user, `${user}/${ticket.id}/${report(5)}.exe`)).rejects.toThrow(/row-level security/);
  await expect(as(other, `insert into public.feedback_reports(id,feedback_id,kind,object_key,mime_type,byte_size) values('${report(6)}','${ticket.id}','recording','${other}/${ticket.id}/${report(6)}.txt','text/plain',10)`)).rejects.toThrow();
  expect((await as(other, 'select * from public.feedback_reports')).rows).toHaveLength(0);
  expect((await as(admin, 'select * from public.feedback_reports')).rows).toHaveLength(3);
  expect((await as(admin, `select name from storage.objects where name like '${user}/%'`)).rows).toHaveLength(4);
  expect((await as(other, `select name from storage.objects where name like '${user}/%'`)).rows).toHaveLength(0);
});

it('an admin replies as staff, and the reply moves an open ticket into review', async () => {
  const ticket = (await as(user, 'select * from public.feedback')).rows[0];
  await as(admin, `select public.admin_reply_feedback('${ticket.id}','Thanks, looking at the log now.')`);
  const messages = (await as(user, `select * from public.feedback_messages where feedback_id='${ticket.id}'`)).rows;
  expect(messages.at(-1)).toMatchObject({ is_staff: true, author_id: admin });
  expect((await as(user, `select status from public.feedback where id='${ticket.id}'`)).rows[0].status).toBe('in_review');
  await expect(as(user, `select public.admin_reply_feedback('${ticket.id}','I am staff')`)).rejects.toThrow(/Only an admin/);
  await expect(as(user, `select public.admin_set_feedback_status('${ticket.id}','closed')`)).rejects.toThrow(/Only an admin/);
});

it('closing removes the ticket\'s photos and reports, and only then lets the admin delete their files', async () => {
  const ticket = (await as(user, 'select * from public.feedback')).rows[0];
  const key = `${user}/${ticket.id}/${report(1)}.txt`;
  // While referenced and open, an admin cannot delete a file.
  expect((await as(admin, `delete from storage.objects where name='${key}' returning name`)).rows).toHaveLength(0);
  const keys = (await as(admin, `select public.admin_set_feedback_status('${ticket.id}','closed') as keys`)).rows[0].keys;
  expect(keys.sort()).toEqual([key, `${user}/${ticket.id}/${report(2)}.json.gz`, `${user}/${ticket.id}/${report(3)}.txt`, `${user}/${ticket.id}/${photo(1)}.jpg`].sort());
  expect((await as(admin, `select * from public.feedback_reports where feedback_id='${ticket.id}'`)).rows).toHaveLength(0);
  expect((await as(admin, `select * from public.feedback_attachments where feedback_id='${ticket.id}'`)).rows).toHaveLength(0);
  const closed = (await as(user, `select * from public.feedback where id='${ticket.id}'`)).rows[0];
  expect(closed.status).toBe('closed');expect(closed.files_removed_at).not.toBeNull();
  // The conversation stays.
  expect((await as(user, `select * from public.feedback_messages where feedback_id='${ticket.id}'`)).rows.length).toBeGreaterThan(0);
  // Other users still cannot delete them; the admin now can.
  expect((await as(other, `delete from storage.objects where name='${key}' returning name`)).rows).toHaveLength(0);
  expect((await as(admin, `delete from storage.objects where name like '${user}/${ticket.id}/%' returning name`)).rows).toHaveLength(4);
  // Nothing more can be attached to a closed ticket.
  await expect(put(user, `${user}/${ticket.id}/${report(7)}.txt`)).rejects.toThrow(/row-level security/);
});

it('an admin can hide a ticket from its owner and bring it back', async () => {
  const ticket = (await as(other, 'select * from public.feedback')).rows[0];
  await as(admin, `select public.admin_set_feedback_deleted('${ticket.id}',true)`);
  expect((await as(other, 'select * from public.feedback')).rows).toHaveLength(0);
  expect((await as(admin, `select deleted_at from public.feedback where id='${ticket.id}'`)).rows[0].deleted_at).not.toBeNull();
  await as(admin, `select public.admin_set_feedback_deleted('${ticket.id}',false)`);
  expect((await as(other, 'select * from public.feedback')).rows).toHaveLength(1);
  await expect(as(other, `select public.admin_set_feedback_deleted('${ticket.id}',true)`)).rejects.toThrow(/Only an admin/);
});

it('the migration can be applied again without error', async () => {
  await db.exec(await readFile('supabase/migrations/20261116000000_feedback_admin_and_reports.sql', 'utf8'));
  expect((await as(admin, 'select public.is_app_admin() as yes')).rows[0].yes).toBe(true);
});
