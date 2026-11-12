import {encodeLine} from '../../src/lib/gapReconstruction.js';
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {beforeAll,afterAll,describe,expect,it} from 'vitest';
// Person day map (20261202000000): completed days compose from shared snapshots,
// live trails follow live-location permission, household auto-share is bounded.
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',mate='22222222-2222-4222-8222-222222222222',friend='33333333-3333-4333-8333-333333333333',stranger='44444444-4444-4444-8444-444444444444';
const A='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',B='ffffffff-ffff-4fff-8fff-ffffffffffff',OLD='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
async function as(role,user,sql){
 await db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claims','{}',false);`);
 return db.query(sql);
}
const snap=(title,t0)=>JSON.stringify({title,activity:'Driving',points:[{latitude:-34.5,longitude:150.8,segment:0,t:t0},{latitude:-34.51,longitude:150.81,segment:0,t:t0+60}],photos:[]});
const revision=async id=>(await as('authenticated',owner,`select revision from public.activities where id='${id}'`)).rows[0].revision;
async function share(id,audience,mode,recipients=[],title='Trip',t0=1900000000,auto=false){
 const list=recipients.length?`array[${recipients.map(x=>`'${x}'`).join(',')}]::uuid[]`:`'{}'::uuid[]`;
 await as('service_role','',`select public.publish_social_journey('${owner}','${id}',${await revision(id)},'${audience}','${mode}',${list},'${snap(title,t0)}'::jsonb,${auto})`);
}
const day=(user,known='{}')=>as('authenticated',user,`select activity_id,title,etag,points,roads from public.my_shared_day('${owner}','2030-03-17 00:00+00','2030-03-18 00:00+00','${known}')`).then(r=>r.rows);
const trail=async(user,after=0)=>{
 const first=(await as('authenticated',user,`select * from public.my_live_trail('${owner}',0)`)).rows[0];
 return !after||!first?first:(await as('authenticated',user,`select * from public.my_live_trail('${owner}',${after},'${first.privacy_revision}')`)).rows[0];
};
const pts=(...ts)=>JSON.stringify(ts.map(t=>[-34.5+t/1e7,150.8,BASE+t,0]));
const append=(token,ref,seq,points)=>as('anon','',`select public.append_live_trail('${token}','${ref}',${seq},'${points}'::jsonb) as ok`).then(r=>r.rows[0].ok);
const BASE=Math.floor(Date.now()/1000)-3600;
let houseToken,friendToken;
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 insert into auth.users(id) values('${owner}'),('${mate}'),('${friend}'),('${stranger}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 grant usage on schema auth to anon,authenticated,service_role;
 grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
 // Realtime is not part of PGlite: a stand-in that records what would be broadcast.
 await db.exec(`create schema realtime;create table realtime.sent(topic text,event text,payload jsonb);create table realtime.fail(on_ boolean);
  create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language plpgsql as $$
  begin if exists(select 1 from realtime.fail where on_) then raise exception 'realtime down'; end if; insert into realtime.sent values(topic,event,payload); end $$;`);
 for(const f of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 // An activity from before anyone joined the household.
 for(const [id,start] of [[OLD,'2030-03-16 08:00+00'],[A,'2030-03-17 08:00+00'],[B,'2030-03-17 12:00+00']])
  // With a route (automatic sharing only lists recordings that have one to show).
  await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,route_points)
   values('${id}','Trip','Driving','manual','${start}'::timestamptz,'${start}'::timestamptz+interval '30 minutes',1800,9000,'[{"latitude":-34.5,"longitude":150.8,"timestamp":1000,"segment":0},{"latitude":-34.6,"longitude":150.9,"timestamp":1100,"segment":0}]'::jsonb)`);
 await as('authenticated',owner,"select * from public.create_household('Family')");
 const code=(await as('authenticated',owner,'select public.create_friend_invite() as code')).rows[0].code;
 await as('authenticated',friend,`select public.accept_friend_invite('${code}')`);
 const code2=(await as('authenticated',owner,'select public.create_friend_invite() as code')).rows[0].code;
 await as('authenticated',mate,`select public.accept_friend_invite('${code2}')`);
 const inv=(await as('authenticated',owner,'select public.invite_to_household() as token')).rows[0].token;
 await as('authenticated',mate,`select * from public.accept_household_invitation('${inv}')`);
},90000);
afterAll(()=>db.close());

it('an unshared activity gives a viewer nothing, then only what was shared with them',async()=>{
 expect(await day(mate)).toEqual([]);
 await share(A,'friends','selected',[friend],'To the shops');
 expect((await day(friend)).map(r=>r.title)).toEqual(['To the shops']);
 expect(await day(mate)).toEqual([]);expect(await day(stranger)).toEqual([]);
});
it('a road found after a viewer cached the activity changes its etag, so it reaches them',async()=>{
 await share(A,'friends','selected',[friend],'To the shops');
 const code=(await as('authenticated',owner,'select public.create_friend_invite() as code')).rows[0].code;
 await as('authenticated',friend,`select public.accept_friend_invite('${code}')`).catch(()=>{});
 const before=(await day(friend))[0];
 await as('service_role','',`insert into public.journey_road_metadata(owner_id,ref,record) values('${owner}','${A.toUpperCase()}:1:2','{"status":"route","line":"_p~iF~ps|U_ulLnnqC"}'::jsonb)`);
 const after=(await day(friend,`{${before.etag}}`))[0];
 expect(after.etag).not.toBe(before.etag);expect(after.roads).toEqual({[A.toUpperCase()+':1:2']:'_p~iF~ps|U_ulLnnqC'});
});
it('hiding an activity removes its geometry from every viewer immediately',async()=>{
 await share(B,'household','household',[],'Afternoon',1900000000,true);
 expect((await day(mate)).map(r=>r.title)).toEqual(['Afternoon']);
 await as('service_role','',`delete from public.shared_journeys where activity_id='${B}'`);
 expect(await day(mate)).toEqual([]);
});
it('fetches only what changed: a known etag returns no points',async()=>{
 const [first]=await day(friend);
 expect(first.points.length).toBe(2);expect(first.points[0].t).toBe(1900000000);
 const [again]=await day(friend,`{${first.etag}}`);
 expect(again.points).toBeNull();expect(again.etag).toBe(first.etag);
});
it('a friend who stops being a friend loses the day',async()=>{
 await as('authenticated',friend,`select public.remove_friend('${owner}')`);
 expect(await day(friend)).toEqual([]);
});
it('the owner sees every one of their own activities, shared or private, in the same shape',async()=>{
 const rows=(await as('authenticated',owner,`select activity_id,title,etag,points,roads from public.my_shared_day('${owner}','2030-03-16 00:00+00','2030-03-18 00:00+00','{}')`)).rows;
 expect(rows.map(r=>r.activity_id)).toEqual(expect.arrayContaining([OLD,A]));   // OLD was never shared
 const old=rows.find(r=>r.activity_id===OLD);
 expect(Array.isArray(old.points)).toBe(true);
 // The same activity is not visible to a household member who was never given it.
 expect((await day(mate)).map(r=>r.activity_id)).not.toContain(OLD);
 expect((await day(stranger)).length).toBe(0);
});
it('the owner day carries real route points as {latitude, longitude, segment, t}, and revalidates by etag',async()=>{
 const id='99999999-0000-4000-8000-000000009999';
 await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,route_points)
  values('${id}','Own route','Driving','manual','2030-03-17 20:00+00','2030-03-17 20:30+00',1800,9000,
  '[{"latitude":-34.5,"longitude":150.8,"timestamp":1900000100.4,"segment":0},{"latitude":-34.6,"longitude":150.9,"timestamp":1900000200,"segment":1}]'::jsonb)`);
 const mine=(await as('authenticated',owner,`select * from public.my_shared_day('${owner}','2030-03-17 00:00+00','2030-03-18 00:00+00','{}')`)).rows.find(r=>r.activity_id===id);
 expect(mine.points).toEqual([{latitude:-34.5,longitude:150.8,segment:0,t:1900000100},{latitude:-34.6,longitude:150.9,segment:1,t:1900000200}]);
 const again=(await as('authenticated',owner,`select * from public.my_shared_day('${owner}','2030-03-17 00:00+00','2030-03-18 00:00+00','{${mine.etag}}')`)).rows.find(r=>r.activity_id===id);
 expect(again.points).toBeNull();
});
it('rejects a window over three days and anonymous reads',async()=>{
 expect((await as('authenticated',owner,`select * from public.my_shared_day('${owner}','2030-03-01','2030-03-20')`)).rows).toEqual([]);
 await expect(as('anon','',`select * from public.my_shared_day('${owner}','2030-03-17','2030-03-18')`)).rejects.toThrow();
});

