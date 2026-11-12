import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {beforeAll,afterAll,describe,expect,it} from 'vitest';
import {redactRoute} from '../../supabase/functions/_shared/activityPrivacy.js';
// 20261208000000: household members share their activities with each other by default, including the earlier
// completed ones of people already in a household, done by the migration itself. Three members of one household
// (me, Maria, Julia), a member who switched sharing off, an unrelated household and a friend. The earlier
// recordings exist only in the database, and Maria and Julia have no Home place saved.
const NEW='20261208000000_household_history_automatic.sql';
const db=new PGlite();
const me='11111111-1111-4111-8111-111111111111',maria='22222222-2222-4222-8222-222222222222',julia='33333333-3333-4333-8333-333333333333';
const nina='77777777-7777-4777-8777-777777777777',other1='44444444-4444-4444-8444-444444444444',other2='55555555-5555-4555-8555-555555555555',friend='66666666-6666-4666-8666-666666666666';
async function as(role,user,sql){
 await db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claims','{}',false);`);
 try{return await db.query(sql);}finally{await db.exec('reset role;');}
}
const act=(prefix,n)=>`${prefix}${String(n).padStart(7,'0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`.slice(0,36);
const A={me:n=>act('a',n),maria:n=>act('b',n),julia:n=>act('c',n),nina:n=>act('e',n),other1:n=>act('d',n)};
// A drive that starts near Home (-34.5, 150.8), leaves it and is cut by a GPS gap.
const route=JSON.stringify([
 {latitude:-34.5,longitude:150.8,timestamp:1000.4,segment:0},{latitude:-34.5005,longitude:150.8005,timestamp:1030,segment:0},
 {latitude:-34.6,longitude:150.9,timestamp:1100.5,segment:0},{latitude:-34.61,longitude:150.91,timestamp:1160,segment:0},
 {latitude:-34.7,longitude:151.0,timestamp:1300,segment:1},{latitude:-34.71,longitude:151.01,timestamp:1360,segment:1}]);
const insert=(owner,id,start,{points=route}={})=>as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,route_points)
 values('${id}','Trip','Driving','manual','${start}'::timestamptz,'${start}'::timestamptz+interval '30 minutes',1800,9000,'${points}'::jsonb)`);
const seen=(viewer,owner,from,to)=>as('authenticated',viewer,`select activity_id,points,roads from public.my_shared_day('${owner}','${from}','${to}','{}')`).then(r=>r.rows);
const published=async()=>(await db.query('select owner_id,activity_id from public.shared_journeys')).rows;
const days=async(viewer,owner)=>{let n=0;for(const d of ['16','17','18','19','20','21'])n+=(await seen(viewer,owner,...day(d))).length;return n;};
const day=(d)=>[`2020-03-${d} 00:00+00`,`2020-03-${String(Number(d)+1).padStart(2,'0')} 00:00+00`];

beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 insert into auth.users(id) values('${me}'),('${maria}'),('${julia}'),('${nina}'),('${other1}'),('${other2}'),('${friend}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 grant usage on schema auth to anon,authenticated,service_role;
 grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
 create schema realtime;create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$select 1$$;`);
 // The database as it is on the hosted project before this migration: every earlier migration applied.
 for(const f of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')&&x<NEW).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 // Earlier recordings, in 2020, stored only in the database (no phone involved).
 for(const [who,fn] of [[me,A.me],[maria,A.maria],[julia,A.julia],[nina,A.nina],[other1,A.other1]]){
  await insert(who,fn(1),'2020-03-16 08:00+00');await insert(who,fn(2),'2020-03-17 08:00+00');await insert(who,fn(3),'2020-03-18 08:00+00');
 }
 await insert(me,A.me(4),'2020-03-19 08:00+00',{points:'[]'});   // no route
 await insert(me,A.me(5),'2020-03-20 08:00+00');                 // I will make this one private
 // Home for me only. Maria and Julia have none saved.
 await as('service_role','',`insert into public.saved_places(id,owner_id,name,kind,latitude,longitude,radius) values('99999999-9999-4999-8999-999999999999','${me}','Home','home',-34.5,150.8,100)`);
 // Households, as they were created before: joining gave each member household sharing "from now".
 await as('authenticated',me,"select * from public.create_household('Family')");
 for(const who of [maria,julia,nina]){
  const token=(await as('authenticated',me,'select public.invite_to_household() as token')).rows[0].token;
  await as('authenticated',who,`select * from public.accept_household_invitation('${token}')`);
 }
 await as('authenticated',other1,"select * from public.create_household('Other')");
 const inv=(await as('authenticated',other1,'select public.invite_to_household() as token')).rows[0].token;
 await as('authenticated',other2,`select * from public.accept_household_invitation('${inv}')`);
 const code=(await as('authenticated',me,'select public.create_friend_invite() as code')).rows[0].code;
 await as('authenticated',friend,`select public.accept_friend_invite('${code}')`);
 await as('authenticated',me,`select public.keep_activity_private('${A.me(5)}')`);
 await as('authenticated',nina,'select public.set_auto_share(false)');   // Nina chose not to share
 expect(await published()).toEqual([]);
},180000);
afterAll(()=>db.close());

