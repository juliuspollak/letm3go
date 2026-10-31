import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it } from 'vitest';
const db=new PGlite(),a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333';
const tokenA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',tokenC='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const attachment='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
async function as(role,user,sql){await db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${user}',false);`);return db.query(sql);}
const submit=(role,user,token,description='The map froze after I opened a journey.',category='bug')=>as(role,user,`select (public.submit_feedback('${token}','${category}','','${description}')).*`);
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,owner uuid);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;grant all on storage.buckets,storage.objects to service_role;create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
 insert into auth.users(id) values('${a}'),('${b}'),('${c}');`);
 for(const file of ['20261024000000_initial_profiles.sql','20261024010000_smart_activities.sql','20261024020000_auth_onboarding_households.sql','20261024030000_deployment_hardening.sql','20261109000000_feedback_support.sql'])await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
},30000);
afterAll(()=>db.close());

it('submits a validated private ticket and returns the same row on retry',async()=>{
 await expect(submit('authenticated',a,tokenA,'')).rejects.toThrow(/Describe your feedback/);
 await expect(submit('authenticated',a,tokenA,'Something broke','not-a-category')).rejects.toThrow(/category/);
 await expect(submit('anon','',tokenA)).rejects.toThrow();
 const first=(await submit('authenticated',a,tokenA)).rows[0];
 expect(first).toMatchObject({owner_id:a,status:'open',category:'bug',title:''});
 const retry=(await submit('authenticated',a,tokenA)).rows[0];
 expect(retry.id).toBe(first.id);
 expect((await as('authenticated',a,'select id from public.feedback')).rows).toHaveLength(1);
 await expect(submit('authenticated',b,tokenA)).rejects.toThrow(/receipt/);
});

it('keeps tickets, follow-ups and attachments invisible to other accounts',async()=>{
 const ticket=(await as('authenticated',a,'select id from public.feedback')).rows[0];
 await expect(as('authenticated',a,`insert into public.feedback(client_token,owner_id,category,description) values(gen_random_uuid(),'${a}','bug','Direct insert')`)).rejects.toThrow();
 expect((await as('authenticated',b,'select * from public.feedback')).rows).toHaveLength(0);
 expect((await as('authenticated',b,'select * from public.feedback_messages')).rows).toHaveLength(0);
 await as('authenticated',a,`select public.add_feedback_message('${ticket.id}','I can reproduce it on the Trips tab.')`);
 expect((await as('authenticated',a,'select * from public.feedback_messages')).rows).toHaveLength(1);
 expect((await as('authenticated',b,'select * from public.feedback_messages')).rows).toHaveLength(0);
 await expect(as('authenticated',b,`select public.add_feedback_message('${ticket.id}','Hijack')`)).rejects.toThrow(/not found/);
 await expect(as('authenticated',a,`insert into public.feedback_attachments(id,feedback_id,object_key,byte_size,width,height) values('${attachment}','${ticket.id}','${a}/${ticket.id}/${attachment}.jpg',10,10,10)`)).resolves.toBeTruthy();
 expect((await as('authenticated',a,'select * from public.feedback_attachments')).rows).toHaveLength(1);
 // A retried upload upserts the same row, which needs an owner-scoped update path.
 await expect(as('authenticated',a,`update public.feedback_attachments set byte_size=11 where id='${attachment}'`)).resolves.toBeTruthy();
 expect((await as('authenticated',a,'select byte_size from public.feedback_attachments')).rows[0].byte_size).toBe(11);
 expect((await as('authenticated',b,'select * from public.feedback_attachments')).rows).toHaveLength(0);
 await expect(as('authenticated',b,`insert into public.feedback_attachments(id,feedback_id,object_key,byte_size,width,height) values(gen_random_uuid(),'${ticket.id}','${b}/${ticket.id}/${attachment}.jpg',10,10,10)`)).rejects.toThrow();
 await expect(as('authenticated',a,`insert into public.feedback_attachments(id,feedback_id,object_key,byte_size,width,height) values(gen_random_uuid(),'${ticket.id}','wrong/path.jpg',10,10,10)`)).rejects.toThrow();
});

it('caps photo evidence at five per ticket',async()=>{
 const ticket=(await as('authenticated',a,'select id from public.feedback')).rows[0];
 for(const suffix of ['1','2','3','4']){
  const id=`aaaaaaaa-000${suffix}-400${suffix}-800${suffix}-00000000000${suffix}`;
  await expect(as('authenticated',a,`insert into public.feedback_attachments(id,feedback_id,object_key,byte_size,width,height) values('${id}','${ticket.id}','${a}/${ticket.id}/${id}.jpg',10,10,10)`)).resolves.toBeTruthy();
 }
 await expect(as('authenticated',a,`insert into public.feedback_attachments(id,feedback_id,object_key,byte_size,width,height) values('aaaaaaaa-0005-4005-8005-000000000005','${ticket.id}','${a}/${ticket.id}/aaaaaaaa-0005-4005-8005-000000000005.jpg',10,10,10)`)).rejects.toThrow(/up to 5 photos/);
});

it('tracks staff replies without exposing staff-only writes',async()=>{
 const ticket=(await as('authenticated',a,'select id from public.feedback')).rows[0];
 expect((await as('authenticated',a,'select public.mark_my_feedback_seen() as changed')).rows[0].changed).toBe(0);
 await as('service_role','',`insert into public.feedback_messages(feedback_id,is_staff,body) values('${ticket.id}',true,'Thanks — a fix is on the way.')`);
 expect((await as('authenticated',a,'select public.mark_my_feedback_seen() as changed')).rows[0].changed).toBe(1);
 expect((await as('authenticated',a,'select user_seen_at from public.feedback')).rows[0].user_seen_at).toBeTruthy();
 await as('service_role','',`update public.feedback set status='closed' where id='${ticket.id}'`);
 await expect(as('authenticated',a,`select public.add_feedback_message('${ticket.id}','One more thing')`)).rejects.toThrow(/closed/);
 await expect(as('authenticated',a,`insert into public.feedback_messages(feedback_id,author_id,body) values('${ticket.id}','${a}','Direct')`)).rejects.toThrow();
});

it('stores a private bucket scoped to each owner folder',async()=>{
 const bucket=(await as('service_role','','select id,public,file_size_limit from storage.buckets')).rows[0];
 expect(bucket).toEqual({id:'feedback-attachments',public:false,file_size_limit:10485760});
 await as('service_role','',`insert into storage.objects(bucket_id,name,owner) values('feedback-attachments','${a}/ticket/photo.jpg','${a}'),('feedback-attachments','${b}/ticket/photo.jpg','${b}')`);
 const rows=(await as('authenticated',a,'select name from storage.objects')).rows;
 expect(rows).toEqual([{name:`${a}/ticket/photo.jpg`}]);
});

it('denies writes while deletion is pending and cascades owned feedback on deletion',async()=>{
 await as('service_role','',`insert into public.account_deletion_requests(owner_id) values('${c}')`);
 await expect(submit('authenticated',c,tokenC)).rejects.toThrow(/unavailable/);
 await db.exec(`reset role;delete from public.account_deletion_requests where owner_id='${c}'`);
 const ticket=(await submit('authenticated',c,tokenC,'Please add a dark map style.','idea')).rows[0];
 const photo='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 await as('authenticated',c,`insert into public.feedback_attachments(id,feedback_id,object_key,byte_size,width,height) values('${photo}','${ticket.id}','${c}/${ticket.id}/${photo}.jpg',10,10,10)`);
 await db.exec(`reset role;delete from auth.users where id='${c}'`);
 expect((await as('service_role','',`select * from public.feedback where owner_id='${c}'`)).rows).toHaveLength(0);
 expect((await as('service_role','',`select * from public.feedback_attachments where owner_id='${c}'`)).rows).toHaveLength(0);
});
