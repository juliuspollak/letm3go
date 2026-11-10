import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {beforeAll,afterAll,describe,expect,it} from 'vitest';
// Notifications and pokes (20261123000000): who is told about what, the unread
// inbox behind the profile badge, and the push outbox drained by the Edge Function.
const db=new PGlite();
const admin='11111111-1111-4111-8111-111111111111',ann='22222222-2222-4222-8222-222222222222',bob='33333333-3333-4333-8333-333333333333',stranger='44444444-4444-4444-8444-444444444444',moderator='55555555-5555-4555-8555-555555555555';
const annSession='a0000000-0000-4000-8000-00000000000a',annDevice='d0000000-0000-4000-8000-00000000000d';
async function as(role,user,sql,claims='{}'){
 await db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claims','${claims}',false);`);
 return db.query(sql);
}
const inbox=async user=>(await as('authenticated',user,'select kind,title,body,route,actor_id from public.notifications where read_at is null order by id')).rows;
const clear=async user=>as('authenticated',user,'select public.mark_notifications_read()');
async function befriend(a,b){
 const code=(await as('authenticated',a,'select public.create_friend_invite() as code')).rows[0].code;
 await as('authenticated',b,`select public.accept_friend_invite('${code}')`);
}
const feedback=async(user,title)=>(await as('authenticated',user,`select id from public.submit_feedback(gen_random_uuid(),'bug','${title}','It broke')`)).rows[0].id;
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 insert into auth.users(id) values('${admin}'),('${ann}'),('${bob}'),('${stranger}'),('${moderator}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 grant usage on schema auth to anon,authenticated,service_role;
 grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
 -- Stand-ins for Supabase Vault and pg_net: calls are recorded, not sent.
 create schema vault;create table vault.decrypted_secrets(name text primary key,decrypted_secret text);
 create schema net;create table net.calls(id serial primary key,url text,body jsonb,headers jsonb);create table net.fail(on_ boolean);
 create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$
  begin if exists(select 1 from net.fail where on_) then raise exception 'network down'; end if;
  insert into net.calls(url,body,headers) values(url,body,headers); return currval('net.calls_id_seq'); end $$;`);
 for(const filename of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())
  await db.exec(await readFile('supabase/migrations/'+filename,'utf8'));
 await db.exec(`reset role;insert into public.profiles(id,display_name) values('${ann}','Ann'),('${bob}','Bob'),('${admin}','Julius') on conflict (id) do update set display_name=excluded.display_name;
  insert into public.app_admins(user_id) values('${admin}');insert into public.moderators(user_id) values('${moderator}');
  insert into auth.sessions(id,user_id) values('${annSession}','${ann}');`);
 await befriend(ann,bob);
},90000);
afterAll(()=>db.close());

it('new feedback notifies every admin, never the sender, and a sender reply notifies admins again',async()=>{
 const id=await feedback(ann,'Map crash');
 expect(await inbox(admin)).toEqual([expect.objectContaining({kind:'feedback_new',title:'New feedback',body:'Ann: Map crash',route:{screen:'feedback',id},actor_id:ann})]);
 expect(await inbox(ann)).toEqual([]);
 await clear(admin);
 await as('authenticated',ann,`select public.add_feedback_message('${id}','Still crashing')`);
 expect(await inbox(admin)).toEqual([expect.objectContaining({kind:'feedback_new',title:'New feedback reply',body:'Ann: Still crashing'})]);
 await clear(admin);
});

it('a staff reply and resolving the ticket notify the sender',async()=>{
 const id=await feedback(ann,'Slow list');await clear(admin);
 await as('authenticated',admin,`select public.admin_reply_feedback('${id}','Fixed in the next build')`);
 await as('authenticated',admin,`select public.admin_set_feedback_status('${id}','resolved')`);
 const rows=await inbox(ann);
 expect(rows.map(row=>[row.kind,row.title])).toEqual([['feedback_reply','Reply to your feedback'],['feedback_status','Your feedback was resolved']]);
 expect(rows[0].body).toBe('Fixed in the next build');
 expect(await inbox(admin)).toEqual([]);
 await clear(ann);
});

it('a published segment needs no review, while a submitted trail still notifies moderators and admins',async()=>{
 const geometry=JSON.stringify(Array.from({length:10},(_,i)=>[-34+i*0.0001,151]));
 await as('authenticated',ann,`select public.create_mtb_segment(p_client_id=>'e0000000-0000-4000-8000-000000000001',p_name=>'Warilla descent',p_geometry=>'${geometry}'::jsonb,p_distance_meters=>100)`);
 for(const reviewer of [admin,moderator])expect(await inbox(reviewer)).toEqual([]);
 expect((await as('authenticated',admin,'select count(*)::int n from public.mtb_moderation_queue()')).rows[0].n).toBe(0);
 const trail=(await as('authenticated',ann,`select public.create_mtb_trail('Warilla loop','${geometry}'::jsonb) as id`)).rows[0].id;
 await as('authenticated',ann,`select public.submit_mtb('trail','${trail}')`);
 for(const reviewer of [admin,moderator])expect(await inbox(reviewer)).toEqual([expect.objectContaining({kind:'segment_submitted',title:'New trail to review',body:'Warilla loop · Ann',route:{screen:'review'}})]);
 await clear(admin);await clear(moderator);
});

it('pokes reach friends only, are rate limited, and never reach strangers',async()=>{
 const message=(await as('authenticated',ann,`select public.send_poke('${bob}') as m`)).rows[0].m;
 expect(message).toMatch(/^Ann /);
 expect(await inbox(bob)).toEqual([expect.objectContaining({kind:'poke',title:'Poke',body:message,route:{screen:'home',from:ann}})]);
 await expect(as('authenticated',ann,`select public.send_poke('${bob}')`)).rejects.toThrow(/in a minute/);
 await expect(as('authenticated',ann,`select public.send_poke('${stranger}')`)).rejects.toThrow(/friends and household/);
 await expect(as('authenticated',ann,`select public.send_poke('${ann}')`)).rejects.toThrow(/Choose someone/);
 await expect(as('anon','',`select public.send_poke('${bob}')`)).rejects.toThrow();
});

it('the inbox is private, and marking read clears only the chosen kinds',async()=>{
 expect((await as('authenticated',ann,`select count(*)::int n from public.notifications where recipient_id<>'${ann}'`)).rows[0].n).toBe(0);
 await expect(as('authenticated',bob,`insert into public.notifications(event_key,recipient_id,kind,title,body) values('x:1','${bob}','poke','Fake','Fake')`)).rejects.toThrow();
 await expect(as('authenticated',bob,`select public.notify('x:2','${bob}',null,'poke','Fake','Fake')`)).rejects.toThrow();
 await feedback(ann,'Another');
 expect((await as('authenticated',admin,`select public.mark_notifications_read(array['poke']) as n`)).rows[0].n).toBe(0);
 expect((await inbox(admin)).length).toBe(1);
 await clear(admin);expect(await inbox(admin)).toEqual([]);
});

it('push fans out to a signed-in device once, carries the unread badge, and forgets dead tokens',async()=>{
 await expect(as('authenticated',ann,'select * from public.claim_push_deliveries(10)')).rejects.toThrow();
 await as('authenticated',ann,`select public.register_push_device('${annDevice}','${'a'.repeat(64)}','production','${ann}')`,`{"session_id":"${annSession}"}`);
 // What Ann already read in the app is never pushed afterwards.
 expect((await as('service_role','','select * from public.claim_push_deliveries(10)')).rows).toEqual([]);
 await as('authenticated',bob,`select public.send_poke('${ann}')`);
 const claimed=(await as('service_role','','select * from public.claim_push_deliveries(10)')).rows;
 expect(claimed).toEqual([expect.objectContaining({kind:'poke',apns_token:'a'.repeat(64),environment:'production',badge:1})]);
 expect((await as('service_role','','select * from public.claim_push_deliveries(10)')).rows).toEqual([]);
 expect((await as('service_role','',`select public.finish_push_delivery(${claimed[0].delivery_id},'${claimed[0].claim_token}','sent',200,'Success') as s`)).rows[0].s).toBe('sent');
 // A second finish with the same claim is stale and changes nothing.
 expect((await as('service_role','',`select public.finish_push_delivery(${claimed[0].delivery_id},'${claimed[0].claim_token}','failed',400,'x') as s`)).rows[0].s).toBeNull();
 await db.exec(`reset role;delete from public.pokes`);
 await as('authenticated',bob,`select public.send_poke('${ann}')`);
 const next=(await as('service_role','','select * from public.claim_push_deliveries(10)')).rows[0];
 expect(next.badge).toBe(2);
 await as('service_role','',`select public.finish_push_delivery(${next.delivery_id},'${next.claim_token}','invalid_token',410,'Unregistered')`);
 expect((await as('service_role','','select count(*)::int n from public.push_devices')).rows[0].n).toBe(0);
});

it('a device whose session ended receives nothing',async()=>{
 await as('authenticated',ann,`select public.register_push_device('${annDevice}','${'b'.repeat(64)}','production','${ann}')`,`{"session_id":"${annSession}"}`);
 await db.exec(`reset role;delete from auth.sessions where id='${annSession}';delete from public.pokes`);
 await as('authenticated',bob,`select public.send_poke('${ann}')`);
 expect((await as('service_role','','select * from public.claim_push_deliveries(10)')).rows).toEqual([]);
});

describe('push delivery lifecycle',()=>{
 const bobSession='b0000000-0000-4000-8000-00000000000b',bobSession2='b0000000-0000-4000-8000-00000000000c';
 const phone='d1000000-0000-4000-8000-000000000001',ipad='d1000000-0000-4000-8000-000000000002';
 const register=(user,session,installation,token)=>as('authenticated',user,`select public.register_push_device('${installation}','${token}','production','${user}')`,`{"session_id":"${session}"}`);
 const claim=async()=>(await as('service_role','','select * from public.claim_push_deliveries(50)')).rows;
 const finish=(row,status)=>as('service_role','',`select public.finish_push_delivery(${row.delivery_id},'${row.claim_token}','${status}',0,'test') as s`);
 const poke=async(from,to)=>{await db.exec('reset role;delete from public.pokes');await as('authenticated',from,`select public.send_poke('${to}')`);};
 beforeAll(async()=>{
  await db.exec(`reset role;delete from public.push_devices;insert into auth.sessions(id,user_id) values('${bobSession}','${bob}'),('${bobSession2}','${bob}'),('${annSession}','${ann}') on conflict do nothing`);
  await as('authenticated',bob,'select public.mark_notifications_read()');
 });
 it('fans one notification out to every signed-in device of the recipient, and only theirs',async()=>{
  await register(bob,bobSession,phone,'1'.repeat(64));await register(bob,bobSession2,ipad,'2'.repeat(64));
  await poke(ann,bob);
  const rows=await claim();
  expect(rows.map(row=>row.apns_token).sort()).toEqual(['1'.repeat(64),'2'.repeat(64)]);
  expect(new Set(rows.map(row=>row.notification_id)).size).toBe(1);
  for(const row of rows)await finish(row,'sent');
  await as('authenticated',bob,'select public.mark_notifications_read()');
 });
 it('switching account on one phone moves the device: the previous user gets nothing there',async()=>{
  await register(ann,annSession,phone,'1'.repeat(64));
  expect((await as('service_role','',`select owner_id from public.push_devices where installation_id='${phone}'`)).rows[0].owner_id).toBe(ann);
  await poke(ann,bob);
  expect((await claim()).map(row=>row.apns_token)).toEqual(['2'.repeat(64)]);
  await db.exec(`reset role;update public.notification_deliveries set status='sent',claim_token=null,lease_expires_at=null where status='sending'`);
  await as('authenticated',bob,'select public.mark_notifications_read()');
 });
 it('a temporary failure is retried with backoff and gives up after five attempts',async()=>{
  await poke(ann,bob);
  let [row]=await claim();
  for(let attempt=1;attempt<=5;attempt++){
   expect((await finish(row,'retry')).rows[0].s).toBe(attempt<5?'retry':'failed');
   if(attempt<5){
    expect(await claim()).toEqual([]); // backoff: not claimable straight away
    await db.exec(`reset role;update public.notification_deliveries set next_attempt_at=now() where id=${row.delivery_id}`);
    [row]=await claim();expect(row.delivery_id).toBeDefined();
   }
  }
  await db.exec(`reset role;update public.notification_deliveries set next_attempt_at=now() where id=${row.delivery_id}`);
  expect(await claim()).toEqual([]);
  await as('authenticated',bob,'select public.mark_notifications_read()');
 });
 it('a notification older than a day is never pushed',async()=>{
  await poke(ann,bob);
  await db.exec(`reset role;update public.notifications set created_at=now()-interval '25 hours' where push_processed_at is null`);
  expect(await claim()).toEqual([]);
 });
 it('a stuck send whose lease expired is reclaimed once, not duplicated',async()=>{
  await poke(ann,bob);
  const [row]=await claim();
  expect(await claim()).toEqual([]);
  await db.exec(`reset role;update public.notification_deliveries set lease_expires_at=now()-interval '1 second' where id=${row.delivery_id}`);
  const again=await claim();
  expect(again.map(r=>r.delivery_id)).toEqual([row.delivery_id]);
  expect(again[0].claim_token).not.toBe(row.claim_token);
  expect((await finish(row,'sent')).rows[0].s).toBeNull(); // the stale claim cannot complete it
 });
});

describe('server-side dispatch (20261124000000): pushes go out while every app is closed',()=>{
 const sql=async q=>{await db.exec('reset role');return db.query(q);};
 const calls=async()=>(await sql('select url,headers from net.calls order by id')).rows;
 const reset=()=>db.exec('reset role;delete from net.calls;delete from net.fail;delete from public.pokes');
 it('does nothing until the worker URL and secret are in Vault',async()=>{
  await reset();
  await as('authenticated',ann,`select public.send_poke('${bob}')`);
  expect(await calls()).toEqual([]);
 });
 it('one poke calls the worker once, with the secret, straight from the database',async()=>{
  await db.exec(`reset role;insert into vault.decrypted_secrets values('push_worker_url','https://example.supabase.co/functions/v1/send-push-notifications'),('push_worker_secret','s3cret') on conflict do nothing`);
  await reset();
  await as('authenticated',ann,`select public.send_poke('${bob}')`);
  expect(await calls()).toEqual([{url:'https://example.supabase.co/functions/v1/send-push-notifications',headers:{'Content-Type':'application/json',Authorization:'Bearer s3cret'}}]);
 });
 it('feedback to several admins is one statement and one worker call',async()=>{
  await db.exec(`reset role;insert into public.app_admins(user_id) values('${moderator}') on conflict do nothing`);
  await reset();
  await feedback(ann,'Two admins');
  expect((await sql(`select count(*)::int n from public.notifications where kind='feedback_new' and push_processed_at is null`)).rows[0].n).toBeGreaterThanOrEqual(2);
  expect(await calls()).toHaveLength(1);
 });
 it('a failed dispatch never undoes the poke; the recovery check picks it up',async()=>{
  await reset();await db.exec('insert into net.fail values(true)');
  await as('authenticated',ann,`select public.send_poke('${bob}')`);
  expect((await sql(`select count(*)::int n from public.pokes`)).rows[0].n).toBe(1);
  expect(await calls()).toEqual([]);
  await db.exec('delete from net.fail');
  expect((await sql('select public.dispatch_due_pushes() as due')).rows[0].due).toBe(true);
  expect(await calls()).toHaveLength(1);
 });
 it('the recovery check makes no request when nothing is due',async()=>{
  await db.exec(`reset role;update public.notifications set push_processed_at=now() where push_processed_at is null;update public.notification_deliveries set status='sent',claim_token=null,lease_expires_at=null where status<>'sent'`);
  await reset();
  expect((await sql('select public.dispatch_due_pushes() as due')).rows[0].due).toBe(false);
  expect(await calls()).toEqual([]);
 });
 it('only the database can dispatch',async()=>{
  for(const role of ['anon','authenticated'])await expect(as(role,ann,'select public.dispatch_push()')).rejects.toThrow();
  await expect(as('authenticated',ann,'select public.dispatch_due_pushes()')).rejects.toThrow();
 });
 it('fan-out marks only the batch it actually fanned out; the rest stay queued and due',async()=>{
  await db.exec(`reset role;update public.notifications set push_processed_at=now() where push_processed_at is null;
   insert into public.notifications(event_key,recipient_id,kind,title,body) select 'bulk:'||g,'${bob}','poke','Poke','Hi' from generate_series(1,501) g`);
  await db.exec('reset role');await db.query('select * from public.claim_push_deliveries(1)');
  expect((await sql(`select count(*)::int n from public.notifications where push_processed_at is null`)).rows[0].n).toBe(1);
  expect((await sql('select public.dispatch_due_pushes() as due')).rows[0].due).toBe(true);
  await db.exec(`reset role;update public.notifications set read_at=now() where event_key like 'bulk:%'`);
 });
 it('app roles cannot read the pg_net queue (where the worker secret waits) or call it; dispatch still works',async()=>{
  for(const role of ['anon','authenticated']){
   await expect(as(role,ann,'select * from net.calls')).rejects.toThrow();
   await expect(as(role,ann,`select net.http_post('https://example.com','{}'::jsonb,'{}'::jsonb,1)`)).rejects.toThrow();
  }
  // ...while the database's own dispatch still works.
  await reset();
  await as('authenticated',ann,`select public.send_poke('${bob}')`);
  expect(await calls()).toHaveLength(1);
 });
});