describe('before the migration',()=>{
 it('earlier activities are not shared: the household sharing started when each member joined',async()=>{
  expect(await seen(maria,me,...day('16'))).toEqual([]);
  expect((await db.query('select count(*)::int as n from public.activity_auto_share where enabled')).rows[0].n).toBe(5); // me, maria, julia, other1, other2
 });
});

describe('the migration',()=>{
 it('shares every earlier completed activity of every household member, with no switch and no Home place needed',async()=>{
  await db.exec(await readFile('supabase/migrations/'+NEW,'utf8'));
  const by=owner=>published().then(rows=>rows.filter(r=>r.owner_id===owner).map(r=>r.activity_id).sort());
  expect(await by(me)).toEqual([A.me(1),A.me(2),A.me(3)].sort());       // not the route-less one, not the private one
  expect(await by(maria)).toEqual([A.maria(1),A.maria(2),A.maria(3)].sort());
  expect(await by(julia)).toEqual([A.julia(1),A.julia(2),A.julia(3)].sort());
 });
 it('is what the person-day map reads: Today, Yesterday and older days, for each pair',async()=>{
  const ids=(rows)=>rows.map(r=>r.activity_id);
  for(const [viewer,owner,fn] of [[maria,me,A.me],[julia,me,A.me],[me,maria,A.maria],[julia,maria,A.maria],[me,julia,A.julia],[maria,julia,A.julia]]){
   expect(ids(await seen(viewer,owner,...day('16')))).toEqual([fn(1)]);   // an older day
   expect(ids(await seen(viewer,owner,...day('17')))).toEqual([fn(2)]);   // the next day
   expect(ids(await seen(viewer,owner,...day('18')))).toEqual([fn(3)]);
  }
  expect(await seen(maria,me,...day('19'))).toEqual([]);
  expect(await seen(maria,me,...day('20'))).toEqual([]);                  // private
  expect(await days(maria,me)).toBe(3);
 });
 it('hides my Home from the route, exactly as a normal share does, and shows the rest with times',async()=>{
  const [row]=await seen(maria,me,...day('16'));
  const points=typeof row.points==='string'?JSON.parse(row.points):row.points;
  expect(points.some(p=>Math.abs(p.latitude+34.5)<0.002&&Math.abs(p.longitude-150.8)<0.002)).toBe(false);
  expect(points.length).toBe(4);
  expect(points.every(p=>Number.isFinite(p.t))).toBe(true);
  expect(new Set(points.map(p=>p.segment)).size).toBeGreaterThan(1);
 });
 it('with no Home saved (Maria, Julia) the whole recorded route is shared',async()=>{
  const [row]=await seen(me,maria,...day('16'));
  const points=typeof row.points==='string'?JSON.parse(row.points):row.points;
  expect(points).toHaveLength(6);
 });
 it('leaves alone anyone who chose not to share, and shares nothing with a friend or another household',async()=>{
  expect((await published()).filter(r=>r.owner_id===nina)).toEqual([]);
  expect((await db.query(`select enabled,since from public.activity_auto_share where user_id='${nina}'`)).rows[0].enabled).toBe(false);
  expect(await days(friend,me)).toBe(0);
  expect(await days(other2,me)).toBe(0);
  expect(await days(me,other1)).toBe(0);
  expect(await days(other2,other1)).toBe(3);   // their own household: same default
 });
 it('removes the opt-in objects of the earlier migration',async()=>{
  expect((await db.query("select count(*)::int as n from pg_proc where proname in ('my_history_sharing','set_history_sharing')")).rows[0].n).toBe(0);
  expect((await db.query("select count(*)::int as n from information_schema.tables where table_name like 'household_history%'")).rows[0].n).toBe(0);
 });
 it('can be run again without changing anything or duplicating a publication',async()=>{
  const before=JSON.stringify((await published()).sort((a,b)=>a.activity_id.localeCompare(b.activity_id)));
  await db.exec(await readFile('supabase/migrations/'+NEW,'utf8'));
  expect(JSON.stringify((await published()).sort((a,b)=>a.activity_id.localeCompare(b.activity_id)))).toBe(before);
  expect((await as('service_role','',`select public.publish_household_history() as n`)).rows[0].n).toBe(0);
 });
 it('clients cannot call the publishing functions',async()=>{
  await expect(as('authenticated',me,'select public.publish_household_history()')).rejects.toThrow(/permission/);
  await expect(as('authenticated',me,`select public.household_snapshot('${A.me(1)}')`)).rejects.toThrow(/permission/);
 });
});

