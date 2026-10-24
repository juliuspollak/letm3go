import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',trip='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function as(role,user,sql){await db.exec(`reset role; set role ${role}; select set_config('request.jwt.claim.sub','${user||''}',false);`);return db.query(sql);}
beforeAll(async()=>{
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${owner}'),('${other}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile('supabase/migrations/20261024010000_smart_activities.sql','utf8'));
},30000);
afterAll(()=>db.close());
it('keeps Home/Work coordinates owner-only and prevents ownership spoofing',async()=>{
 await as('authenticated',owner,`insert into public.saved_places values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','${owner}','Home','home',-33,151,150,now())`);
 expect((await as('authenticated',other,'select * from public.saved_places')).rows).toHaveLength(0);
 await expect(as('anon','', 'select * from public.saved_places')).rejects.toThrow();
 await expect(as('authenticated',other,`insert into public.saved_places(id,owner_id,name,kind,latitude,longitude,radius) values(gen_random_uuid(),'${owner}','Fake','work',0,0,150)`)).rejects.toThrow();
});
it('denies private routes to other users and anonymous clients',async()=>{
 await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters) values('${trip}','Private walk','Walking','manual',now(),now(),10,20)`);
 expect((await as('authenticated',other,'select * from public.activities')).rows).toHaveLength(0);
 await expect(as('anon','', 'select route_points from public.activities')).rejects.toThrow();
 await expect(as('authenticated',owner,`update public.activities set owner_id='${other}' where id='${trip}'`)).rejects.toThrow();
});
it('publishes only a detached projection, blocks direct publication, and revokes on editing',async()=>{
 await expect(as('authenticated',owner,`select public.commit_shared_journey('${trip}','${owner}',1,'public','{}')`)).rejects.toThrow();
 await as('service_role','',`select public.commit_shared_journey('${trip}','${owner}',1,'public','{"title":"Shared walk","points":[]}')`);
 expect((await as('anon','', 'select snapshot from public.shared_journeys')).rows[0].snapshot).toEqual({title:'Shared walk',points:[]});
 await expect(as('anon','', 'select owner_id,activity_id from public.shared_journeys')).rejects.toThrow();
 await as('authenticated',owner,`update public.activities set title='Edited' where id='${trip}'`);
 expect((await as('anon','', 'select snapshot from public.shared_journeys')).rows).toHaveLength(0);
 await expect(as('service_role','',`select public.commit_shared_journey('${trip}','${owner}',1,'public','{}')`)).rejects.toThrow();
});
it('tombstones deletions and prevents delayed insert from resurrecting a trip',async()=>{
 await as('authenticated',owner,`delete from public.activities where id='${trip}'`);
 expect((await as('authenticated',owner,'select * from public.activity_tombstones')).rows).toHaveLength(1);
 await expect(as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters) values('${trip}','Stale','Walking','manual',now(),now(),10,20)`)).rejects.toThrow();
 expect((await as('authenticated',other,'select * from public.activity_tombstones')).rows).toHaveLength(0);
});
it('does not allow users to forge contacts or audience grants',async()=>{
 await expect(as('authenticated',owner,`insert into public.trusted_contacts values('${owner}','${other}','friends')`)).rejects.toThrow();
});
it('allows only confirmed selected recipients and denies raw GPS even to those recipients',async()=>{
 const id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters) values('${id}','Shared hike','Hiking','manual',now(),now(),10,20)`);
 await as('service_role','',`insert into public.trusted_contacts values('${owner}','${other}','friends')`);
 await as('authenticated',owner,`insert into public.activity_grants values('${id}','${other}','friends')`);
 await as('service_role','',`select public.commit_shared_journey('${id}','${owner}',1,'friends','{"title":"Shared hike","points":[]}')`);
 expect((await as('authenticated',other,'select snapshot from public.shared_journeys')).rows).toHaveLength(1);
 expect((await as('authenticated',other,'select route_points from public.activities')).rows).toHaveLength(0);
 expect((await as('anon','','select snapshot from public.shared_journeys')).rows).toHaveLength(0);
 await as('service_role','',`delete from public.trusted_contacts where owner_id='${owner}'`);
 expect((await as('authenticated',other,'select snapshot from public.shared_journeys')).rows).toHaveLength(0);
});
it('invalidates existing masking when a saved Home/Work area changes',async()=>{
 const id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 await as('service_role','',`select public.commit_shared_journey('${id}','${owner}',1,'public','{"title":"Shared hike","points":[]}')`);
 await as('authenticated',owner,`update public.saved_places set radius=200 where kind='home'`);
 expect((await as('anon','','select snapshot from public.shared_journeys')).rows).toHaveLength(0);
 await expect(as('service_role','',`select public.commit_shared_journey('${id}','${owner}',1,'public','{}')`)).rejects.toThrow();
});
it('rate-limits server operations and does not let clients reset budgets',async()=>{
 expect((await as('service_role','',"select public.consume_operation('test',1) as allowed")).rows[0].allowed).toBe(true);
 expect((await as('service_role','',"select public.consume_operation('test',1) as allowed")).rows[0].allowed).toBe(false);
 await expect(as('authenticated',owner,"select public.consume_operation('test',1000)")).rejects.toThrow();
});
it('isolates vehicle records and keeps Tesla vault references server-only',async()=>{
 await as('authenticated',owner,`insert into public.vehicles(id,name,make,model) values(gen_random_uuid(),'Family car','Tesla','Model Y')`);
 expect((await as('authenticated',other,'select * from public.vehicles')).rows).toHaveLength(0);
 await as('service_role','',`insert into public.connected_services(owner_id,provider,status,vault_reference) values('${owner}','tesla','pending',gen_random_uuid())`);
 expect((await as('authenticated',other,'select status from public.connected_services')).rows).toHaveLength(0);
 await expect(as('authenticated',owner,'select vault_reference from public.connected_services')).rejects.toThrow();
 await expect(as('authenticated',owner,"update public.connected_services set status='connected'")).rejects.toThrow();
});
