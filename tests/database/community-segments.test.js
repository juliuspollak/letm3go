import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
// Community segments (20261126000000 / 20261126000100): published without
// approval, discovered by every signed-in person, edited and deleted only by the
// creator or an admin, efforts without GPS, and segment notifications.
const db=new PGlite();
const ann='22222222-2222-4222-8222-222222222222',bob='33333333-3333-4333-8333-333333333333',cat='66666666-6666-4666-8666-666666666666',admin='11111111-1111-4111-8111-111111111111';
async function as(role,user,sql){
 await db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claims','{}',false);`);
 return db.query(sql);
}
const one=async(user,sql)=>(await as('authenticated',user,sql)).rows[0];
const fails=async(user,sql)=>{try{await as('authenticated',user,sql);}catch(error){return error.message;}throw new Error('expected a refusal: '+sql);};
// A ~400 m route of 21 points, about 20 m apart, heading north.
const route=(lat=-34.5,lon=150.85,points=21,step=0.00018)=>JSON.stringify(Array.from({length:points},(_,i)=>[lat+i*step,lon]));
const uuid=n=>`aaaaaaaa-0000-4000-8000-${String(n).padStart(12,'0')}`;
const publish=(user,id,name='Grove climb',geometry=route(),activity='Mountain biking')=>as('authenticated',user,`select public.publish_segment('${id}','${name}','${geometry}'::jsonb,'${activity}') as id`);
const effort=(user,key,segment,seconds,startedMinutesAgo=60)=>as('authenticated',user,
 `select public.record_segment_effort('${key.padEnd(20,'x')}','${segment}',${seconds},now()-interval '${startedMinutesAgo} minutes') as id`);
const inbox=async user=>(await as('authenticated',user,'select kind,title,body,route from public.notifications where read_at is null order by id')).rows;
const clear=user=>as('authenticated',user,'select public.mark_notifications_read()');
const list=async(user,scope='all',extra='')=>(await as('authenticated',user,`select * from public.list_segments('${scope}'${extra})`)).rows;

beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 insert into auth.users(id) values('${ann}'),('${bob}'),('${cat}'),('${admin}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 grant usage on schema auth to anon,authenticated,service_role;
 grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
 create schema vault;create table vault.decrypted_secrets(name text primary key,decrypted_secret text);
 create schema net;create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;`);
 for(const filename of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())
  await db.exec(await readFile('supabase/migrations/'+filename,'utf8'));
 await db.exec(`reset role;insert into public.profiles(id,display_name) values('${ann}','Ann'),('${bob}','Bob'),('${cat}','Cat'),('${admin}','Julius')
  on conflict (id) do update set display_name=excluded.display_name;insert into public.app_admins(user_id) values('${admin}');`);
},120000);
afterAll(()=>db.close());

describe('publishing',()=>{
 it('a segment from an activity is public at once, and another person discovers it with its creator',async()=>{
  expect((await publish(ann,uuid(1))).rows[0].id).toBe(uuid(1));
  const found=(await list(bob)).find(row=>row.id===uuid(1));
  expect(found).toMatchObject({name:'Grove climb',activity:'Mountain biking',creator_name:'Ann',mine:false,can_edit:false,status:'approved',visibility:'public'});
  expect(found.distance_meters).toBeGreaterThan(350);
  // The library row carries no route; the detail does.
  expect(found.geometry).toBeUndefined();
  const detail=(await one(bob,`select public.segment_detail('${uuid(1)}') as d`)).d;
  expect(detail).toMatchObject({name:'Grove climb',creator_name:'Ann',mine:false,can_edit:false,deleted:false});
  expect(detail.geometry).toHaveLength(21);
  // The raw tables also show it to Bob through RLS, as before for approved rows.
  expect((await as('authenticated',bob,`select id from public.mtb_segments where id='${uuid(1)}'`)).rows).toHaveLength(1);
  // No moderation submission, so no reviewer is notified.
  expect(await inbox(admin)).toEqual([]);
 });
 it('a retry is idempotent, and the same ID from another person is refused',async()=>{
  await publish(ann,uuid(1));
  expect((await as('authenticated',ann,`select count(*)::int n from public.mtb_segment_geometry where segment_id='${uuid(1)}'`)).rows[0].n).toBe(1);
  expect(await fails(bob,`select public.publish_segment('${uuid(1)}','Mine now','${route()}'::jsonb)`)).toMatch(/another creator/);
 });
 it('the creator renaming or re-sectioning on the device edits the same segment, keeping the old geometry version',async()=>{
  await publish(ann,uuid(1),'Grove climb (upper)',route(-34.5,150.85,25));
  const row=await one(ann,`select name,version from public.mtb_segments where id='${uuid(1)}'`);
  expect(row).toEqual({name:'Grove climb (upper)',version:2});
  expect((await as('authenticated',ann,`select version from public.mtb_segment_geometry where segment_id='${uuid(1)}' order by version`)).rows.map(r=>r.version)).toEqual([1,2]);
 });
 it('refuses geometry with a GPS gap, too few points or too little distance',async()=>{
  const gap=JSON.stringify([[-34.5,150.85],[-34.5002,150.85],[-34.5004,150.85],[-34.51,150.85],[-34.5102,150.85],[-34.5104,150.85]]);
  expect(await fails(ann,`select public.publish_segment('${uuid(90)}','Gap','${gap}'::jsonb)`)).toMatch(/GPS gap/);
  expect(await fails(ann,`select public.publish_segment('${uuid(91)}','Short','${route(-34.5,150.85,4)}'::jsonb)`)).toMatch(/too few points/);
  expect(await fails(ann,`select public.publish_segment('${uuid(92)}','Tiny','${route(-34.5,150.85,6,0.00005)}'::jsonb)`)).toMatch(/too short/);
  expect(await fails(ann,`select public.publish_segment('${uuid(93)}','  ','${route()}'::jsonb)`)).toMatch(/Invalid segment proposal/);
 });
 it('builds before publish_segment still publish through create_mtb_segment, and the hand-drawn draft path is gone',async()=>{
  await as('authenticated',bob,`select public.create_mtb_segment(p_client_id=>'${uuid(2)}',p_name=>'Old build',p_geometry=>'${route(-34.6)}'::jsonb,p_distance_meters=>400,p_direction=>'both',p_access=>'unknown')`);
  expect(await one(ann,`select status,visibility from public.mtb_segments where id='${uuid(2)}'`)).toEqual({status:'approved',visibility:'public'});
  expect(await fails(ann,`select public.create_mtb_segment('Drawn','${route()}'::jsonb)`)).toMatch(/does not exist|function/);
 });
});

describe('ownership',()=>{
 it('the creator renames and corrects the route; others see the change',async()=>{
  await publish(ann,uuid(3),'River path',route(-34.7),'Running');
  expect((await one(ann,`select public.update_segment('${uuid(3)}',p_name=>'River path north') as v`)).v).toBe(1);
  expect((await one(ann,`select public.update_segment('${uuid(3)}',p_geometry=>'${route(-34.7,150.85,15)}'::jsonb) as v`)).v).toBe(2);
  expect((await one(bob,`select public.segment_detail('${uuid(3)}') as d`)).d).toMatchObject({name:'River path north',version:2});
  expect((await one(bob,`select public.segment_detail('${uuid(3)}') as d`)).d.geometry).toHaveLength(15);
 });
 it('another person can neither edit nor delete it',async()=>{
  expect(await fails(bob,`select public.update_segment('${uuid(3)}',p_name=>'Hijacked')`)).toMatch(/may not edit/);
  expect(await fails(bob,`select public.delete_segment('${uuid(3)}')`)).toMatch(/may not delete/);
  // Direct writes were never granted.
  expect(await fails(bob,`update public.mtb_segments set name='x' where id='${uuid(3)}'`)).toMatch(/permission denied/);
  expect(await fails(ann,`update public.mtb_segments set name='x' where id='${uuid(3)}'`)).toMatch(/permission denied/);
  expect((await one(bob,`select public.segment_detail('${uuid(3)}') as d`)).d.name).toBe('River path north');
 });
 it('an admin edits it with a new verified geometry version and the creator is told',async()=>{
  await clear(ann);
  expect((await one(admin,`select public.update_segment('${uuid(3)}',p_name=>'River path (north bank)',p_geometry=>'${route(-34.7,150.85,12)}'::jsonb,p_note=>'Bridge closed') as v`)).v).toBe(3);
  expect((await as('service_role',admin,`select version,confidence from public.mtb_segment_geometry where segment_id='${uuid(3)}' order by version`)).rows)
   .toEqual([{version:1,confidence:'gps'},{version:2,confidence:'gps'},{version:3,confidence:'verified'}]);
  expect(await inbox(ann)).toEqual([expect.objectContaining({kind:'segment_changed',title:'An admin updated your segment',route:{screen:'segment',id:uuid(3)}})]);
  const audit=(await as('service_role',admin,`select action from public.mtb_moderation_events where segment_id='${uuid(3)}' order by created_at`)).rows.map(r=>r.action);
  expect(audit).toEqual(expect.arrayContaining(['published','renamed','geometry_versioned']));
 });
 it('the creator deletes it: gone from discovery and never republished by a sync retry',async()=>{
  await publish(bob,uuid(4),'Short loop',route(-34.8));
  await as('authenticated',bob,`select public.delete_segment('${uuid(4)}')`);
  expect((await list(ann)).map(r=>r.id)).not.toContain(uuid(4));
  expect((await list(bob,'mine')).map(r=>r.id)).not.toContain(uuid(4));
  expect((await one(ann,`select public.segment_detail('${uuid(4)}') as d`)).d).toBeNull();
  expect((await as('authenticated',bob,`select id from public.mtb_segments where id='${uuid(4)}'`)).rows).toEqual([]);
  // The device still holds the section and retries the upload: nothing comes back.
  expect((await publish(bob,uuid(4),'Short loop',route(-34.8))).rows[0].id).toBe(uuid(4));
  expect((await list(ann)).map(r=>r.id)).not.toContain(uuid(4));
  expect(await fails(bob,`select public.update_segment('${uuid(4)}',p_name=>'Back')`)).toMatch(/may not edit|deleted/);
  // Geometry history is kept for the audit trail.
  expect((await as('service_role',admin,`select count(*)::int n from public.mtb_segment_geometry where segment_id='${uuid(4)}'`)).rows[0].n).toBe(1);
 });
 it('an admin deletes someone else’s segment and the creator is told',async()=>{
  await publish(cat,uuid(5),'Stairs',route(-34.9));await clear(cat);
  await as('authenticated',admin,`select public.delete_segment('${uuid(5)}','Private land')`);
  expect(await inbox(cat)).toEqual([expect.objectContaining({kind:'segment_removed',title:'An admin removed your segment',body:'Stairs'})]);
  expect((await one(admin,`select public.segment_detail('${uuid(5)}') as d`)).d).toMatchObject({deleted:true});
 });
});

describe('discovery',()=>{
 it('filters: Mine, Nearby by area, search and activity type',async()=>{
  await publish(cat,uuid(6),'Harbour sprint',route(-33.86,151.2),'Running');
  expect((await list(cat,'mine')).map(r=>r.name)).toEqual(['Harbour sprint']);
  const near=await list(bob,'nearby',',null,null,-33.9,-33.8,151.1,151.3');
  expect(near.map(r=>r.name)).toEqual(['Harbour sprint']);
  expect((await list(bob,'all',`,'harb'`)).map(r=>r.name)).toEqual(['Harbour sprint']);
  expect((await list(bob,'all',`,null,'Running'`)).map(r=>r.name).sort()).toEqual(['Harbour sprint','River path (north bank)']);
  expect(await fails(bob,`select * from public.list_segments('nearby')`)).toMatch(/needs an area/);
 });
 it('the map layer loads only the visible area, capped, and refuses a world-sized request',async()=>{
  const rows=(await as('authenticated',bob,`select id from public.segments_for_map(-33.9,-33.8,151.1,151.3)`)).rows;
  expect(rows.map(r=>r.id)).toEqual([uuid(6)]);
  expect((await as('authenticated',bob,`select id from public.segments_for_map(-90,90,-180,180)`)).rows).toEqual([]);
 });
 it('anonymous callers see nothing',async()=>{
  for(const sql of [`select * from public.list_segments('all')`,`select public.segment_detail('${uuid(6)}')`,`select * from public.segments_for_map(-34,-33,151,152)`]){
   let refused='';try{await as('anon',ann,sql);}catch(error){refused=error.message;}
   expect(refused).toMatch(/permission denied/);
  }
 });
});

describe('efforts and notifications',()=>{
 const seg=uuid(20);
 beforeAll(async()=>{await publish(ann,seg,'Fire trail',route(-35.0));for(const u of [ann,bob,cat])await clear(u);});
 it('records an effort idempotently and tells the creator once, grouped per day',async()=>{
  // Bob chose to be named (Account & settings → Segment efforts → Show my name).
  await as('authenticated',bob,`insert into public.notification_settings(user_id,segment_participation) values('${bob}','public')`);
  const first=(await effort(bob,'bob-1',seg,120)).rows[0].id;
  expect((await effort(bob,'bob-1',seg,120)).rows[0].id).toBe(first);
  expect((await as('service_role',admin,`select count(*)::int n from public.segment_efforts where segment_id='${seg}'`)).rows[0].n).toBe(1);
  expect(await inbox(ann)).toEqual([expect.objectContaining({kind:'segment_completed',body:'Fire trail: Bob completed it',route:{screen:'segment',id:seg}})]);
  // Cat completes it too: still one notification, now counting both.
  await effort(cat,'cat-1',seg,150);
  const rows=await inbox(ann);
  expect(rows.filter(r=>r.kind==='segment_completed')).toHaveLength(1);
  expect(rows.find(r=>r.kind==='segment_completed').body).toBe('Fire trail: 2 people completed it today');
  // Pushes are created only for the first insert, never for the regrouping update.
  expect((await as('service_role',admin,`select count(*)::int n from public.notifications where kind='segment_completed' and recipient_id='${ann}'`)).rows[0].n).toBe(1);
 });
 it('a faster effort is a personal best for the athlete and a record for the creator',async()=>{
  await clear(ann);await clear(bob);
  await effort(bob,'bob-2',seg,100);
  expect(await inbox(bob)).toEqual([expect.objectContaining({kind:'segment_pb',title:'New personal best',body:'Fire trail: 00:01:40'})]);
  expect((await inbox(ann)).map(r=>r.kind)).toEqual(['segment_record']);
  // Slower than the record: neither a PB nor a record.
  await clear(ann);await clear(bob);
  await effort(bob,'bob-3',seg,110);
  expect(await inbox(bob)).toEqual([]);
  expect(await inbox(ann)).toEqual([]);
 });
 it('the creator’s own efforts never notify the creator as completions or records',async()=>{
  await clear(ann);
  await effort(ann,'ann-1',seg,90);
  expect((await inbox(ann)).map(r=>r.kind)).toEqual([]);
 });
 it('statistics show counts and best times without other people’s identities or routes',async()=>{
  const d=(await one(cat,`select public.segment_detail('${seg}') as d`)).d;
  expect(d.stats).toMatchObject({efforts:5,athletes:3,best_seconds:90,my_efforts:1,my_best_seconds:150});
  expect(JSON.stringify(d.stats)).not.toMatch(/Bob|Ann|lat|lon/);
  // Efforts are readable only by their athlete.
  expect((await as('authenticated',cat,`select athlete_id from public.segment_efforts`)).rows.every(r=>r.athlete_id===cat)).toBe(true);
 });
 it('refuses impossible times, unknown or deleted segments',async()=>{
  expect(await fails(bob,`select public.record_segment_effort('${'f'.repeat(20)}','${seg}',1,now())`)).toMatch(/Invalid effort/);
  expect(await fails(bob,`select public.record_segment_effort('${'g'.repeat(20)}','${uuid(4)}',100,now())`)).toMatch(/unavailable/);
  expect(await fails(bob,`select public.record_segment_effort('short','${seg}',100,now())`)).toMatch(/Invalid effort/);
 });
 it('respects notification preferences; in-app delivery does not depend on a push device',async()=>{
  await as('authenticated',ann,`insert into public.notification_settings(user_id,segment_community) values('${ann}',false)`);
  await clear(ann);
  await effort(cat,'cat-2',seg,60);
  expect(await inbox(ann)).toEqual([]);
  // Cat has no registered push device, yet the personal best is in Cat's inbox.
  expect((await as('service_role',admin,`select count(*)::int n from public.push_devices where owner_id='${cat}'`)).rows[0].n).toBe(0);
  expect((await inbox(cat)).map(r=>r.kind)).toContain('segment_pb');
 });
 it('marks exactly the opened notifications read',async()=>{
  const ids=(await as('authenticated',cat,'select id from public.notifications where read_at is null order by id')).rows.map(r=>r.id);
  expect((await one(cat,`select public.mark_notifications_read_ids(array[${ids[0]}]::bigint[]) as n`)).n).toBe(1);
  expect((await one(bob,`select public.mark_notifications_read_ids(array[${ids[0]}]::bigint[]) as n`)).n).toBe(0);
 });
});

describe('existing segment migration',()=>{
 it('publishes eligible older segments, leaves hidden, rejected, restricted and deleted ones alone, and is idempotent',async()=>{
  const g=route(-36.0);
  const rows=[['10','draft','private','unknown'],['11','submitted','private','unknown'],['12','under_review','private','unknown'],['13','approved','public','unknown'],
   ['14','hidden','private','unknown'],['15','rejected','private','unknown'],['16','approved','private','restricted'],['17','retired','private','unknown'],['18','draft','private','unknown']];
  await db.exec(`reset role;`+rows.map(([n,status,visibility,access])=>
   `insert into public.mtb_segments(id,name,status,visibility,access,creator_id) values('${uuid(100+Number(n))}','Old ${n}','${status}','${visibility}','${access}','${n==='13'?bob:ann}');
    insert into public.mtb_segment_geometry(segment_id,version,geometry) values('${uuid(100+Number(n))}',1,'${g}');`).join('')+
   `update public.mtb_segments set deleted_at=now() where id='${uuid(118)}';
    insert into public.mtb_segment_geometry(segment_id,version,geometry) values('${uuid(110)}',2,'${route(-36.0,150.85,4)}');
    update public.mtb_segments set version=2 where id='${uuid(110)}';`);
  const sql=await readFile('supabase/migrations/20261126000100_publish_existing_segments.sql','utf8');
  const before=(await db.query(`select id,creator_id,version from public.mtb_segments where id::text like 'aaaaaaaa-0000-4000-8000-0000000001%' order by id`)).rows;
  await db.exec(sql);await db.exec(sql);
  const after=(await db.query(`select id,status,visibility,creator_id,version from public.mtb_segments where id::text like 'aaaaaaaa-0000-4000-8000-0000000001%' order by id`)).rows;
  const state=Object.fromEntries(after.map(r=>[r.id.slice(-2),`${r.status}/${r.visibility}`]));
  expect(state).toEqual({
   10:'draft/private',          // current geometry version is invalid (4 points)
   11:'approved/public',12:'approved/public',13:'approved/public',
   14:'hidden/private',15:'rejected/private',16:'approved/private',17:'retired/private',18:'draft/private'});
  expect(after.map(({id,creator_id,version})=>({id,creator_id,version}))).toEqual(before);
  expect((await db.query(`select count(*)::int n from public.mtb_moderation_events where note like 'published by migration%'`)).rows[0].n).toBe(2);
  // Bob now discovers Ann's older segments.
  expect((await list(bob)).map(r=>r.name)).toEqual(expect.arrayContaining(['Old 11','Old 12','Old 13']));
  expect((await list(bob)).map(r=>r.name)).not.toEqual(expect.arrayContaining(['Old 14']));
 });
});

describe('deployment scripts',()=>{
 it('the pre-publish diagnostics and post-publish verification run, and every "expect no rows" check is empty',async()=>{
  await db.exec('reset role;');
  const pre=await db.exec(await readFile('supabase/scripts/segments/01_pre_publish_diagnostics.sql','utf8'));
  expect(pre).toHaveLength(5);
  expect(pre[0].rows.length).toBeGreaterThan(0);
  const post=await db.exec(await readFile('supabase/scripts/segments/03_post_publish_verification.sql','utf8'));
  expect(post).toHaveLength(7);
  for(const index of [1,2,3,4,5])expect(post[index].rows).toEqual([]);
  expect(post[6].rows.map(r=>r.name).sort()).toEqual(['Old 11','Old 12']);
 });
});

describe('review fixes',()=>{
 it('a resend that did not rename or re-section keeps a server-side rename and route correction',async()=>{
  await publish(cat,uuid(30),'Original',route(-35.5));
  await as('authenticated',admin,`select public.update_segment('${uuid(30)}',p_name=>'Corrected',p_geometry=>'${route(-35.5,150.85,15)}'::jsonb)`);
  await as('authenticated',cat,`select public.publish_segment('${uuid(30)}','Original','${route(-35.5)}'::jsonb,'MTB',false,false)`);
  const d=(await one(cat,`select public.segment_detail('${uuid(30)}') as d`)).d;
  expect(d.name).toBe('Corrected');expect(d.geometry).toHaveLength(15);
  // A real rename on the device is still applied.
  await as('authenticated',cat,`select public.publish_segment('${uuid(30)}','Renamed on phone','${route(-35.5)}'::jsonb,'MTB',true,false)`);
  expect((await one(cat,`select public.segment_detail('${uuid(30)}') as d`)).d).toMatchObject({name:'Renamed on phone',version:2});
 });
 it('a resend never publishes a segment that was returned with changes requested',async()=>{
  await db.exec(`reset role;insert into public.mtb_segments(id,name,status,visibility,creator_id) values('${uuid(31)}','Needs work','changes_requested','private','${cat}');
   insert into public.mtb_segment_geometry(segment_id,version,geometry) values('${uuid(31)}',1,'${route(-35.6)}');`);
  await publish(cat,uuid(31),'Needs work',route(-35.6));
  expect(await one(cat,`select status,visibility from public.mtb_segments where id='${uuid(31)}'`)).toEqual({status:'changes_requested',visibility:'private'});
 });
 it('a new route version starts its own board; earlier efforts stay as history',async()=>{
  await publish(ann,uuid(32),'Versioned',route(-35.7));
  await effort(bob,'v1-bob',uuid(32),60);
  await as('authenticated',ann,`select public.update_segment('${uuid(32)}',p_geometry=>'${route(-35.7,150.85,12)}'::jsonb)`);
  expect((await one(bob,`select public.segment_detail('${uuid(32)}') as d`)).d.stats).toMatchObject({efforts:0,best_seconds:null});
  await clear(bob);
  // Slower than the old-route time, but the first on this route: not a personal best.
  await effort(bob,'v2-bob',uuid(32),70);
  expect((await inbox(bob)).map(r=>r.kind)).not.toContain('segment_pb');
  expect((await one(bob,`select public.segment_detail('${uuid(32)}') as d`)).d.stats).toMatchObject({efforts:1,best_seconds:70});
  expect((await as('service_role',admin,`select count(*)::int n from public.segment_efforts where segment_id='${uuid(32)}'`)).rows[0].n).toBe(2);
 });
 it('a long segment name and display name never break recording an effort',async()=>{
  const long='L'.repeat(150);
  await db.exec(`reset role;update public.profiles set display_name='${'D'.repeat(100)}' where id='${bob}';`);
  await publish(cat,uuid(33),long,route(-35.8));
  await effort(bob,'long-bob',uuid(33),90);
  const row=(await inbox(cat)).find(r=>r.route.id===uuid(33));
  expect(row.body.length).toBeLessThanOrEqual(180);
  await db.exec(`reset role;update public.profiles set display_name='Bob' where id='${bob}';`);
 });
 it('the map layer stays capped at 60 while matching may ask for up to 200',async()=>{
  const n=(await as('authenticated',bob,`select count(*)::int n from public.segments_for_map(-37,-33,148,152,1000)`)).rows[0].n;
  expect(n).toBeGreaterThan(0);expect(n).toBeLessThanOrEqual(200);
 });
});

describe('participation privacy',()=>{
 const seg=uuid(40);
 beforeAll(async()=>{await publish(cat,seg,'Privacy hill',route(-36.5));await clear(cat);});
 it('by default an effort counts but its athlete is never named to the creator',async()=>{
  const dee='77777777-7777-4777-8777-777777777777';
  await db.exec(`reset role;insert into auth.users(id) values('${dee}');insert into public.profiles(id,display_name) values('${dee}','Dee') on conflict (id) do update set display_name='Dee';`);
  await effort(dee,'dee-1',seg,100);
  const rows=await inbox(cat);
  expect(rows.map(r=>r.body)).toEqual(['Privacy hill: Someone completed it']);
  expect(JSON.stringify(rows)).not.toMatch(/Dee/);
  expect((await as('authenticated',cat,`select actor_id from public.notifications where route->>'id'='${seg}'`)).rows).toEqual([{actor_id:null}]);
  await clear(cat);
  await effort(dee,'dee-2',seg,80);
  expect((await inbox(cat)).find(r=>r.kind==='segment_record').body).toBe('Privacy hill: Someone set 00:01:20');
  expect((await as('authenticated',cat,`select actor_id from public.notifications where route->>'id'='${seg}'`)).rows.every(row=>row.actor_id===null)).toBe(true);
  expect((await one(cat,`select public.segment_detail('${seg}') as d`)).d.stats).toMatchObject({efforts:2,athletes:1,best_seconds:80});
 });
 it('with efforts off nothing is stored, and earlier efforts can be removed',async()=>{
  await as('authenticated',bob,`update public.notification_settings set segment_participation='off' where user_id='${bob}'`);
  expect(await fails(bob,`select public.record_segment_effort('${'o'.repeat(20)}','${seg}',90,now())`)).toMatch(/Segment efforts are off/);
  const before=(await as('authenticated',bob,`select count(*)::int n from public.segment_efforts`)).rows[0].n;
  expect(before).toBeGreaterThan(0);
  expect((await one(bob,`select public.delete_my_segment_efforts() as n`)).n).toBe(before);
  expect((await as('authenticated',bob,`select count(*)::int n from public.segment_efforts`)).rows[0].n).toBe(0);
  // Someone else's efforts are untouched.
  expect((await as('service_role',admin,`select count(*)::int n from public.segment_efforts where athlete_id<>'${bob}'`)).rows[0].n).toBeGreaterThan(0);
  await as('authenticated',bob,`update public.notification_settings set segment_participation='public' where user_id='${bob}'`);
 });
 it('only the three choices are accepted, and only for yourself',async()=>{
  expect(await fails(bob,`update public.notification_settings set segment_participation='everyone' where user_id='${bob}'`)).toMatch(/check/);
  await as('authenticated',ann,`update public.notification_settings set segment_participation='off' where user_id='${bob}'`);
  expect((await as('service_role',admin,`select segment_participation from public.notification_settings where user_id='${bob}'`)).rows[0].segment_participation).toBe('public');
 });
});

describe('segment catalogue for older rides',()=>{
 it('pages through public segments changed after a cursor, oldest first, without deleted or private ones',async()=>{
  const all=(await as('authenticated',bob,`select id,changed_at from public.segment_catalogue_since(null,null,100)`)).rows;
  expect(all.length).toBeGreaterThan(5);
  const ids=all.map(r=>r.id);
  expect(ids).not.toContain(uuid(4));expect(ids).not.toContain(uuid(5));expect(ids).not.toContain(uuid(14));
  const firstPage=(await as('authenticated',bob,`select id,changed_at from public.segment_catalogue_since(null,null,3)`)).rows;
  const last=firstPage.at(-1);
  const next=(await as('authenticated',bob,`select id from public.segment_catalogue_since('${new Date(last.changed_at).toISOString()}','${last.id}',100)`)).rows.map(r=>r.id);
  expect([...firstPage.map(r=>r.id),...next]).toEqual(ids);
  // A newly published segment appears after the cursor.
  const cursor=all.at(-1);
  await publish(ann,uuid(50),'Brand new',route(-36.9));
  const fresh=(await as('authenticated',bob,`select id,min_lat from public.segment_catalogue_since('${new Date(cursor.changed_at).toISOString()}','${cursor.id}',100)`)).rows;
  expect(fresh.map(r=>r.id)).toEqual([uuid(50)]);
  expect(fresh[0].min_lat).toBeCloseTo(-36.9,3);
  let refused='';try{await as('anon',bob,`select * from public.segment_catalogue_since()`);}catch(e){refused=e.message;}
  expect(refused).toMatch(/permission denied/);
 });
});

// The end-to-end acceptance flow with two fresh people, A and B, and the admin.
describe('acceptance: A creates, B discovers and completes',()=>{
 const a='88888888-8888-4888-8888-888888888888',b='99999999-9999-4999-8999-999999999999',seg=uuid(60);
 const path=route(-37.2,151.3);
 beforeAll(async()=>{
  await db.exec(`reset role;insert into auth.users(id) values('${a}'),('${b}');insert into public.profiles(id,display_name) values('${a}','Alex'),('${b}','Blair') on conflict (id) do update set display_name=excluded.display_name;`);
 });
 it('A publishes from a recorded activity without approval; B finds it in All, Nearby, on the Map and in details, and cannot change it',async()=>{
  // B's catalogue cursor before A publishes.
  const cursor=(await as('authenticated',b,`select changed_at,id from public.segment_catalogue_since(null,null,100)`)).rows.at(-1);
  expect((await publish(a,seg,'Acceptance climb',path,'MTB')).rows[0].id).toBe(seg);
  expect(await one(a,`select status,visibility from public.mtb_segments where id='${seg}'`)).toEqual({status:'approved',visibility:'public'});
  expect((await list(b,'all',`,'acceptance'`)).map(r=>[r.id,r.creator_name,r.can_edit])).toEqual([[seg,'Alex',false]]);
  expect((await list(b,'nearby',',null,null,-37.3,-37.1,151.2,151.4')).map(r=>r.id)).toContain(seg);
  expect((await list(b,'nearby',',null,null,-30.3,-30.1,151.2,151.4')).map(r=>r.id)).not.toContain(seg);
  expect((await as('authenticated',b,`select id from public.segments_for_map(-37.3,-37.1,151.2,151.4)`)).rows.map(r=>r.id)).toContain(seg);
  expect((await one(b,`select public.segment_detail('${seg}') as d`)).d).toMatchObject({name:'Acceptance climb',creator_name:'Alex',can_edit:false,mine:false});
  expect(await fails(b,`select public.update_segment('${seg}',p_name=>'Mine')`)).toMatch(/may not edit/);
  expect(await fails(b,`select public.delete_segment('${seg}')`)).toMatch(/may not delete/);
  // B's older rides learn about it from the catalogue, after B's cursor.
  const fresh=(await as('authenticated',b,`select id from public.segment_catalogue_since('${new Date(cursor.changed_at).toISOString()}','${cursor.id}',100)`)).rows.map(r=>r.id);
  expect(fresh).toContain(seg);
 });
 it('B completes it: the effort is stored per B’s privacy choice and A is told in the app, without push',async()=>{
  await clear(a);
  await effort(b,'acc-b-1',seg,120);
  const rows=await inbox(a);
  expect(rows).toEqual([expect.objectContaining({kind:'segment_completed',body:'Acceptance climb: Someone completed it',route:{screen:'segment',id:seg}})]);
  expect((await as('service_role',admin,`select count(*)::int n from public.push_devices where owner_id='${a}'`)).rows[0].n).toBe(0);
  // B chooses to be named: the next notification says so.
  await as('authenticated',b,`insert into public.notification_settings(user_id,segment_participation) values('${b}','public')`);
  await clear(a);
  await effort(b,'acc-b-2',seg,100);
  expect((await inbox(a)).find(r=>r.kind==='segment_record').body).toBe('Acceptance climb: Blair set 00:01:40');
  expect((await one(a,`select public.segment_detail('${seg}') as d`)).d.stats).toMatchObject({efforts:2,athletes:1,best_seconds:100});
 });
 it('A and the admin manage it; once deleted it is gone and a retry cannot bring it back',async()=>{
  await as('authenticated',a,`select public.update_segment('${seg}',p_name=>'Acceptance climb (A)')`);
  await clear(a);
  await as('authenticated',admin,`select public.update_segment('${seg}',p_name=>'Acceptance climb (checked)')`);
  expect((await inbox(a)).map(r=>r.kind)).toEqual(['segment_changed']);
  await as('authenticated',a,`select public.delete_segment('${seg}')`);
  expect((await list(b,'all',`,'acceptance'`))).toEqual([]);
  expect((await as('authenticated',b,`select id from public.segments_for_map(-37.3,-37.1,151.2,151.4)`)).rows.map(r=>r.id)).not.toContain(seg);
  await publish(a,seg,'Acceptance climb',path,'MTB');
  expect((await list(b,'all',`,'acceptance'`))).toEqual([]);
  expect((await one(b,`select public.segment_detail('${seg}') as d`)).d).toBeNull();
 });
});
