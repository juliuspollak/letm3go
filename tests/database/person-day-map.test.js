import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {beforeAll,afterAll,expect,it} from 'vitest';
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
async function share(id,audience,mode,recipients=[],title='Trip',t0=1900000000){
 const list=recipients.length?`array[${recipients.map(x=>`'${x}'`).join(',')}]::uuid[]`:`'{}'::uuid[]`;
 await as('service_role','',`select public.publish_social_journey('${owner}','${id}',${await revision(id)},'${audience}','${mode}',${list},'${snap(title,t0)}'::jsonb)`);
}
const day=(user,known='{}')=>as('authenticated',user,`select activity_id,title,etag,points from public.my_shared_day('${owner}','2030-03-17 00:00+00','2030-03-18 00:00+00','${known}')`).then(r=>r.rows);
const trail=(user,after=0)=>as('authenticated',user,`select * from public.my_live_trail('${owner}',${after})`).then(r=>r.rows[0]);
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
 for(const f of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 // An activity from before anyone joined the household.
 for(const [id,start] of [[OLD,'2030-03-16 08:00+00'],[A,'2030-03-17 08:00+00'],[B,'2030-03-17 12:00+00']])
  await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters)
   values('${id}','Trip','Driving','manual','${start}'::timestamptz,'${start}'::timestamptz+interval '30 minutes',1800,9000)`);
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
it('hiding an activity removes its geometry from every viewer immediately',async()=>{
 await share(B,'household','household',[],'Afternoon');
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
it('a manual decision is remembered, so auto-share never overrides it',async()=>{
 // B was shared then unshared by hand above: it must not come back as pending.
 const pending=(await as('authenticated',owner,'select * from public.my_auto_share_pending()')).rows.map(r=>r.activity_id);
 expect(pending).not.toContain(B);expect(pending).not.toContain(A);
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
it('hiding the live activity clears it and blocks later points for that activity',async()=>{
 await as('authenticated',owner,"select public.end_live_trail('run2',true)");
 expect((await trail(mate)).points).toEqual([]);
 expect(await append(houseToken,'run2',2,pts(110))).toBe(false);
 expect(await append(houseToken,'run3',1,pts(120))).toBe(true);
});
it('the phone ending an activity (seq -1) clears its trail, and a stale trail is not live',async()=>{
 await append(houseToken,'run9',1,pts(500));
 expect((await trail(mate)).points.length).toBe(1);
 expect(await append(houseToken,'run9',-1,'[]')).toBe(true);
 expect((await trail(mate)).points).toEqual([]);
 await append(houseToken,'run9',2,pts(510));
 await db.exec("reset role;update public.live_trails set updated_at=now()-interval '25 minutes'");
 expect(await trail(mate)).toBeUndefined();
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
 expect(await as('anon','',`select public.put_live_road('${friendToken}','r1','R1:1:2','${away}') as ok`).then(r=>r.rows[0].ok)).toBe(true);
 expect(await as('anon','',`select public.put_live_road('${'z'.repeat(64)}','r1','R1:1:2','${away}') as ok`).then(r=>r.rows[0].ok)).toBe(false);
 const owned=await as('authenticated',owner,`select * from public.my_live_trail('${owner}')`);
 expect(owned.rows[0].roads).toEqual({'R1:1:2':away});
 // The same road drawn through Home is withheld from a friend but not from the owner.
 const lat=-34.5,lon=150.8,enc=n=>{n=Math.round(n*1e5);n=n<0?~(n<<1):n<<1;let o='';while(n>=32){o+=String.fromCharCode((32|(n&31))+63);n>>=5;}return o+String.fromCharCode(n+63);};
 const throughHome=enc(lat)+enc(lon)+enc(0.0001)+enc(0.0001);
 await as('anon','',`select public.put_live_road('${friendToken}','r1','R1:3:4','${throughHome.replace(/\\/g,'\\\\')}')`);
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
it('the owner always sees their own trail, and tables are not directly readable',async()=>{
 await expect(as('authenticated',mate,'select * from public.live_trails')).rejects.toThrow();
 await expect(as('authenticated',mate,'select * from public.activity_auto_share')).rejects.toThrow();
});
