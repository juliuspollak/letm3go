import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {beforeAll,afterAll,describe,expect,it} from 'vitest';
// 20261207000000: earlier completed activities are shared with the household only for an owner who has agreed,
// through the existing publication, and can be withdrawn. Three members of one household (me, Maria, Julia),
// plus an unrelated household and a friend.
const db=new PGlite();
const me='11111111-1111-4111-8111-111111111111',maria='22222222-2222-4222-8222-222222222222',julia='33333333-3333-4333-8333-333333333333';
const other1='44444444-4444-4444-8444-444444444444',other2='55555555-5555-4555-8555-555555555555',friend='66666666-6666-4666-8666-666666666666';
async function as(role,user,sql){
 await db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claims','{}',false);`);
 try{return await db.query(sql);}finally{await db.exec('reset role;');}
}
const id=(prefix,n)=>`${prefix}${String(n).padStart(7,'0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`.slice(0,36);
const ids={me:n=>id('a',n),maria:n=>id('b',n),julia:n=>id('c',n),other1:n=>id('d',n)};
const route=JSON.stringify([{latitude:-34.5,longitude:150.8,timestamp:1000,segment:0},{latitude:-34.6,longitude:150.9,timestamp:1100,segment:0},{latitude:-34.61,longitude:150.91,timestamp:1160,segment:0}]);
const snap=(title,t0)=>JSON.stringify({title,activity:'Driving',points:[{latitude:-34.6,longitude:150.9,segment:0,t:t0},{latitude:-34.61,longitude:150.91,segment:0,t:t0+60}],photos:[]});
const revision=async(owner,activity)=>(await as('authenticated',owner,`select revision from public.activities where id='${activity}'`)).rows[0].revision;
// What the journeys function does for each activity the database lists: publish it through the one atomic path.
async function backfill(owner,pass=25){
 const pending=(await as('authenticated',owner,`select activity_id,revision from public.my_auto_share_pending(${pass})`)).rows;
 for(const row of pending)await as('service_role','',`select public.publish_social_journey('${owner}','${row.activity_id}',${row.revision},'household','household','{}'::uuid[],'${snap('Old '+row.activity_id.slice(0,2),1600000000)}'::jsonb,true)`);
 return pending.map(r=>r.activity_id);
}
const insertActivity=(owner,activity,start,{points=route}={})=>as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,route_points)
 values('${activity}','Trip','Driving','manual','${start}'::timestamptz,'${start}'::timestamptz+interval '30 minutes',1800,9000,'${points}'::jsonb)`);
const seen=(viewer,owner,from,to)=>as('authenticated',viewer,`select activity_id,roads from public.my_shared_day('${owner}','${from}','${to}','{}')`).then(r=>r.rows);
const status=user=>as('authenticated',user,'select public.my_history_sharing() as v').then(r=>r.rows[0].v);
const published=async()=>(await db.query('select owner_id,activity_id from public.shared_journeys')).rows;

beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 insert into auth.users(id) values('${me}'),('${maria}'),('${julia}'),('${other1}'),('${other2}'),('${friend}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 grant usage on schema auth to anon,authenticated,service_role;
 grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
 create schema realtime;create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$select 1$$;`);
 for(const f of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 // Recordings that exist only in the cloud (not on any phone): three each, long before sharing began (2020), plus one
 // without a route and, for me, one I marked private.
 for(const [who,fn] of [[me,ids.me],[maria,ids.maria],[julia,ids.julia],[other1,ids.other1]]){
  await insertActivity(who,fn(1),'2020-03-16 08:00+00');
  await insertActivity(who,fn(2),'2020-03-17 08:00+00');
  await insertActivity(who,fn(3),'2020-03-18 08:00+00');
 }
 await insertActivity(me,ids.me(4),'2020-03-19 08:00+00',{points:'[]'});
 await insertActivity(me,ids.me(6),'2020-03-21 08:00+00');
 // Households: me, Maria and Julia; and two unrelated people. Joining sets household sharing on, from now.
 await as('authenticated',me,"select * from public.create_household('Family')");
 for(const who of [maria,julia]){
  const token=(await as('authenticated',me,'select public.invite_to_household() as token')).rows[0].token;
  await as('authenticated',who,`select * from public.accept_household_invitation('${token}')`);
 }
 await as('authenticated',other1,"select * from public.create_household('Other')");
 const inv=(await as('authenticated',other1,'select public.invite_to_household() as token')).rows[0].token;
 await as('authenticated',other2,`select * from public.accept_household_invitation('${inv}')`);
 const code=(await as('authenticated',me,'select public.create_friend_invite() as code')).rows[0].code;
 await as('authenticated',friend,`select public.accept_friend_invite('${code}')`);
 await as('authenticated',me,`select public.keep_activity_private('${ids.me(6)}')`);
},120000);
afterAll(()=>db.close());