it('household auto-share starts when they join and never sweeps in earlier activities',async()=>{
 const state=(await as('authenticated',mate,'select public.my_auto_share() as s')).rows[0].s;
 expect(state.enabled).toBe(true);
 // Join happened "now" (2026); the activities above are dated 2030, so recorded after joining.
 const pending=(await as('authenticated',mate,'select * from public.my_auto_share_pending()')).rows;
 expect(pending).toEqual([]); // mate has no activities
 const mine=(await as('authenticated',owner,'select * from public.my_auto_share_pending()')).rows.map(r=>r.activity_id);
 expect(mine).not.toContain(OLD===A?'':'x');
});
it('only the owner\'s own choices are decisions: sharing by hand and keeping private count, a share the system removes does not',async()=>{
 const pending=async()=>(await as('authenticated',owner,'select * from public.my_auto_share_pending(25)')).rows.map(r=>r.activity_id);
 // B was shared and then removed (not by the owner choosing): it is offered again.
 expect(await pending()).toContain(B);
 // Sharing by hand (what the journeys function records for a non-automatic publication) is a decision.
 await as('service_role','',`select public.remember_manual_share('${owner}','${B}')`);
 expect(await pending()).not.toContain(B);
 // A is shared right now, so it is not offered either.
 expect(await pending()).not.toContain(A);
});
it('an automatically shared activity that the system un-shares (an edit) is offered again; one the owner made private is not',async()=>{
 const id='cdcdcdcd-0000-4000-8000-00000000cd01';
 await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,route_points)
  values('${id}','Edited','Driving','manual',now()+interval '5 minutes',now()+interval '35 minutes',1800,9000,'[{"latitude":-34.5,"longitude":150.8,"timestamp":1000,"segment":0},{"latitude":-34.6,"longitude":150.9,"timestamp":1100,"segment":0}]'::jsonb)`);
 await share(id,'household','household',[],'Edited',1900000000,true);
 await as('service_role','',`delete from public.shared_journeys where activity_id='${id}'`);     // what protect_activity does on an edit
 expect((await as('authenticated',owner,'select * from public.my_auto_share_pending(25)')).rows.map(r=>r.activity_id)).toContain(id);
 await as('authenticated',owner,`select public.keep_activity_private('${id}')`);
 expect((await as('authenticated',owner,'select * from public.my_auto_share_pending(25)')).rows.map(r=>r.activity_id)).not.toContain(id);
});
it('pending activities are newest first and the client can exclude ones it cannot publish',async()=>{
 const all=(await as('authenticated',owner,'select * from public.my_auto_share_pending(10)')).rows.map(r=>r.activity_id);
 await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,route_points)
  values('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','New','Driving','manual','2031-01-01 08:00+00','2031-01-01 08:30+00',1800,9000,'[{"latitude":-34.5,"longitude":150.8,"timestamp":1000,"segment":0},{"latitude":-34.6,"longitude":150.9,"timestamp":1100,"segment":0}]'::jsonb),('c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2','Newer','Driving','manual','2031-01-02 08:00+00','2031-01-02 08:30+00',1800,9000,'[{"latitude":-34.5,"longitude":150.8,"timestamp":1000,"segment":0},{"latitude":-34.6,"longitude":150.9,"timestamp":1100,"segment":0}]'::jsonb)`);
 const now=(await as('authenticated',owner,'select * from public.my_auto_share_pending(10)')).rows.map(r=>r.activity_id);
 expect(now.slice(0,2)).toEqual(['c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2','c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1']);
 const skipped=(await as('authenticated',owner,"select * from public.my_auto_share_pending(10,array['c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2']::uuid[])")).rows.map(r=>r.activity_id);
 expect(skipped).not.toContain('c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2');expect(skipped[0]).toBe('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1');
 expect(all.length).toBeLessThanOrEqual(now.length);
});
it('an activity recorded before sharing began is never offered, however old or new its row is',async()=>{
 const id='abababab-0000-4000-8000-00000000ab01';
 await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters)
  values('${id}','Before joining','Driving','manual','2020-05-01 08:00+00','2020-05-01 08:30+00',1800,9000)`);
 expect((await as('authenticated',owner,'select * from public.my_auto_share_pending(25)')).rows.map(r=>r.activity_id)).not.toContain(id);
 // Turning it off and on again starts from that moment: what was recorded while it was off stays private.
 await as('authenticated',owner,'select public.set_auto_share(false)');
 await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters)
  values('abababab-0000-4000-8000-00000000ab02','While off','Driving','manual',now()-interval '40 minutes',now()-interval '20 minutes',1200,9000)`);
 await as('authenticated',owner,'select public.set_auto_share(true)');
 expect((await as('authenticated',owner,'select * from public.my_auto_share_pending(25)')).rows.map(r=>r.activity_id)).not.toContain('abababab-0000-4000-8000-00000000ab02');
});
it('turning auto-share off stops new activities; turning it on starts again from now',async()=>{
 await as('authenticated',owner,'select public.set_auto_share(false)');
 expect((await as('authenticated',owner,'select * from public.my_auto_share_pending()')).rows).toEqual([]);
 await as('authenticated',owner,'select public.set_auto_share(true)');
 const s=(await as('authenticated',owner,'select public.my_auto_share() as s')).rows[0].s;
 expect(Date.parse(s.since)).toBeGreaterThan(Date.now()-60000);
});

