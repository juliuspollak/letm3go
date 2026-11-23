import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {beforeAll,afterAll,describe,expect,it} from 'vitest';
// A finished activity reaches the cloud without the app being open (20261216000000): the recorder sends it with the credential it
// already publishes the live trail with, it is shared with the household at once, and the app's later full backup replaces it.
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',mate='22222222-2222-4222-8222-222222222222',stranger='44444444-4444-4444-8444-444444444444';
const as=async(role,user,sql)=>{
 await db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claims','{}',false);`);
 return db.query(sql);
};
const t0=Date.now();
const iso=minutesAgo=>new Date(t0-minutesAgo*60000).toISOString();
const route=[{latitude:-34.5,longitude:150.8,timestamp:1,accuracy:5,altitude:1,speed:8,segment:0},{latitude:-34.51,longitude:150.81,timestamp:60,accuracy:5,altitude:1,speed:9,segment:0}];
const payload=(id,over={})=>({id,title:'Home → Plus Fitness',activity:'Driving',recording_mode:'automatic',started_at:iso(40),ended_at:iso(30),duration_seconds:600,distance_meters:2100,vehicle:null,route_points:route,...over});
const upload=(token,body)=>as('anon','',`select public.upload_finished_activity('${token}',$j$${JSON.stringify(body)}$j$::jsonb) as ok`).then(r=>r.rows[0].ok);
const row=async id=>(await as('authenticated',owner,`select title,recording_mode,visibility,revision,sync_fingerprint,classification,jsonb_array_length(route_points) n,distance_meters from public.activities where id='${id}'`)).rows[0];
const ids=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
let token;
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 insert into auth.users(id) values('${owner}'),('${mate}'),('${stranger}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 grant usage on schema auth to anon,authenticated,service_role;
 grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
 await db.exec(`create schema realtime;create table realtime.sent(topic text,event text,payload jsonb);
  create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language plpgsql as $$
  begin insert into realtime.sent values(topic,event,payload); end $$;`);
 for(const f of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 await as('authenticated',owner,"select * from public.create_household('Family')");
 const inv=(await as('authenticated',owner,'select public.invite_to_household() as token')).rows[0].token;
 await as('authenticated',mate,`select * from public.accept_household_invitation('${inv}')`);
 await as('authenticated',owner,"select public.set_my_live_location(true,-34.5,150.8,5,40,now(),'driving')");
 token=(await as('authenticated',owner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
},90000);
afterAll(()=>db.close());

describe('upload_finished_activity',()=>{
 it('stores a finished activity sent with the live-sharing credential as a provisional copy, once',async()=>{
  expect(await upload(token,payload(ids(1)))).toBe(true);
  const saved=await row(ids(1));
  expect(saved).toMatchObject({title:'Home → Plus Fitness',recording_mode:'automatic',visibility:'private',n:2,distance_meters:2100});
  expect(saved.sync_fingerprint).toBeNull();
  expect(saved.classification).toEqual({nativeUpload:1});
  // A repeat (a lost reply, a retry) changes nothing.
  const before=saved.revision;
  expect(await upload(token,payload(ids(1),{title:'Changed',distance_meters:5}))).toBe(true);
  expect(await row(ids(1))).toMatchObject({title:'Home → Plus Fitness',revision:before,distance_meters:2100});
 });
 it('refuses what the credential does not cover or the data does not support',async()=>{
  expect(await upload('0'.repeat(64),payload(ids(2)))).toBe(false);
  expect(await upload('short',payload(ids(2)))).toBe(false);
  expect(await upload(token,payload(ids(2),{recording_mode:'tesla'}))).toBe(false);
  expect(await upload(token,payload(ids(2),{started_at:iso(10),ended_at:iso(20)}))).toBe(false);
  expect(await upload(token,payload(ids(2),{started_at:iso(60*24*9),ended_at:iso(60*24*9-30)}))).toBe(false);
  expect(await upload(token,payload(ids(2),{route_points:route.slice(0,1)}))).toBe(false);
  expect(await upload(token,payload(ids(2),{route_points:[{latitude:'x'},{latitude:1}]}))).toBe(false);
  expect(await upload(token,{...payload(ids(2)),id:undefined})).toBe(false);
  expect(await row(ids(2))).toBeUndefined();
 });
 it('keeps an activity the owner made private, or deleted, out',async()=>{
  await as('service_role','',`insert into public.private_activity_refs(owner_id,ref) values('${owner}','${ids(3)}')`);
  expect(await upload(token,payload(ids(3)))).toBe(false);
  expect(await row(ids(3))).toBeUndefined();
  expect(await upload(token,payload(ids(4)))).toBe(true);
  await as('authenticated',owner,`delete from public.activities where id='${ids(4)}'`);
  expect(await upload(token,payload(ids(4)))).toBe(true);
  expect(await row(ids(4))).toBeUndefined();
 });
 it('shares the activity with the household at once, and with nobody else',async()=>{
  // Sharing was switched on yesterday: an activity from before it began would never be offered (that rule is the server's, not this test's).
  await as('service_role','',`update public.activity_auto_share set since=now()-interval '1 day' where user_id='${owner}'`);
  expect(await upload(token,payload(ids(5)))).toBe(true);
  expect((await as('service_role','',`select count(*)::int n from public.shared_journeys where activity_id='${ids(5)}' and audience='household'`)).rows[0].n).toBe(1);
  // What a household member sees of the owner's day, through the same function the Map uses.
  const shared=async user=>(await as('authenticated',user,`select count(*)::int n from public.my_shared_day('${owner}',now()-interval '1 day',now()+interval '1 day','{}') where activity_id='${ids(5)}'`).catch(()=>({rows:[{n:0}]}))).rows[0].n===1;
  expect(await shared(mate)).toBe(true);
  expect(await shared(stranger)).toBe(false);
 });
 it('leaves a credential that is not sharing without any power',async()=>{
  await as('authenticated',owner,'select public.set_my_live_location(false)');
  expect(await upload(token,payload(ids(6)))).toBe(false);
  expect(await row(ids(6))).toBeUndefined();
  await as('authenticated',owner,'select public.set_my_live_location(true)');
  token=(await as('authenticated',owner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
  expect(await upload(token,payload(ids(6)))).toBe(true);
 });
});

describe('upload_finished_activity hardening',()=>{
 it('validates every route point and bounds the payload',async()=>{
  const bad=[...route,{latitude:'x',longitude:1},...route.slice(0,1)];
  expect(await upload(token,payload(ids(20),{route_points:[route[0],{latitude:95,longitude:1},route[1]]}))).toBe(false);
  expect(await upload(token,payload(ids(20),{route_points:[route[0],{latitude:1,longitude:200},route[1]]}))).toBe(false);
  expect(await upload(token,payload(ids(20),{route_points:bad}))).toBe(false);
  expect(await upload(token,payload(ids(20),{route_points:[route[0],5,route[1]]}))).toBe(false);
  expect(await upload(token,payload(ids(20),{started_at:iso(60*24*11),ended_at:iso(30)}))).toBe(false);
  expect(await row(ids(20))).toBeUndefined();
 });
 it('does not reveal or touch somebody else\'s activity',async()=>{
  await as('service_role','',`insert into public.activities(id,owner_id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,route_points)
   values('${ids(21)}','${mate}','Theirs','Driving','manual',now()-interval '2 hours',now()-interval '1 hour',60,100,'[]')`);
  expect(await upload(token,payload(ids(21),{title:'Mine now'}))).toBe(false);
  const theirs=(await as('service_role','',`select title,owner_id from public.activities where id='${ids(21)}'`)).rows[0];
  expect(theirs).toEqual({title:'Theirs',owner_id:mate});
  await as('service_role','',`insert into public.activity_tombstones(id,owner_id) values('${ids(22)}','${mate}')`);
  expect(await upload(token,payload(ids(22)))).toBe(false);
  await as('service_role','',`insert into public.activity_tombstones(id,owner_id) values('${ids(23)}','${owner}')`);
  expect(await upload(token,payload(ids(23)))).toBe(true);
  expect(await row(ids(23))).toBeUndefined();
 });
 it('brings a still-provisional copy up to date when the journey resumed, and only then',async()=>{
  expect(await upload(token,payload(ids(24),{started_at:iso(90),ended_at:iso(60),distance_meters:1000}))).toBe(true);
  const first=await row(ids(24));
  // Same end (a retry): nothing changes.
  expect(await upload(token,payload(ids(24),{started_at:iso(90),ended_at:iso(60),distance_meters:9}))).toBe(true);
  expect((await row(ids(24))).revision).toBe(first.revision);
  // The journey resumed and ended later, with more route.
  const longer=[...route,{latitude:-34.52,longitude:150.82,timestamp:120,accuracy:5,altitude:1,speed:9,segment:0}];
  expect(await upload(token,payload(ids(24),{started_at:iso(90),ended_at:iso(20),distance_meters:3000,route_points:longer}))).toBe(true);
  expect(await row(ids(24))).toMatchObject({n:3,distance_meters:3000});
  // Once the app has backed it up in full the recorder's word is no longer taken.
  await as('authenticated',owner,`select public.backup_private_activity('${owner}',$j$${JSON.stringify(payload(ids(24),{started_at:iso(90),ended_at:iso(20),distance_meters:3000,route_points:longer,title:'Full'}))}$j$::jsonb,'${'f'.repeat(64)}',null,null)`);
  expect(await upload(token,payload(ids(24),{started_at:iso(90),ended_at:iso(5),distance_meters:7000}))).toBe(true);
  expect(await row(ids(24))).toMatchObject({title:'Full',n:3,distance_meters:3000});
 });
 it('counts only recent provisional copies towards the cap',async()=>{
  await as('service_role','',`insert into public.activities(id,owner_id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,route_points,classification)
   select ('bbbbbbbb-bbbb-4bbb-8bbb-'||lpad(g::text,12,'0'))::uuid,'${owner}','Old','Driving','automatic',now()-interval '30 days',now()-interval '29 days',60,100,'[]','{"nativeUpload":1}' from generate_series(1,205) g`);
  expect(await upload(token,payload(ids(25)))).toBe(true);
 });
});

describe('the app\'s full backup after the recorder\'s upload',()=>{
 const fp=c=>c.repeat(64);
 const backup=(body,fingerprint,expected='null',base='null')=>as('authenticated',owner,`select public.backup_private_activity('${owner}',$j$${JSON.stringify(body)}$j$::jsonb,'${fingerprint}',${expected},${base}) as r`).then(r=>r.rows[0].r);
 it('replaces the provisional copy instead of conflicting with it',async()=>{
  expect(await upload(token,payload(ids(10)))).toBe(true);
  const full={...payload(ids(10),{title:'My own title',description:'Shopping',tags:['gym']}),classification:{predicted:'Driving',confidence:'high',evidence:[]},user_corrected:true};
  // The app has no receipt for it yet: no expected revision, no baseline.
  const result=await backup(full,fp('a'));
  expect(Number.isInteger(result.revision)).toBe(true);
  const saved=await row(ids(10));
  expect(saved).toMatchObject({title:'My own title',sync_fingerprint:fp('a')});
  expect(saved.classification).not.toHaveProperty('nativeUpload');
  // And now it is an ordinary backed-up activity again: an acknowledgement is repeatable, a stale writer is still refused.
  expect(await backup(full,fp('a'))).toMatchObject({revision:result.revision});
  await expect(backup({...full,title:'Someone else'},fp('b'))).rejects.toThrow(/conflict/i);
 });
 it('still refuses a backup with no baseline over an activity that was backed up in full',async()=>{
  await backup(payload(ids(11),{title:'Full'}),fp('c'));
  await expect(backup(payload(ids(11),{title:'Other'}),fp('d'))).rejects.toThrow(/conflict|baseline|revision/i);
 });
 it('lets the app back up an activity the recorder never sent, exactly as before',async()=>{
  const result=await backup(payload(ids(12)),fp('e'));
  expect(Number.isInteger(result.revision)).toBe(true);
  expect((await row(ids(12))).sync_fingerprint).toBe(fp('e'));
 });
});