describe('before anyone agrees',()=>{
 it('household membership is not consent: earlier activities are not eligible for anyone',async()=>{
  for(const who of [me,maria,julia])expect((await status(who)).enabled).toBe(false);
  expect((await as('authenticated',me,'select * from public.my_auto_share_pending(25)')).rows).toEqual([]);
  expect((await as('service_role','',`select public.auto_share_allowed('${me}','${ids.me(1)}') as ok`)).rows[0].ok).toBe(false);
  expect(await published()).toEqual([]);
 });
 it('new activities keep their own rule (since): an activity recorded after joining is eligible without any history consent',async()=>{
  await insertActivity(maria,ids.maria(9),new Date(Date.now()+3600e3).toISOString());
  expect((await as('service_role','',`select public.auto_share_allowed('${maria}','${ids.maria(9)}') as ok`)).rows[0].ok).toBe(true);
  expect((await as('service_role','',`select public.auto_share_allowed('${maria}','${ids.maria(1)}') as ok`)).rows[0].ok).toBe(false);
 });
 it('only a household member can agree',async()=>{
  await expect(as('authenticated',friend,'select public.set_history_sharing(true)')).rejects.toThrow(/Join a household/);
  await expect(as('anon','',"select public.set_history_sharing(true)")).rejects.toThrow();
 });
});

