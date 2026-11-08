import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {beforeAll,afterAll,expect,it} from 'vitest';
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
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
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

it('a submitted segment notifies moderators and admins, who can also review it',async()=>{
 const geometry=JSON.stringify(Array.from({length:10},(_,i)=>[-34+i*0.0001,151]));
 await as('authenticated',ann,`select public.create_mtb_segment(p_client_id=>'e0000000-0000-4000-8000-000000000001',p_name=>'Warilla descent',p_geometry=>'${geometry}'::jsonb,p_distance_meters=>100)`);
 for(const reviewer of [admin,moderator])expect(await inbox(reviewer)).toEqual([expect.objectContaining({kind:'segment_submitted',title:'New segment to review',body:'Warilla descent · Ann',route:{screen:'review'}})]);
 expect((await as('authenticated',admin,'select count(*)::int n from public.mtb_moderation_queue()')).rows[0].n).toBe(1);
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
