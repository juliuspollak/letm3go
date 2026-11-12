import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {beforeAll,afterAll,describe,expect,it} from 'vitest';
// 20261209000000: a household history publication that fails is recorded and reported, never dropped, and resumes. The earlier
// migrations (including 20261208000000, which publishes the history) are applied first, as on the hosted project.
const NEW='20261209000000_household_history_failures.sql';
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


const bad=A.maria(2);
describe('a publication that fails',()=>{
 it('is recorded with its reason, warned about, and does not stop the others',async()=>{
  // Make exactly one publication fail the way a real fault would: the database refuses the write.
  await db.exec(`create function public.test_refuse() returns trigger language plpgsql as $$begin if new.activity_id='${bad}' then raise exception 'refused for the test'; end if; return new;end$$;
   create trigger test_refuse before insert or update on public.shared_journeys for each row execute function public.test_refuse();`);
  // The state the hosted project is in once 20261208000000 has switched sharing on for everyone since the beginning.
  await db.exec("update public.activity_auto_share set since='epoch' where enabled");
  expect(await published()).toEqual([]);
  await db.exec(await readFile('supabase/migrations/'+NEW,'utf8'));
  const failures=(await db.query('select activity_id,owner_id,sqlstate,reason,attempts from public.household_history_failures')).rows;
  expect(failures).toHaveLength(1);
  expect(failures[0]).toMatchObject({activity_id:bad,owner_id:maria,attempts:1});
  expect(failures[0].reason).toContain('refused for the test');
  expect(failures[0].reason).not.toMatch(/-34\.|150\.|151\./);   // never a coordinate
  const after=(await db.query('select count(*)::int as n from public.shared_journeys')).rows[0].n;
  expect(after).toBe(11);      // me, Maria and Julia 3 each, the other household 3, minus the one refused; not Nina (opted out), not the private or route-less ones
 });
 it('is visible in the status, with the activity still waiting', async()=>{
  const row=(await as('service_role','',`select * from public.household_history_status() where owner_id='${maria}'`)).rows[0];
  expect(row).toMatchObject({sharing_on:true,activities:3,with_route:3,shared_with_household:2,waiting:1,failing:1});
  const ok=(await as('service_role','',`select * from public.household_history_status() where owner_id='${me}'`)).rows[0];
  expect(ok).toMatchObject({shared_with_household:3,waiting:0,failing:0});
 });
 it('counts another attempt, and a run that succeeds publishes it and clears the record', async()=>{
  expect((await db.query(`select public.publish_household_history() as n`)).rows[0].n).toBe(0);
  expect((await db.query(`select attempts from public.household_history_failures`)).rows[0].attempts).toBe(2);
  await db.exec('drop trigger test_refuse on public.shared_journeys');
  expect((await db.query(`select public.publish_household_history() as n`)).rows[0].n).toBe(1);
  expect((await db.query('select count(*)::int as n from public.household_history_failures')).rows[0].n).toBe(0);
  expect((await seen(me,maria,...day('17'))).map(r=>r.activity_id)).toEqual([bad]);
  expect((await as('service_role','',`select waiting,failing from public.household_history_status() where owner_id='${maria}'`)).rows[0]).toMatchObject({waiting:0,failing:0});
 });
 it('forgets a failure once the activity is no longer waiting, such as when its owner makes it private', async()=>{
  await db.exec(`create trigger test_refuse before insert or update on public.shared_journeys for each row execute function public.test_refuse()`);
  await db.exec(`delete from public.shared_journeys where activity_id='${bad}'`);
  await db.query('select public.publish_household_history()');
  expect((await db.query('select count(*)::int as n from public.household_history_failures')).rows[0].n).toBe(1);
  await as('authenticated',maria,`select public.keep_activity_private('${bad}')`);
  await db.query('select public.publish_household_history()');
  expect((await db.query('select count(*)::int as n from public.household_history_failures')).rows[0].n).toBe(0);
  expect((await as('service_role','',`select failing from public.household_history_status() where owner_id='${maria}'`)).rows[0].failing).toBe(0);
  await db.exec('drop trigger test_refuse on public.shared_journeys');
 });
 it('cannot be read or run by clients', async()=>{
  await expect(as('authenticated',me,'select * from public.household_history_failures')).rejects.toThrow();
  await expect(as('authenticated',me,'select * from public.household_history_status()')).rejects.toThrow();
  await expect(as('authenticated',me,'select public.publish_household_history()')).rejects.toThrow();
 });
 it('can be applied again without changing anything', async()=>{
  const n=(await db.query('select count(*)::int as n from public.shared_journeys')).rows[0].n;
  await db.exec(await readFile('supabase/migrations/'+NEW,'utf8'));
  expect((await db.query('select count(*)::int as n from public.shared_journeys')).rows[0].n).toBe(n);
 });
});