describe('my earlier activities, once I agree',()=>{
 it('reports how many are waiting and that a Home place is needed first',async()=>{
  await as('authenticated',me,'select public.set_history_sharing(true)');
  const s=await status(me);
  expect(s).toMatchObject({enabled:true,published:0,needsHome:true});
  // Eligible: finished, with a route, not private: three (not the one without a route or the private one).
  expect(Number(s.waiting)).toBe(3);
  expect((await status(maria)).enabled).toBe(false);
 });
 it('lists only my own eligible activities: not route-less or private ones, nor anyone else\'s',async()=>{
  const pending=(await as('authenticated',me,'select activity_id from public.my_auto_share_pending(25)')).rows.map(r=>r.activity_id).sort();
  // Neither the route-less one nor the private one is listed.
  expect(pending).toEqual([ids.me(1),ids.me(2),ids.me(3)].sort());
  // Maria has not agreed: only her activity recorded after joining is eligible, none of her earlier ones.
  expect((await as('authenticated',maria,'select activity_id from public.my_auto_share_pending(25)')).rows.map(r=>r.activity_id)).toEqual([ids.maria(9)]);
 });
 it('after the backfill Maria and Julia see them on the right days, and nobody else does',async()=>{
  await as('service_role','',`insert into public.saved_places(id,owner_id,name,kind,latitude,longitude,radius) values('99999999-9999-4999-8999-999999999999','${me}','Home','home',-34.5,150.8,100)`);
  expect((await status(me)).needsHome).toBe(false);
  expect((await backfill(me)).sort()).toEqual([ids.me(1),ids.me(2),ids.me(3)].sort());
  const dayOf=(who,d)=>seen(who,me,`2020-03-${d} 00:00+00`,`2020-03-${Number(d)+1} 00:00+00`);
  for(const viewer of [maria,julia]){
   expect((await dayOf(viewer,'16')).map(r=>r.activity_id)).toEqual([ids.me(1)]);   // an older day
   expect((await dayOf(viewer,'17')).map(r=>r.activity_id)).toEqual([ids.me(2)]);   // the next day
   expect((await dayOf(viewer,'18')).map(r=>r.activity_id)).toEqual([ids.me(3)]);
   expect(await dayOf(viewer,'19')).toEqual([]);                                     // the route-less one never appears
   expect(await dayOf(viewer,'21')).toEqual([]);                                     // the private one never appears
  }
  expect(await dayOf(friend,'16')).toEqual([]);
  expect(await dayOf(other1,'16')).toEqual([]);
  expect((await status(me))).toMatchObject({published:3,waiting:0});
 });
 it('is safe to run again: nothing new, no duplicates',async()=>{
  expect(await backfill(me)).toEqual([]);
  expect((await published()).filter(r=>r.owner_id===me)).toHaveLength(3);
  expect(Number((await db.query(`select count(*) as n from public.household_history_published where owner_id='${me}'`)).rows[0].n)).toBe(3);
  // Publishing the same activity again (a retry after a lost answer) replaces, never duplicates.
  await as('service_role','',`select public.publish_social_journey('${me}','${ids.me(1)}',${await revision(me,ids.me(1))},'household','household','{}'::uuid[],'${snap('Again',1)}'::jsonb,true)`);
  expect((await published()).filter(r=>r.owner_id===me)).toHaveLength(3);
 });
 it('a failed publication changes nothing and a retry succeeds',async()=>{
  await as('authenticated',maria,'select public.set_history_sharing(true)');
  await expect(as('service_role','',`select public.publish_social_journey('${maria}','${ids.maria(1)}',99,'household','household','{}'::uuid[],'${snap('x',1)}'::jsonb,true)`)).rejects.toThrow(/revision/);
  expect((await published()).filter(r=>r.owner_id===maria)).toHaveLength(0);
  expect(Number((await db.query(`select count(*) as n from public.household_history_published where owner_id='${maria}'`)).rows[0].n)).toBe(0);
  await as('service_role','',`insert into public.saved_places(id,owner_id,name,kind,latitude,longitude,radius) values('88888888-8888-4888-8888-888888888888','${maria}','Home','home',-34.5,150.8,100)`);
  expect((await backfill(maria)).sort()).toEqual([ids.maria(1),ids.maria(2),ids.maria(3),ids.maria(9)].sort());
 });
 it('Maria\'s and Julia\'s history reaches the others once each has agreed; Julia who has not agreed shares none',async()=>{
  expect((await seen(me,maria,'2020-03-16 00:00+00','2020-03-17 00:00+00')).map(r=>r.activity_id)).toEqual([ids.maria(1)]);
  expect((await seen(julia,maria,'2020-03-17 00:00+00','2020-03-18 00:00+00')).map(r=>r.activity_id)).toEqual([ids.maria(2)]);
  expect(await seen(me,julia,'2020-03-16 00:00+00','2020-03-19 00:00+00')).toEqual([]);
  expect(await seen(maria,julia,'2020-03-16 00:00+00','2020-03-19 00:00+00')).toEqual([]);
  await as('authenticated',julia,'select public.set_history_sharing(true)');
  await as('service_role','',`insert into public.saved_places(id,owner_id,name,kind,latitude,longitude,radius) values('77777777-7777-4777-8777-777777777777','${julia}','Home','home',-34.5,150.8,100)`);
  await backfill(julia);
  expect((await seen(me,julia,'2020-03-16 00:00+00','2020-03-19 00:00+00')).length).toBe(3);
  expect((await seen(maria,julia,'2020-03-16 00:00+00','2020-03-19 00:00+00')).length).toBe(3);
 });
 it('uses the road already stored for the activity, shown to the household, and looks nothing up',async()=>{
  const ref=`${ids.me(2).toUpperCase()}:1:2`;
  await as('service_role','',`insert into public.journey_road_metadata(owner_id,ref,record) values('${me}','${ref}','{"status":"route","line":"_p~iF~ps|U_ulLnnqC"}'::jsonb)`);
  const rows=await seen(maria,me,'2020-03-17 00:00+00','2020-03-18 00:00+00');
  expect(Object.keys(rows[0].roads||{})).toContain(ref);
 });
 it('an unrelated household is untouched: its own history is not shared, and mine is not visible to it',async()=>{
  expect((await as('authenticated',other1,'select public.my_history_sharing() as v')).rows[0].v.enabled).toBe(false);
  expect((await published()).filter(r=>r.owner_id===other1)).toEqual([]);
  expect(await seen(other2,me,'2020-03-16 00:00+00','2020-03-19 00:00+00')).toEqual([]);
  expect(await seen(me,other1,'2020-03-16 00:00+00','2020-03-19 00:00+00')).toEqual([]);
 });
});