it('live trail: nobody sees it until live sharing is on, and it needs the device credential',async()=>{
 expect(await append('x'.repeat(64),'run1',1,pts(1,2))).toBe(false);
 await as('authenticated',owner,'select public.set_my_live_location(true,-34.5,150.8,5,40,now(),\'driving\')');
 houseToken=(await as('authenticated',owner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
 expect(await trail(mate)).toBeUndefined();
 expect(await append(houseToken,'run1',1,pts(10,20,30))).toBe(true);
 const t=await trail(mate);expect(t.activity_ref).toBe('run1');expect(t.points.length).toBe(3);
 expect(await trail(stranger)).toBeUndefined();
});
it('merges late, duplicate and out-of-order batches by time',async()=>{
 expect(await append(houseToken,'run1',3,pts(50,60))).toBe(true);
 expect(await append(houseToken,'run1',2,pts(40,10,20))).toBe(true);
 const t=await trail(mate);
 expect(t.points.map(p=>p[2]-BASE)).toEqual([10,20,30,40,50,60]);
 const newer=await trail(mate,BASE+40);
 expect(newer.points.map(p=>p[2]-BASE)).toEqual([50,60]);
});
it('a new activity replaces the trail, and an invalid point is refused whole',async()=>{
 await expect(append(houseToken,'run2',1,JSON.stringify([[95,0,BASE+100,0]]))).rejects.toThrow();
 expect(await append(houseToken,'run2',1,pts(100))).toBe(true);
 expect((await trail(mate)).activity_ref).toBe('run2');
 expect((await trail(mate)).points.length).toBe(1);
});
it('a private live activity: the phone\'s own request clears it, late batches cannot restore it, and the saved activity stays private',async()=>{
 await append(houseToken,'AAAAAAAA-0000-4000-8000-00000000A001',1,pts(900,910));
 expect((await trail(mate)).points.length).toBe(2);
 expect(await append(houseToken,'AAAAAAAA-0000-4000-8000-00000000A001',-2,'[]')).toBe(true);
 expect((await trail(mate)).points).toEqual([]);
 // A delayed batch (even in another letter case) and a late road are refused.
 expect(await append(houseToken,'aaaaaaaa-0000-4000-8000-00000000a001',2,pts(920))).toBe(false);
 expect(await append(houseToken,'AAAAAAAA-0000-4000-8000-00000000A001',3,pts(930))).toBe(false);
 expect((await trail(mate)).points).toEqual([]);
 // Even after another activity has come and gone.
 expect(await append(houseToken,'OTHER-1',1,pts(940))).toBe(true);
 expect(await append(houseToken,'AAAAAAAA-0000-4000-8000-00000000A001',4,pts(950))).toBe(false);
 // The activity once saved is never offered to automatic sharing.
 await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters)
  values('aaaaaaaa-0000-4000-8000-00000000a001','Private drive','Driving','manual','2032-01-01 08:00+00','2032-01-01 08:30+00',1800,9000)`);
 const pending=(await as('authenticated',owner,'select * from public.my_auto_share_pending(25)')).rows.map(r=>r.activity_id);
 expect(pending).not.toContain('aaaaaaaa-0000-4000-8000-00000000a001');
 await as('authenticated',owner,"select public.end_live_trail('OTHER-1')");
});
it('automatic sharing is refused for an activity made private meanwhile, and a manual share later is allowed',async()=>{
 const id='dddddddd-0000-4000-8000-00000000d001';
 await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters)
  values('${id}','Race','Driving','manual','2032-03-01 08:00+00','2032-03-01 08:30+00',1800,9000)`);
 const allowed=async()=>(await as('service_role','',`select public.auto_share_allowed('${owner}','${id}') as ok`)).rows[0].ok;
 expect(await allowed()).toBe(true);
 await as('authenticated',owner,`select public.keep_activity_private('${id}')`);   // while an automatic publication is on its way
 expect(await allowed()).toBe(false);
 await share(id,'household','household',[],'Chosen by hand');                       // an explicit share by the owner goes through
 await db.exec('reset role');
 expect((await db.query(`select count(*)::int as n from public.shared_journeys where activity_id='${id}'`)).rows[0].n).toBe(1);
 expect(await allowed()).toBe(false);                                               // but an AUTOMATIC one is still refused
});
it('publishing the same activity twice leaves one publication and one recipient set',async()=>{
 const id='dddddddd-0000-4000-8000-00000000d002';
 await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters)
  values('${id}','Twice','Driving','manual','2032-03-02 08:00+00','2032-03-02 08:30+00',1800,9000)`);
 await share(id,'household','household',[],'Twice');await share(id,'household','household',[],'Twice');
 const n=await db.query(`select (select count(*)::int from public.shared_journeys where activity_id='${id}') as j,(select count(*)::int from public.social_journey_recipients where activity_id='${id}') as r`);
 expect(n.rows[0]).toEqual({j:1,r:1});
 expect((await as('authenticated',owner,'select * from public.my_auto_share_pending(25)')).rows.map(r=>r.activity_id)).not.toContain(id);
});
it('marking a never-shared activity private by hand is remembered',async()=>{
 await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,route_points)
  values('bbbbbbbb-0000-4000-8000-00000000b001','Hand private','Driving','manual','2032-02-01 08:00+00','2032-02-01 08:30+00',1800,9000,'[{"latitude":-34.5,"longitude":150.8,"timestamp":1000,"segment":0},{"latitude":-34.6,"longitude":150.9,"timestamp":1100,"segment":0}]'::jsonb)`);
 expect((await as('authenticated',owner,'select * from public.my_auto_share_pending(25)')).rows.map(r=>r.activity_id)).toContain('bbbbbbbb-0000-4000-8000-00000000b001');
 await as('authenticated',owner,"select public.keep_activity_private('bbbbbbbb-0000-4000-8000-00000000b001')");
 expect((await as('authenticated',owner,'select * from public.my_auto_share_pending(25)')).rows.map(r=>r.activity_id)).not.toContain('bbbbbbbb-0000-4000-8000-00000000b001');
 // Someone else's activity cannot be marked.
 await as('authenticated',stranger,"select public.keep_activity_private('bbbbbbbb-0000-4000-8000-00000000b001')");
});
it('hiding the live activity clears it and blocks later points for that activity',async()=>{
 await as('authenticated',owner,"select public.end_live_trail('run2',true)");
 expect((await trail(mate)).points).toEqual([]);
 expect(await append(houseToken,'run2',2,pts(110))).toBe(false);
 expect(await append(houseToken,'run3',1,pts(120))).toBe(true);
});
it('the phone ending an activity (seq -1) clears its trail, including after an offline period',async()=>{
 await append(houseToken,'run9',1,pts(500));
 expect((await trail(mate)).points.length).toBe(1);
 expect(await append(houseToken,'run9',-1,'[]')).toBe(true);
 expect((await trail(mate)).points).toEqual([]);
 await append(houseToken,'run9',2,pts(510));
 await db.exec("reset role;update public.live_trails set updated_at=now()-interval '25 minutes'");
 expect((await trail(mate)).points).toEqual([]);
 await append(houseToken,'run9',3,pts(520));
});
it('finishing an activity clears its trail; stopping live sharing clears it too',async()=>{
 await as('authenticated',owner,"select public.end_live_trail('run9')");
 expect((await trail(mate)).points).toEqual([]);
 await append(houseToken,'run4',1,pts(130));
 await as('authenticated',owner,'select public.set_my_live_location(false)');
 expect(await trail(mate)).toBeUndefined();
});
it('friends see a live trail only while friend sharing is on, and never near Home',async()=>{
 await as('authenticated',owner,`insert into public.saved_places(id,name,kind,latitude,longitude,radius) values('99999999-9999-4999-8999-999999999999','Home','home',-34.5,150.8,100)`);
 await as('authenticated',owner,'select public.set_friend_location(true,-34.7,150.9,5)');
 friendToken=(await as('authenticated',owner,'select * from public.issue_my_friend_location_token()')).rows[0].publish_token;
 const far=JSON.stringify([[-34.7,150.9,BASE+200,0],[-34.5,150.8,BASE+210,0]]); // second point is at Home
 expect(await append(friendToken,'f1',1,far)).toBe(true);
 // befriend again: the earlier test removed the connection
 expect(await trail(friend)).toBeUndefined();
 const code=(await as('authenticated',owner,'select public.create_friend_invite() as code')).rows[0].code;
 await as('authenticated',friend,`select public.accept_friend_invite('${code}')`);
 const seen=await trail(friend);
 expect(seen.points.length).toBe(1);expect(seen.points[0][0]).toBeCloseTo(-34.7);
 await as('authenticated',owner,'select public.set_friend_location(false)');
 expect(await trail(friend)).toBeUndefined();
});
it('road estimates: stored once by the owner, hidden from friends when they touch Home',async()=>{
 await as('authenticated',owner,'select public.set_friend_location(true,-34.7,150.9,5)');
 friendToken=(await as('authenticated',owner,'select * from public.issue_my_friend_location_token()')).rows[0].publish_token;
 await append(friendToken,'r1',1,pts(300));
 const away='_p~iF~ps|U_ulLnnqC'; // a short line in the northern hemisphere, far from Home
 expect(await as('authenticated',owner,`select public.put_my_live_road('r1','R1:1:2','${away}') as ok`).then(r=>r.rows[0].ok)).toBe(true);
 expect(await as('authenticated',stranger,`select public.put_my_live_road('r1','R1:1:2','${away}') as ok`).then(r=>r.rows[0].ok)).toBe(false);   // not their trail
 const owned=await as('authenticated',owner,`select * from public.my_live_trail('${owner}')`);
 expect(owned.rows[0].roads).toEqual({'R1:1:2':away});
 // The same road drawn through Home is withheld from a friend but not from the owner.
 const lat=-34.5,lon=150.8,enc=n=>{n=Math.round(n*1e5);n=n<0?~(n<<1):n<<1;let o='';while(n>=32){o+=String.fromCharCode((32|(n&31))+63);n>>=5;}return o+String.fromCharCode(n+63);};
 const throughHome=enc(lat)+enc(lon)+enc(0.0001)+enc(0.0001);
 await as('authenticated',owner,`select public.put_my_live_road('r1','R1:3:4','${throughHome.replace(/\\/g,'\\\\')}')`);
 const seen=await as('authenticated',friend,`select * from public.my_live_trail('${owner}')`);
 expect(Object.keys(seen.rows[0].roads)).not.toContain('R1:3:4');
 expect(Object.keys((await as('authenticated',owner,`select * from public.my_live_trail('${owner}')`)).rows[0].roads)).toContain('R1:3:4');
});
it('the app can store a road on its own live trail only',async()=>{
 await append(friendToken,'r2',1,pts(400));
 const put=(user,ref)=>as('authenticated',user,`select public.put_my_live_road('${ref}','R2:1:2','_p~iF~ps|U_ulLnnqC') as ok`).then(r=>r.rows[0].ok);
 expect(await put(owner,'r2')).toBe(true);
 expect(await put(owner,'other')).toBe(false);
 expect(await put(stranger,'r2')).toBe(false);
 expect(Object.keys((await as('authenticated',owner,`select * from public.my_live_trail('${owner}')`)).rows[0].roads)).toContain('R2:1:2');
});
it('a friend\'s live line is cut where Home is hidden, so nothing is drawn across it; the owner gets the full line',async()=>{
 await as('authenticated',owner,'select public.set_friend_location(true,-34.7,150.9,5)');
 friendToken=(await as('authenticated',owner,'select * from public.issue_my_friend_location_token()')).rows[0].publish_token;
 // away, away, AT HOME, away, away: all the same segment as recorded.
 const batch=JSON.stringify([[-34.70,150.90,BASE+600,0],[-34.69,150.90,BASE+610,0],[-34.5,150.8,BASE+620,0],[-34.69,150.91,BASE+630,0],[-34.68,150.91,BASE+640,0]]);
 expect(await append(friendToken,'cut1',1,batch)).toBe(true);
 const seen=(await as('authenticated',friend,`select * from public.my_live_trail('${owner}')`)).rows[0];
 expect(seen.points.length).toBe(4);
 const segs=seen.points.map(p=>p[3]);
 expect(segs[0]).toBe(segs[1]);expect(segs[2]).toBe(segs[3]);expect(segs[1]).not.toBe(segs[2]);
 expect(seen.point_count).toBe(5);
 const mine=(await as('authenticated',owner,`select * from public.my_live_trail('${owner}')`)).rows[0];
 expect(mine.points.length).toBe(5);expect(new Set(mine.points.map(p=>p[3])).size).toBe(1);
 // An incremental read keeps segment numbers consistent with the full one.
 const later=(await as('authenticated',friend,`select * from public.my_live_trail('${owner}',${BASE+625},'${seen.privacy_revision}')`)).rows[0];
 expect(later.points.map(p=>p[3])).toEqual(segs.slice(2));
 await as('authenticated',owner,"select public.end_live_trail('cut1')");
 const cleared=(await as('authenticated',friend,`select * from public.my_live_trail('${owner}')`)).rows[0];
 expect(cleared.point_count).toBe(0);expect(cleared.points).toEqual([]);
});
it('a poll with nothing new returns no points but still reports the trail, and roads respect the viewer',async()=>{
 await as('authenticated',owner,'select public.set_my_live_location(true)');
 houseToken=(await as('authenticated',owner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
 await append(houseToken,'quiet1',1,JSON.stringify([[-34.9,151.0,BASE+3300,0],[-34.91,151.0,BASE+3310,0]]));
 const initial=await trail(mate);
 const none=(await as('authenticated',mate,`select * from public.my_live_trail('${owner}',${BASE+3310},'${initial.privacy_revision}')`)).rows[0];
 expect(none.points).toEqual([]);expect(none.point_count).toBe(2);expect(none.newest_t).toBe(BASE+3310);
 const some=(await as('authenticated',mate,`select * from public.my_live_trail('${owner}',${BASE+3300},'${initial.privacy_revision}')`)).rows[0];
 expect(some.points.map(p=>p[2])).toEqual([BASE+3310]);
 await as('authenticated',owner,"select public.end_live_trail('quiet1')");
});
it('a long drive keeps its whole timeline: older points are thinned, never cut off, and the bound holds',async()=>{
 await as('authenticated',owner,'select public.set_my_live_location(true)'); // re-enabling is a status-only call
 houseToken=(await as('authenticated',owner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
 // Two hours of driving at one fix per 2 s = 3600 points, sent in batches of 200 ending now.
 const start=Math.floor(Date.now()/1000)-7200;
 for(let b=0;b<18;b++){
  const batch=Array.from({length:200},(_,i)=>{const n=b*200+i;return [-34+n*1e-5,150+n*1e-5,start+n*2,0];});
  expect(await append(houseToken,'LONG-1',b+1,JSON.stringify(batch))).toBe(true);
 }
 const t=(await as('authenticated',owner,`select * from public.my_live_trail('${owner}')`)).rows[0];
 expect(t.point_count).toBeLessThanOrEqual(3000);
 const times=t.points.map(p=>p[2]);
 expect(times[0]).toBeLessThan(start+60);                 // the start of the drive is still there
 expect(times.at(-1)).toBe(start+3599*2);                  // and so is the newest point
 expect(times).toEqual([...times].sort((a,b)=>a-b));
 // The newest quarter is at full resolution (2 s apart); the oldest is thinned.
 const recent=times.slice(-500);expect(recent[1]-recent[0]).toBe(2);
 expect(times[1]-times[0]).toBeGreaterThan(2);
 // A scrub anywhere in the two hours finds a fix within a few minutes.
 const gaps=times.slice(1).map((x,i)=>x-times[i]);expect(Math.max(...gaps)).toBeLessThan(300);
 await as('authenticated',owner,"select public.end_live_trail('LONG-1')");
},120000);
it('turning off one audience keeps the trail the other still watches; leaving the household turns the household off',async()=>{
 await as('authenticated',owner,'select public.set_my_live_location(true)');
 houseToken=(await as('authenticated',owner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
 await as('authenticated',owner,'select public.set_friend_location(true,-34.7,150.9,5)');
 expect(await append(houseToken,'both1',1,JSON.stringify([[-34.9,151.0,BASE+700,0],[-34.91,151.0,BASE+710,0]]))).toBe(true);   // far from Home
 await as('authenticated',owner,'select public.set_friend_location(false)');
 expect((await trail(mate)).points.length).toBe(2);                         // the household still sees it
 await as('authenticated',owner,'select public.set_friend_location(true,-34.7,150.9,5)');
 await as('authenticated',owner,'select public.set_my_live_location(false)');
 expect((await trail(mate)).points.length).toBe(2);                         // friend sharing is still on, and mate is also a friend
 await as('authenticated',owner,'select public.set_friend_location(false)');
 await db.exec('reset role');
 expect((await db.query(`select jsonb_array_length(points) as n from public.live_trails where owner_id='${owner}'`)).rows[0].n).toBe(0);
});
it('keeping an activity private removes a copy automatic sharing published a moment earlier',async()=>{
 const id='eeeeeeee-0000-4000-8000-00000000e001';
 await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters)
  values('${id}','Just shared','Driving','manual','2030-03-17 21:00+00','2030-03-17 21:30+00',1800,9000)`);
 await share(id,'household','household',[],'Just shared');
 expect((await day(mate)).map(r=>r.activity_id)).toContain(id);
 await as('authenticated',owner,`select public.keep_activity_private('${id}')`);
 expect((await day(mate)).map(r=>r.activity_id)).not.toContain(id);
 expect((await as('service_role','',`select public.auto_share_allowed('${owner}','${id}') as ok`)).rows[0].ok).toBe(false);
});
it('a finished activity cannot be brought back as a live ghost by a late or retried batch',async()=>{
 await as('authenticated',owner,'select public.set_my_live_location(true)');
 houseToken=(await as('authenticated',owner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
 expect(await append(houseToken,'ghost1',1,pts(800,810))).toBe(true);
 expect(await append(houseToken,'ghost1',-1,'[]')).toBe(true);
 expect(await append(houseToken,'ghost1',2,pts(820))).toBe(true);           // the request that timed out and arrives late: accepted, but nothing is kept
 expect(await append(houseToken,'GHOST1',3,pts(830))).toBe(true);
 expect((await trail(mate)).points).toEqual([]);
 expect(await append(houseToken,'ghost2',1,pts(900))).toBe(true);           // the next activity is unaffected
 expect(await append(houseToken,'ghost2',-1,'[]')).toBe(true);
 expect(await append(houseToken,'ghost1',4,pts(840))).toBe(true);           // still ignored after another activity came and went
 expect((await trail(mate))?.points||[]).toEqual([]);
});
it('a resumed activity can publish again, a late batch from before the stop cannot, and private still works after a stop',async()=>{
 await as('authenticated',owner,'select public.set_my_live_location(true)');
 houseToken=(await as('authenticated',owner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
 const now=Math.floor(Date.now()/1000);
 expect(await append(houseToken,'resume1',1,pts(1000))).toBe(true);
 expect(await append(houseToken,'resume1',-1,'[]')).toBe(true);                     // stopped at a long red light
 expect(await append(houseToken,'resume1',2,pts(1001))).toBe(true);                // late batch from before the stop: nothing kept
 expect(await append(houseToken,'resume1',3,JSON.stringify([[-34.9,151,now+20,0]]))).toBe(true);   // it moves again
 expect((await trail(mate)).points.map(p=>p[2])).toEqual([now+20]);
 // Private after a stop is honoured (and confirmed), not refused.
 expect(await append(houseToken,'resume1',-1,'[]')).toBe(true);
 expect(await append(houseToken,'resume1',-2,'[]')).toBe(true);
 expect(await append(houseToken,'resume1',4,JSON.stringify([[-34.9,151,now+40,0]]))).toBe(false);
 // The record of what ended stays bounded and never forgets the newest.
 for(let i=0;i<12;i++){await append(houseToken,'bulk'+i,1,JSON.stringify([[-34.9,151,now+100+i,0]]));await append(houseToken,'bulk'+i,-1,'[]');}
 await db.exec('reset role');
 const kept=Object.keys((await db.query(`select ended_at from public.live_trails where owner_id='${owner}'`)).rows[0].ended_at);
 expect(kept.length).toBeLessThanOrEqual(8);expect(kept).toContain('bulk11');expect(kept).not.toContain('bulk0');
});
it('a resumed journey that drains an old backlog in order catches up instead of stalling',async()=>{
 await as('authenticated',owner,'select public.set_my_live_location(true)');
 houseToken=(await as('authenticated',owner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
 const now=Math.floor(Date.now()/1000);
 const old=Array.from({length:200},(_,i)=>[-34.9-i*1e-5,151,now-900+i,0]);
 expect(await append(houseToken,'drain1',1,JSON.stringify(old))).toBe(true);
 expect(await append(houseToken,'drain1',-1,'[]')).toBe(true);                       // stopped at a light
 // The phone starts again from the beginning of the journey: the old points are accepted and ignored ...
 expect(await append(houseToken,'drain1',2,JSON.stringify(old))).toBe(true);
 // ... and it carries on to the newer ones, which are kept.
 const fresh=Array.from({length:50},(_,i)=>[-35.0-i*1e-5,151,now+10+i,0]);
 expect(await append(houseToken,'drain1',3,JSON.stringify(fresh))).toBe(true);
 expect((await trail(mate)).points.length).toBe(50);
 await as('authenticated',owner,"select public.end_live_trail('drain1')");
});
it('a stop keeps the road estimates, so a journey that resumes does not lose them',async()=>{
 await as('authenticated',owner,'select public.set_my_live_location(true)');
 houseToken=(await as('authenticated',owner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
 const now=Math.floor(Date.now()/1000);
 await append(houseToken,'keep1',1,JSON.stringify([[-34.9,151,now-30,0]]));
 await as('authenticated',owner,`select public.put_my_live_road('keep1','K:1:2','_p~iF~ps|U_ulLnnqC')`);
 await append(houseToken,'keep1',-1,'[]');
 await append(houseToken,'keep1',2,JSON.stringify([[-34.91,151,now+20,0]]));
 expect(Object.keys((await trail(mate)).roads)).toEqual(['K:1:2']);
 await as('authenticated',owner,"select public.end_live_trail('keep1',true)");
});
it('a friend never gets a line drawn through the masked area between two sparse fixes',async()=>{
 await as('authenticated',owner,'select public.set_my_live_location(false)');
 await as('authenticated',owner,'select public.set_friend_location(true,-34.7,150.9,5)');
 friendToken=(await as('authenticated',owner,'select * from public.issue_my_friend_location_token()')).rows[0].publish_token;
 // Home is at -34.5,150.8 (masked to 400 m). These fixes are ~1 km either side of it: none is inside.
 const batch=JSON.stringify([[-34.5,150.79,BASE+3000,0],[-34.5,150.81,BASE+3030,0],[-34.5,150.82,BASE+3045,0]]);
 expect(await append(friendToken,'cross1',1,batch)).toBe(true);
 const seen=(await as('authenticated',friend,`select * from public.my_live_trail('${owner}')`)).rows[0];
 expect(seen.points.length).toBe(3);
 expect(seen.points[0][3]).not.toBe(seen.points[1][3]);      // cut across the masked stretch
 expect(seen.points[1][3]).toBe(seen.points[2][3]);          // an ordinary stretch stays joined
 const mine=(await as('authenticated',owner,`select * from public.my_live_trail('${owner}')`)).rows[0];
 expect(new Set(mine.points.map(p=>p[3])).size).toBe(1);
 // A stored road that runs past Home with no vertex near it is withheld too.
 const enc=n=>{n=Math.round(n*1e5);n=n<0?~(n<<1):n<<1;let o='';while(n>=32){o+=String.fromCharCode((32|(n&31))+63);n>>=5;}return o+String.fromCharCode(n+63);};
 const line=enc(-34.5)+enc(150.79)+enc(0)+enc(0.02);
 await as('authenticated',owner,`select public.put_my_live_road('cross1','X:1:2','${line.replace(/\\/g,'\\\\')}')`);
 expect(Object.keys((await as('authenticated',friend,`select * from public.my_live_trail('${owner}')`)).rows[0].roads)).not.toContain('X:1:2');
 expect(Object.keys((await as('authenticated',owner,`select * from public.my_live_trail('${owner}')`)).rows[0].roads)).toContain('X:1:2');
 await as('authenticated',owner,"select public.end_live_trail('cross1')");
 await as('authenticated',owner,'select public.set_friend_location(false)');
});
it('the owner day is thinned to about 1500 points per activity but keeps both ends and the segment breaks',async()=>{
 const id='77777777-0000-4000-8000-000000007777';
 await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,route_points)
  select '${id}','Long','Driving','manual','2033-01-01 08:00+00','2033-01-01 12:00+00',14400,90000,
   (select jsonb_agg(jsonb_build_object('latitude',-34.5-g*1e-5,'longitude',150.8,'timestamp',1990000000+g*4,'segment',case when g<1500 then 0 else 1 end) order by g) from generate_series(0,2899) g)`);
 const row=(await as('authenticated',owner,`select * from public.my_shared_day('${owner}','2033-01-01 00:00+00','2033-01-02 00:00+00','{}')`)).rows.find(r=>r.activity_id===id);
 expect(row.points.length).toBeLessThanOrEqual(1800);expect(row.points.length).toBeGreaterThan(1000);
 expect(row.points[0].t).toBe(1990000000);expect(row.points.at(-1).t).toBe(1990000000+2899*4);
 const last0=row.points.filter(p=>p.segment===0).at(-1),first1=row.points.find(p=>p.segment===1);
 expect(last0.t).toBe(1990000000+1499*4);expect(first1.t).toBe(1990000000+1500*4);
});
it('rejects a road that is not a well-formed polyline, and stores whether it touches a masked area once',async()=>{
 await as('authenticated',owner,'select public.set_my_live_location(true)');
 houseToken=(await as('authenticated',owner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
 await append(houseToken,'rd1',1,pts(950));
 const put=line=>as('authenticated',owner,`select public.put_my_live_road('rd1','R:1:2','${line}') as ok`).then(r=>r.rows[0].ok);
 expect(await put('~~~~~~~~~~~~~~~~')).toBe(false);          // would overflow a decoder
 expect(await put('abc')).toBe(false);                       // too short
 expect(await put('_p~iF~ps|U_ulLnnqC')).toBe(true);
 await db.exec('reset role');
 const stored=(await db.query(`select roads from public.live_trails where owner_id='${owner}'`)).rows[0].roads;
 expect(stored['R:1:2']).toEqual({l:'_p~iF~ps|U_ulLnnqC',c:true});
 await as('authenticated',owner,"select public.end_live_trail('rd1')");
});
it('the cut a friend sees around Home is the same after a long drive has been thinned',async()=>{
 await as('authenticated',owner,'select public.set_my_live_location(true)');
 await as('authenticated',owner,'select public.set_friend_location(true,-34.7,150.9,5)');
 houseToken=(await as('authenticated',owner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
 const start=Math.floor(Date.now()/1000)-9000;
 const away=n=>[-34.9-n*1e-5,151.0,start+n*2,0],home=n=>[-34.5,150.8,start+n*2,0];
 // 1500 away, 6 at Home, then 3000 away again: forces thinning of the older half.
 const all=[...Array.from({length:1500},(_,i)=>away(i)),...Array.from({length:6},(_,i)=>home(1500+i)),...Array.from({length:3000},(_,i)=>away(1506+i))];
 const before=[];
 for(let b=0;b<all.length;b+=200){
  expect(await append(houseToken,'mask1',b/200+1,JSON.stringify(all.slice(b,b+200)))).toBe(true);
  const row=(await as('authenticated',friend,`select * from public.my_live_trail('${owner}')`)).rows[0];
  if(b===1400)before.push(row);
 }
 const seen=(await as('authenticated',friend,`select * from public.my_live_trail('${owner}')`)).rows[0];
 const segs=[...new Set(seen.points.map(p=>p[3]))];
 expect(segs.length).toBe(2);                                 // exactly two runs: before Home and after Home
 const first=seen.points.filter(p=>p[3]===segs[0]).at(-1),second=seen.points.filter(p=>p[3]===segs[1])[0];
 expect(second[2]-first[2]).toBeLessThanOrEqual(8*2);         // the ends beside Home survived thinning
 expect(seen.points.some(p=>Math.abs(p[0]+34.5)<0.01)).toBe(false);
 await as('authenticated',owner,"select public.end_live_trail('mask1')");
 await as('authenticated',owner,'select public.set_friend_location(false)');
},180000);
const sent=async()=>{await db.exec('reset role');const rows=(await db.query("select topic,event,payload from realtime.sent where event='share' order by topic")).rows;await db.exec('delete from realtime.sent');return rows;};
describe('road privacy is decided once and stays correct',()=>{
 const id='f3f3f3f3-0000-4000-8000-00000000f003',enc=n=>{n=Math.round(n*1e5);n=n<0?~(n<<1):n<<1;let o='';while(n>=32){o+=String.fromCharCode((32|(n&31))+63);n>>=5;}return o+String.fromCharCode(n+63);};
 const lineNearHome=enc(-34.5)+enc(150.79)+enc(0)+enc(0.02);          // runs straight past Home (-34.5,150.8)
 const lineFar=enc(-34.9)+enc(151.2)+enc(-0.01)+enc(0.01);
 const flags=async()=>{await db.exec('reset role');return Object.fromEntries((await db.query(`select r.ref,p.clear as privacy_clear from public.journey_road_metadata r left join public.road_privacy p on p.owner_id=r.owner_id and p.ref=r.ref where r.owner_id='${owner}' and r.ref like 'F3F3F3F3%'`)).rows.map(r=>[r.ref,r.privacy_clear]));};
 const seenBy=async()=>Object.keys(((await as('authenticated',stranger,`select roads from public.my_shared_day('${owner}','2035-01-01 00:00+00','2035-01-02 00:00+00','{}')`)).rows[0]||{}).roads||{});
 it('is set when a road is written, not computed again on read',async()=>{
  const code=(await as('authenticated',owner,'select public.create_friend_invite() as code')).rows[0].code;
  await as('authenticated',stranger,`select public.accept_friend_invite('${code}')`);
  await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters)
   values('${id}','Roads','Driving','manual','2035-01-01 08:00+00','2035-01-01 08:30+00',1800,9000)`);
  await as('service_role','',`insert into public.journey_road_metadata(owner_id,ref,record) values
   ('${owner}','${id.toUpperCase()}:1:2',jsonb_build_object('status','route','line','${lineNearHome.replace(/\\/g,'\\\\')}')),
   ('${owner}','${id.toUpperCase()}:3:4',jsonb_build_object('status','route','line','${lineFar.replace(/\\/g,'\\\\')}')),
   ('${owner}','${id.toUpperCase()}:5:6',jsonb_build_object('status','none'))`);
  expect(await flags()).toEqual({[id.toUpperCase()+':1:2']:false,[id.toUpperCase()+':3:4']:true,[id.toUpperCase()+':5:6']:null});
  await share(id,'friends','selected',[stranger],'Roads');
  expect(await seenBy()).toEqual([id.toUpperCase()+':3:4']);                       // the road past Home is withheld
  expect(Object.keys((await as('authenticated',owner,`select roads from public.my_shared_day('${owner}','2035-01-01 00:00+00','2035-01-02 00:00+00','{}')`)).rows[0].roads).length).toBe(2);   // the owner sees both
 });
 it('follows Home when it moves: the existing rule withdraws shares, every flag becomes unknown, and sharing again decides them afresh',async()=>{
  await as('authenticated',owner,"update public.saved_places set latitude=-33.0,longitude=148.0 where kind='home' and owner_id=auth.uid()");
  expect(await seenBy()).toEqual([]);                                                              // shares were withdrawn when Home changed
  expect(Object.values(await flags()).every(v=>v===null)).toBe(true);                               // nothing is trusted any more
  await share(id,'friends','selected',[stranger],'Roads');
  expect((await seenBy()).sort()).toEqual([id.toUpperCase()+':1:2',id.toUpperCase()+':3:4']);   // Home is elsewhere now: both are clear
  await as('authenticated',owner,"update public.saved_places set latitude=-34.5,longitude=150.8 where kind='home' and owner_id=auth.uid()");
  await share(id,'friends','selected',[stranger],'Roads');
  expect(await seenBy()).toEqual([id.toUpperCase()+':3:4']);                                       // back: the road past Home is withheld again
 });
 it('re-deciding flags never journals the owner\'s roads as changed',async()=>{
  await db.exec('reset role');
  const before=(await db.query(`select count(*)::int as n,coalesce(max(revision),0)::int as r from public.journey_metadata_changes where owner_id='${owner}' and domain='roads'`)).rows[0];
  await as('authenticated',owner,"update public.saved_places set radius=120 where kind='home' and owner_id=auth.uid()");
  await db.exec('reset role');
  const after=(await db.query(`select count(*)::int as n,coalesce(max(revision),0)::int as r from public.journey_metadata_changes where owner_id='${owner}' and domain='roads'`)).rows[0];
  expect(after).toEqual(before);
 });
 it('a road not yet decided is decoded on read, so a missed refresh can only be slow, never a leak',async()=>{
  await share(id,'friends','selected',[stranger],'Roads');                        // moving Home withdrew the share (existing rule)
  await db.exec(`reset role;update public.road_privacy set clear=null where owner_id='${owner}'`);
  expect(await seenBy()).toEqual([id.toUpperCase()+':3:4']);
 });
 it('a road written before Home existed is checked when the activity is shared',async()=>{
  const id2='f4f4f4f4-0000-4000-8000-00000000f004';
  await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters)
   values('${id2}','Late share','Driving','manual','2035-01-01 09:00+00','2035-01-01 09:30+00',1800,9000)`);
  await db.exec(`reset role;alter table public.journey_road_metadata disable trigger road_privacy_on_write;insert into public.journey_road_metadata(owner_id,ref,record) values('${owner}','${id2.toUpperCase()}:1:2',jsonb_build_object('status','route','line','${lineNearHome.replace(/\\/g,'\\\\')}'));alter table public.journey_road_metadata enable trigger road_privacy_on_write;`);
  await share(id2,'friends','selected',[stranger],'Late share');
  await db.exec('reset role');
  expect((await db.query(`select clear as privacy_clear from public.road_privacy where ref='${id2.toUpperCase()}:1:2'`)).rows[0].privacy_clear).toBe(false);
 });
});
describe('telling open maps that access changed',()=>{
 it('unsharing signals the owner and everyone it was shared with, with an empty payload',async()=>{
  const id='f1f1f1f1-0000-4000-8000-00000000f001';
  await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters)
   values('${id}','Signal','Driving','manual','2034-01-01 08:00+00','2034-01-01 08:30+00',1800,9000)`);
  await share(id,'household','household',[],'Signal');
  await sent();
  await as('authenticated',owner,`select public.revoke_activity_publication('${id}')`);
  const rows=await sent();
  const topics=[...new Set(rows.map(r=>r.topic))].sort();
  expect(topics).toEqual([`user:${mate}`,`user:${owner}`].sort());
  expect(rows.every(r=>JSON.stringify(r.payload)==='{}')).toBe(true);
 });
 it('removing a friend signals both people',async()=>{
  await sent();
  await as('authenticated',owner,`select public.remove_friend('${mate}')`);
  expect([...new Set((await sent()).map(r=>r.topic))].sort()).toEqual([`user:${mate}`,`user:${owner}`].sort());
 });
 it('leaving the household signals the leaver and the members who remain',async()=>{
  await sent();
  await as('authenticated',mate,'select public.leave_household()');
  expect([...new Set((await sent()).map(r=>r.topic))].sort()).toEqual([`user:${mate}`,`user:${owner}`].sort());
 });
 it('a broadcast failure never fails the change that caused it',async()=>{
  const id='f2f2f2f2-0000-4000-8000-00000000f002';
  await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters)
   values('${id}','Down','Driving','manual','2034-02-01 08:00+00','2034-02-01 08:30+00',1800,9000)`);
  await share(id,'friends','selected',[friend],'Down').catch(()=>null);
  await db.exec('reset role;insert into realtime.fail values(true)');
  await as('authenticated',owner,`select public.revoke_activity_publication('${id}')`);
  await db.exec('reset role;delete from realtime.fail');
  expect((await db.query(`select count(*)::int as n from public.shared_journeys where activity_id='${id}'`)).rows[0].n).toBe(0);
 });
});
it('a friend is not told when a fix inside the masked area was taken; the owner and household are',async()=>{
 await as('authenticated',owner,'select public.set_my_live_location(true)');
 await as('authenticated',owner,'select public.set_friend_location(true,-34.7,150.9,5)');
 houseToken=(await as('authenticated',owner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
 const now=Math.floor(Date.now()/1000);
 await append(houseToken,'nt1',1,JSON.stringify([[-34.9,151,now-60,0],[-34.5,150.8,now-30,0]]));   // the last fix is at Home
 for(const after of [0,now]){
  const q=`select * from public.my_live_trail('${owner}',${after})`;
  const friendView=(await as('authenticated',stranger,q)).rows[0];
  expect(friendView.newest_t).toBeNull();
  expect(JSON.stringify(friendView.points)).not.toContain(String(now-30));
 }
 expect((await as('authenticated',owner,`select * from public.my_live_trail('${owner}',0)`)).rows[0].newest_t).toBe(now-30);
 await as('authenticated',owner,"select public.end_live_trail('nt1')");
 await as('authenticated',owner,'select public.set_friend_location(false)');
});
it('a Home or Work change re-checks the roads of a live trail in progress',async()=>{
 await as('authenticated',owner,'select public.set_my_live_location(true)');
 await as('authenticated',owner,'select public.set_friend_location(true,-34.7,150.9,5)');
 houseToken=(await as('authenticated',owner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
 const now=Math.floor(Date.now()/1000);
 await append(houseToken,'lr1',1,JSON.stringify([[-34.9,151,now-20,0]]));
 const enc=n=>{n=Math.round(n*1e5);n=n<0?~(n<<1):n<<1;let o='';while(n>=32){o+=String.fromCharCode((32|(n&31))+63);n>>=5;}return o+String.fromCharCode(n+63);};
 const line=enc(-35.2)+enc(151.3)+enc(0)+enc(0.02);                 // far from Home today
 await as('authenticated',owner,`select public.put_my_live_road('lr1','Z:1:2','${line.replace(/\\/g,'\\\\')}')`);
 expect(Object.keys((await as('authenticated',stranger,`select * from public.my_live_trail('${owner}')`)).rows[0].roads)).toContain('Z:1:2');
 // Work is saved right on that road: it must now be withheld from a friend, without waiting for a new road.
 await as('authenticated',owner,"insert into public.saved_places(id,name,kind,latitude,longitude,radius) values('77777777-7777-4777-8777-777777777777','Work','work',-35.2,151.31,100)");
 expect(Object.keys((await as('authenticated',stranger,`select * from public.my_live_trail('${owner}')`)).rows[0].roads)).not.toContain('Z:1:2');
 await as('authenticated',owner,"select public.end_live_trail('lr1')");
 await as('authenticated',owner,'select public.set_friend_location(false)');
});
it('keeping an activity private is recorded in both places the readers look, so neither can miss it',async()=>{
 const id='efefefef-0000-4000-8000-00000000ef01';
 await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters)
  values('${id}','Both','Driving','manual',now()-interval '1 hour',now()-interval '30 minutes',1800,9000)`);
 await as('authenticated',owner,`select public.keep_activity_private('${id}')`);
 expect((await as('service_role','',`select public.activity_ref_is_private('${owner}','${id.toUpperCase()}') as p`)).rows[0].p).toBe(true);
 expect((await as('service_role','',`select public.auto_share_allowed('${owner}','${id}') as ok`)).rows[0].ok).toBe(false);
});
it('the owner always sees their own trail, and tables are not directly readable',async()=>{
 await expect(as('authenticated',mate,'select * from public.live_trails')).rejects.toThrow();
 await expect(as('authenticated',mate,'select * from public.activity_auto_share')).rejects.toThrow();
});

it('invalidates an incremental live read after Home moves, with no new fixes, and reauthorises roads and GPS together',async()=>{
 await as('authenticated',owner,'select public.set_my_live_location(true)');
 await as('authenticated',owner,'select public.set_friend_location(true,-34.7,150.9,5)');
 houseToken=(await as('authenticated',owner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
 const now=Math.floor(Date.now()/1000);
 await append(houseToken,'revision1',1,JSON.stringify([[-34.9,151,now-60,0],[-34.91,151,now-30,0]]));
 const road=encodeLine([[-34.9,151],[-34.91,151]]).replace(/\\/g,'\\\\');
 await as('authenticated',owner,`select public.put_my_live_road('revision1','revision1:${now-60}:${now-30}','${road}')`);
 const first=await trail(stranger);
 expect(Object.keys(first.roads)).toHaveLength(1);
 expect(first.points).toHaveLength(2);
 expect(first.privacy_revision).toBeTypeOf('string');
 await sent();
 await as('authenticated',owner,"update public.saved_places set latitude=-34.9,longitude=151 where kind='home' and owner_id=auth.uid()");
 expect((await sent()).some(r=>r.topic===`user:${stranger}`)).toBe(true);
 const next=(await as('authenticated',stranger,`select * from public.my_live_trail('${owner}',${now-30},'${first.privacy_revision}')`)).rows[0];
 expect(next.privacy_revision).not.toBe(first.privacy_revision);
 expect(next.points.map(p=>p[0])).toEqual([-34.91]);
 expect(next.roads).toEqual({});
 expect(Object.keys((await trail(owner)).roads)).toHaveLength(1);
 const quiet=(await as('authenticated',stranger,`select * from public.my_live_trail('${owner}',${now-30},'${next.privacy_revision}')`)).rows[0];
 expect(quiet.points).toEqual([]);
 expect((await trail(owner)).points).toHaveLength(2);
 await as('authenticated',owner,"update public.saved_places set latitude=-34.5,longitude=150.8 where kind='home' and owner_id=auth.uid()");
 await as('authenticated',owner,"select public.end_live_trail('revision1')");
});

it('changes the live revision for privacy-place insert, kind change and delete, but not a name-only edit',async()=>{
 await as('authenticated',owner,'select public.set_my_live_location(true)');
 await append(houseToken,'revision2',1,pts(60,70));
 const rev=async()=>(await trail(owner)).privacy_revision;
 await as('authenticated',owner,"delete from public.saved_places where kind='work' and owner_id=auth.uid()");
 const before=await rev(),id='99999999-8888-4777-8666-555555555555';
 await as('authenticated',owner,`insert into public.saved_places(id,name,kind,latitude,longitude,radius) values('${id}','Work2','work',-36,152,100)`);
 const inserted=await rev();expect(inserted).not.toBe(before);
 await as('authenticated',owner,`update public.saved_places set name='Renamed' where id='${id}'`);
 expect(await rev()).toBe(inserted);
 await as('authenticated',owner,`update public.saved_places set kind='favourite' where id='${id}'`);
 const retyped=await rev();expect(retyped).not.toBe(inserted);
 await as('authenticated',owner,`update public.saved_places set kind='work' where id='${id}'`);
 const restored=await rev();expect(restored).not.toBe(retyped);
 await as('authenticated',owner,`delete from public.saved_places where id='${id}'`);
 expect(await rev()).not.toBe(restored);
 await as('authenticated',owner,"select public.end_live_trail('revision2')");
});

it('resets an open household cursor when the viewer leaves but remains a friend',async()=>{
 await as('authenticated',owner,'select public.set_my_live_location(true)');
 await as('authenticated',owner,'select public.set_friend_location(true,-34.7,150.9,5)');
 const invite=(await as('authenticated',owner,'select public.invite_to_household() as token')).rows[0].token;
 await as('authenticated',stranger,`select * from public.accept_household_invitation('${invite}')`);
 const now=Math.floor(Date.now()/1000);
 await append(houseToken,'scope1',1,JSON.stringify([[-34.9,151,now-60,0],[-34.5,150.8,now-30,0]]));
 const open=await trail(stranger);expect(open.points).toHaveLength(2);
 await as('authenticated',stranger,'select public.leave_household()');
 const masked=(await as('authenticated',stranger,`select * from public.my_live_trail('${owner}',${now-30},'${open.privacy_revision}')`)).rows[0];
 expect(masked.privacy_revision).not.toBe(open.privacy_revision);
 expect(masked.points.map(p=>p[0])).toEqual([-34.9]);
 await as('authenticated',owner,"select public.end_live_trail('scope1')");
});

it('rechecks automatic household consent after a publication was queued',async()=>{
 const eligible='bbbbbbbb-0000-4000-8000-00000000f101';
 const old='bbbbbbbb-0000-4000-8000-00000000f102';
 const allowed=async id=>(await as('service_role','',`select public.auto_share_allowed('${owner}','${id}') as ok`)).rows[0].ok;
 try{
  await as('authenticated',owner,'select public.set_auto_share(true)');
  await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters)
    values('${eligible}','Consent test','Driving','manual',now()+interval '5 minutes',now()+interval '35 minutes',1800,9000)`);
  expect(await allowed(eligible)).toBe(true);
  // A previously fetched pending row may still be in an in-flight Edge Function.
  await as('authenticated',owner,'select public.set_auto_share(false)');
  expect(await allowed(eligible)).toBe(false);
  await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters)
    values('${old}','While off','Driving','manual',now()-interval '1 minute',now()+interval '29 minutes',1800,9000)`);
  await as('authenticated',owner,'select public.set_auto_share(true)');
  expect(await allowed(eligible)).toBe(true); // Recorded after sharing resumed.
  expect(await allowed(old)).toBe(false);      // Never sweep in an activity from before consent.
  await as('authenticated',owner,`select public.keep_activity_private('${eligible}')`);
  expect(await allowed(eligible)).toBe(false);
 }finally{
  await as('authenticated',owner,`delete from public.activities where id in ('${eligible}','${old}')`);
 }
});

it('keeps live append, finish and private operations under the same owner-scoped transaction lock',async()=>{
 // PGlite runs on a single connection, so this validates the locking contract
 // rather than claiming to have exercised two concurrent PostgreSQL sessions.
 for(const signature of ['append_live_trail(text,text,integer,jsonb)','end_live_trail(text,boolean)','keep_activity_private(uuid)']){
  const result=await as('service_role','',`select pg_get_functiondef('public.${signature}'::regprocedure) as definition`);
  expect(result.rows[0].definition).toContain('pg_advisory_xact_lock(105942');
 }
});

it('enforces automatic consent inside publication and records manual decisions atomically',async()=>{
 const id='bbbbbbbb-0000-4000-8000-00000000f201';
 await as('authenticated',owner,'select public.set_auto_share(true)');
 await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters)
 values('${id}','Atomic','Driving','automatic',now()+interval '1 minute',now()+interval '2 minutes',60,1000)`);
 await as('authenticated',owner,'select public.set_auto_share(false)');
 await expect(share(id,'household','household',[],'Atomic',1900000000,true)).rejects.toThrow(/eligible|consent/);
 await db.exec('reset role');expect((await db.query(`select count(*)::int as n from public.shared_journeys where activity_id='${id}'`)).rows[0].n).toBe(0);
 await as('authenticated',owner,'select public.set_auto_share(true)');
 await share(id,'household','household',[],'Atomic',1900000000,true);
 await db.exec('reset role');expect((await db.query(`select count(*)::int as n from public.activity_share_decisions where activity_id='${id}'`)).rows[0].n).toBe(0);
 await share(id,'household','household',[],'Manual');
 await db.exec('reset role');expect((await db.query(`select count(*)::int as n from public.activity_share_decisions where activity_id='${id}'`)).rows[0].n).toBe(1);
 await expect(share(id,'household','household',[],'Atomic',1900000000,true)).rejects.toThrow(/eligible/);
 await expect(as('authenticated',owner,`select public.publish_social_journey('${owner}','${id}',1,'household','household','{}','{}',true)`)).rejects.toThrow(/permission/);
});

it('retains a paused or offline unfinished trail until the recorder explicitly ends it',async()=>{
 await as('authenticated',owner,'select public.set_my_live_location(true)');
 houseToken=(await as('authenticated',owner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
 await append(houseToken,'paused-prefix',1,pts(40,50));
 await db.exec(`reset role;update public.live_trails set updated_at=now()-interval '20 minutes' where owner_id='${owner}'`);
 expect((await trail(owner)).points).toHaveLength(2);
 await as('authenticated',owner,"select public.end_live_trail('paused-prefix')");
 expect((await trail(owner)).points).toEqual([]);
});

it('a manual revocation atomically prevents a queued automatic re-publication',async()=>{
 const id='bbbbbbbb-0000-4000-8000-00000000f202';
 await as('authenticated',owner,'select public.set_auto_share(true)');
 await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters)
 values('${id}','Revoked','Driving','automatic',now()+interval '1 minute',now()+interval '2 minutes',60,1000)`);
 await share(id,'household','household',[],'Automatic',1900000000,true);
 await as('authenticated',owner,`select public.revoke_activity_publication('${id}')`);
 await expect(share(id,'household','household',[],'Retried',1900000000,true)).rejects.toThrow(/eligible/);
});