describe('afterwards',()=>{
 it('a stored road is reused for the household, with nothing looked up',async()=>{
  const ref=`${A.me(2).toUpperCase()}:1:2`;
  await as('service_role','',`insert into public.journey_road_metadata(owner_id,ref,record) values('${me}','${ref}','{"status":"route","line":"_p~iF~ps|U_ulLnnqC"}'::jsonb)`);
  const [row]=await seen(maria,me,...day('17'));
  expect(Object.keys(row.roads||{})).toContain(ref);
 });
 it('making an activity private removes it for the household and keeps it out',async()=>{
  await as('authenticated',maria,`select public.keep_activity_private('${A.maria(2)}')`);
  expect(await seen(me,maria,...day('17'))).toEqual([]);
  expect((await as('service_role','',`select public.publish_household_history() as n`)).rows[0].n).toBe(0);
  expect(await seen(me,maria,...day('17'))).toEqual([]);
 });
 it('deleting an activity removes its shared copy',async()=>{
  await as('authenticated',julia,`delete from public.activities where id='${A.julia(1)}'`);
  expect(await seen(me,julia,...day('16'))).toEqual([]);
 });
 it('someone who joins the household later starts from joining: their earlier activities are not swept in',async()=>{
  await insert(friend,act('f',1),'2020-03-16 08:00+00');
  const token=(await as('authenticated',me,'select public.invite_to_household() as token')).rows[0].token;
  await as('authenticated',friend,`select * from public.accept_household_invitation('${token}')`);
  expect((await as('service_role','',`select public.publish_household_history() as n`)).rows[0].n).toBe(0);
  expect(await seen(me,friend,'2020-03-16 00:00+00','2020-03-17 00:00+00')).toEqual([]);
 });
 it('removing someone from the household removes what they could see',async()=>{
  await as('authenticated',me,`delete from public.household_memberships where user_id='${julia}'`).catch(()=>{});
  await db.exec(`delete from public.household_memberships where user_id='${julia}'`);
  expect(await seen(julia,me,...day('16'))).toEqual([]);
  expect(await seen(julia,maria,...day('16'))).toEqual([]);
 });
});

describe('the household copy is the same as the one the journeys function builds',()=>{
 const cases={
  'home in the middle, a gap and a segment change':[
   {latitude:-34.60,longitude:150.90,timestamp:100.5,segment:0},{latitude:-34.601,longitude:150.901,timestamp:130,segment:0},
   {latitude:-34.5,longitude:150.8,timestamp:200,segment:0},{latitude:-34.5002,longitude:150.8002,timestamp:230,segment:0},
   {latitude:-34.61,longitude:150.91,timestamp:300.49,segment:0},{latitude:-34.62,longitude:150.92,timestamp:330,segment:1},{latitude:-34.621,longitude:150.921,timestamp:340,segment:1}],
  'a link that crosses Home without a point inside it':[
   {latitude:-34.45,longitude:150.8,timestamp:10,segment:0},{latitude:-34.55,longitude:150.8,timestamp:70,segment:0},{latitude:-34.56,longitude:150.8,timestamp:90,segment:0}],
  'a very long link':[
   {latitude:-33.0,longitude:150.0,timestamp:10,segment:0},{latitude:-34.9,longitude:150.0,timestamp:70,segment:0},{latitude:-34.91,longitude:150.0,timestamp:90,segment:0}],
  'no timestamps on some points':[
   {latitude:-34.7,longitude:151.0,segment:0},{latitude:-34.71,longitude:151.01,timestamp:50,segment:0},{latitude:-34.72,longitude:151.02,timestamp:'x',segment:0}],
 };
 const placesSets={
  'Home and Work':[{kind:'home',latitude:-34.5,longitude:150.8,radius:100},{kind:'work',latitude:-34.62,longitude:150.92,radius:60}],
  'Work only':[{kind:'work',latitude:-34.62,longitude:150.92,radius:60}],
  'nothing saved':[],
 };
 for(const [caseName,points] of Object.entries(cases))for(const [placeName,places] of Object.entries(placesSets)){
  it(`${caseName}, ${placeName}`,async()=>{
   const owner='88888888-8888-4888-8888-888888888888',id=act('9',Math.floor(Math.random()*1e6));
   await db.exec(`insert into auth.users(id) values('${owner}') on conflict do nothing;delete from public.saved_places where owner_id='${owner}'`);
   for(const [i,p] of places.entries())await db.exec(`insert into public.saved_places(id,owner_id,name,kind,latitude,longitude,radius) values('${(i+1)}0000000-0000-4000-8000-000000000000','${owner}','${p.kind}','${p.kind}',${p.latitude},${p.longitude},${p.radius})`);
   await db.exec(`insert into public.activities(id,owner_id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,route_points) values('${id}','${owner}','T','Driving','manual','2020-01-01','2020-01-01 01:00',1,1,'${JSON.stringify(points)}'::jsonb)`);
   const sql=(await db.query(`select public.household_snapshot('${id}') as s`)).rows[0].s;
   const sqlPoints=typeof sql.points==='string'?JSON.parse(sql.points):sql.points;
   expect(sqlPoints).toEqual(redactRoute(points,places,300,{times:true}));
   await db.exec(`delete from public.activities where id='${id}'`);
  });
 }
});