describe('changing my mind, and what happens to an activity later',()=>{
 it('making one activity private removes it and it stays out, even for the history backfill',async()=>{
  await as('authenticated',me,`select public.keep_activity_private('${ids.me(3)}')`);
  expect(await seen(maria,me,'2020-03-18 00:00+00','2020-03-19 00:00+00')).toEqual([]);
  expect(await backfill(me)).toEqual([]);
  expect(await seen(maria,me,'2020-03-18 00:00+00','2020-03-19 00:00+00')).toEqual([]);
 });
 it('deleting an activity removes its shared copy',async()=>{
  await as('authenticated',me,`delete from public.activities where id='${ids.me(1)}'`);
  expect(await seen(maria,me,'2020-03-16 00:00+00','2020-03-17 00:00+00')).toEqual([]);
  expect((await published()).some(r=>r.activity_id===ids.me(1))).toBe(false);
 });
 it('withdrawing my consent removes what it published (not what a new-activity rule published), and records no private decision',async()=>{
  const newOne=ids.me(8);
  await insertActivity(me,newOne,new Date(Date.now()+7200e3).toISOString());
  const pending=(await as('authenticated',me,`select activity_id,revision from public.my_auto_share_pending(25)`)).rows.find(r=>r.activity_id===newOne);
  await as('service_role','',`select public.publish_social_journey('${me}','${newOne}',${pending.revision},'household','household','{}'::uuid[],'${snap('New',1)}'::jsonb,true)`);
  await as('authenticated',me,'select public.set_history_sharing(false)');
  const mine=(await published()).filter(r=>r.owner_id===me).map(r=>r.activity_id);
  expect(mine).toEqual([newOne]);
  expect((await status(me))).toMatchObject({enabled:false,published:0});
  expect(await seen(maria,me,'2020-03-17 00:00+00','2020-03-18 00:00+00')).toEqual([]);
  expect(Number((await db.query(`select count(*) as n from public.activity_share_decisions where activity_id='${ids.me(2)}'`)).rows[0].n)).toBe(0);
  // Not eligible again until I agree again; then it comes back.
  expect(await backfill(me)).toEqual([]);
  await as('authenticated',me,'select public.set_history_sharing(true)');
  expect(await backfill(me)).toEqual([ids.me(2)]);
 });
 it('someone who agreed but switched household sharing off, or left the household, shares nothing',async()=>{
  await as('authenticated',julia,'select public.set_auto_share(false)');
  await insertActivity(julia,ids.julia(7),'2020-04-01 08:00+00');
  expect((await as('authenticated',julia,'select * from public.my_auto_share_pending(25)')).rows).toEqual([]);
  expect((await as('service_role','',`select public.auto_share_allowed('${julia}','${ids.julia(7)}') as ok`)).rows[0].ok).toBe(false);
 });
});

it('can be applied twice without changing anything',async()=>{
 const before=JSON.stringify([(await db.query('select * from public.household_history_consent order by user_id')).rows,(await db.query('select activity_id from public.household_history_published order by activity_id')).rows]);
 await db.exec(await readFile('supabase/migrations/20261207000000_household_history_sharing.sql','utf8'));
 expect(JSON.stringify([(await db.query('select * from public.household_history_consent order by user_id')).rows,(await db.query('select activity_id from public.household_history_published order by activity_id')).rows])).toBe(before);
});
it('the new tables and functions are not reachable by clients directly',async()=>{
 await expect(as('authenticated',me,'select * from public.household_history_consent')).rejects.toThrow(/permission/);
 await expect(as('authenticated',me,'select * from public.household_history_published')).rejects.toThrow(/permission/);
 await expect(as('authenticated',me,`select public.publish_social_journey('${me}','${ids.me(2)}',1,'household','household','{}','{}',true)`)).rejects.toThrow(/permission/);
});

describe('later decisions',()=>{
 it('a share the owner makes deliberately afterwards is theirs: withdrawing the history consent leaves it',async()=>{
  const a=ids.julia(1);
  await as('authenticated',julia,'select public.set_auto_share(true)');
  // Published on the consent, then shared again by hand (to the household, as the app's Share sheet does).
  const rev=await revision(julia,a);
  const wasHistory=Number((await db.query(`select count(*) as n from public.household_history_published where activity_id='${a}'`)).rows[0].n)===1;
  expect(wasHistory).toBe(true);
  await as('service_role','',`select public.publish_social_journey('${julia}','${a}',${rev},'household','household','{}'::uuid[],'${snap('Mine',1)}'::jsonb,false)`);
  expect(Number((await db.query(`select count(*) as n from public.household_history_published where activity_id='${a}'`)).rows[0].n)).toBe(0);
  await as('authenticated',julia,'select public.set_history_sharing(false)');
  expect((await published()).some(r=>r.activity_id===a)).toBe(true);
 });
 it('a count and a list that agree, whatever is stored in route_points',async()=>{
  const s=await status(maria);
  const listed=(await as('authenticated',maria,'select * from public.my_auto_share_pending(25)')).rows.length;
  expect(Number(s.waiting)).toBe(listed);
 });
});
