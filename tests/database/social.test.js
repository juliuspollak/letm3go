import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {beforeAll,afterAll,expect,it} from 'vitest';
const db=new PGlite();
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333';
async function as(role,user,sql){
 await db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claims','{}',false);`);
 return db.query(sql);
}
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 insert into auth.users(id) values('${a}'),('${b}'),('${c}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 grant usage on schema auth to anon,authenticated,service_role;
 grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
 for(const filename of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())
  await db.exec(await readFile('supabase/migrations/'+filename,'utf8'));
},60000);
afterAll(()=>db.close());
it('never leaks friend locations or published trips to strangers and revokes friendship access',async()=>{
 await as('authenticated',a,`select public.set_friend_location(true,-34.59,150.87,10)`);
 await as('authenticated',a,`select public.publish_friend_trip('trip-a','Coastal walk','Hiking',now(),2.5)`);
 expect((await as('authenticated',b,'select * from public.my_friend_locations()')).rows).toHaveLength(0);
 expect((await as('authenticated',b,'select * from public.my_friend_trip_feed()')).rows).toHaveLength(0);
 await expect(as('authenticated',b,'select * from public.friend_presence_shares')).rejects.toThrow();
 await expect(as('authenticated',b,'select * from public.friend_shared_trips')).rejects.toThrow();
 const invite=(await as('authenticated',a,'select public.create_friend_invite() as code')).rows[0].code;
 await as('authenticated',b,`select public.accept_friend_invite('${invite}')`);
 expect((await as('authenticated',b,'select * from public.my_friend_locations()')).rows).toHaveLength(1);
 expect((await as('authenticated',b,'select * from public.my_friend_trip_feed()')).rows).toHaveLength(1);
 await as('authenticated',a,`select public.remove_friend('${b}')`);
 expect((await as('authenticated',b,'select * from public.my_friend_locations()')).rows).toHaveLength(0);
 expect((await as('authenticated',b,'select * from public.my_friend_trip_feed()')).rows).toHaveLength(0);
},30000);
it('scopes linked-vehicle trip summaries to current household membership',async()=>{
 await as('authenticated',a,"select * from public.create_household('Family')");
 const invite=(await as('authenticated',a,'select public.invite_to_household() as code')).rows[0].code;
 await as('authenticated',b,`select * from public.accept_household_invitation('${invite}')`);
 const car=(await as('authenticated',a,"select public.add_household_vehicle('Family car') as id")).rows[0].id;
 const local='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 await as('authenticated',a,`select public.link_household_vehicle('${car}','${local}')`);
 await as('authenticated',a,'select public.set_household_trip_sharing(true)');
 await expect(as('authenticated',c,`select public.publish_household_vehicle_trip('${car}','${local}','trip-c','Spoofed',now(),1)`)).rejects.toThrow();
 await as('authenticated',a,`select public.publish_household_vehicle_trip('${car}','${local}','drive-a','Drive to beach',now(),8.2)`);
 expect((await as('authenticated',b,'select * from public.my_household_vehicle_trip_feed()')).rows).toHaveLength(1);
 expect((await as('authenticated',c,'select * from public.my_household_vehicle_trip_feed()')).rows).toHaveLength(0);
 await expect(as('authenticated',b,'select * from public.household_vehicle_trips')).rejects.toThrow();
 await as('authenticated',a,'select public.set_household_trip_sharing(false)');
 expect((await as('authenticated',b,'select * from public.my_household_vehicle_trip_feed()')).rows).toHaveLength(0);
 await as('authenticated',b,'select public.leave_household()');
 expect((await as('authenticated',b,'select * from public.my_household_vehicle_trip_feed()')).rows).toHaveLength(0);
},30000);

it('shares full snapshots only with current, selected friends and revokes atomically',async()=>{
 const id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 await as('authenticated',a,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters)
 values('${id}','Coastal walk','Walking','manual',now(),now(),1800,2500)`);
 const invite=(await as('authenticated',a,'select public.create_friend_invite() as code')).rows[0].code;
 await as('authenticated',b,`select public.accept_friend_invite('${invite}')`);
 await expect(as('authenticated',b,`select * from public.shared_journeys`)).rejects.toThrow();
 const snapshot='{"title":"Coastal walk","activity":"Walking","points":[],"photos":[]}';
 // A client cannot publish its own snapshot: only the Edge Function (service role) may.
 await expect(as('authenticated',a,`select public.publish_social_journey('${a}','${id}',1,'friends','selected',array['${b}']::uuid[],'${snapshot}'::jsonb)`)).rejects.toThrow();
 await as('service_role','',`select public.publish_social_journey('${a}','${id}',1,'friends','selected',array['${b}']::uuid[],'${snapshot}'::jsonb)`);
 expect((await as('authenticated',b,`select public.read_social_journey('${id}') as shared`)).rows[0].shared.snapshot.title).toBe('Coastal walk');
 expect((await as('authenticated',c,`select public.read_social_journey('${id}') as shared`)).rows[0].shared).toBeNull();
 await expect(as('anon','',`select public.read_social_journey('${id}')`)).rejects.toThrow();
 const changed='{"title":"Changed without recipient approval","activity":"Walking","points":[]}';
 await expect(as('service_role','',`select public.publish_social_journey('${a}','${id}',1,'friends','selected',array['${c}']::uuid[],'${changed}'::jsonb)`)).rejects.toThrow();
 expect((await as('authenticated',b,`select public.read_social_journey('${id}') as shared`)).rows[0].shared.snapshot.title).toBe('Coastal walk');
 await as('authenticated',a,`select public.remove_friend('${b}')`);
 expect((await as('authenticated',b,`select public.read_social_journey('${id}') as shared`)).rows[0].shared).toBeNull();
 await as('authenticated',a,`select public.revoke_activity_publication('${id}')`);
 expect((await as('authenticated',a,`select public.read_social_journey('${id}') as shared`)).rows[0].shared).toBeNull();
 expect(Number((await as('service_role','',`select count(*)::integer as total from public.social_journey_policies where activity_id='${id}'`)).rows[0].total)).toBe(0);
},30000);
it('publishes friend location with a revocable device credential that keeps the capture time',async()=>{
 const invite=(await as('authenticated',a,'select public.create_friend_invite() as code')).rows[0].code;
 await as('authenticated',c,`select public.accept_friend_invite('${invite}')`);
 await as('authenticated',a,`select public.set_friend_location(true,-34.59,150.87,10)`);
 await db.exec("reset role;update public.friend_presence_shares set updated_at=now()-interval '6 hours' where user_id='"+a+"'");
 const token=(await as('authenticated',a,'select * from public.issue_my_friend_location_token()')).rows[0].publish_token;
 expect(token).toHaveLength(64);
 const publish=(at,lat=-34.6)=>as('anon',a,`select public.publish_friend_location('${token}',${lat},150.9,12,${at}) as ok`).then(r=>r.rows[0].ok);
 expect(await publish("now()-interval '3 hours'")).toBe(true);
 const seen=async()=>(await as('authenticated',c,'select * from public.my_friend_locations()')).rows;
 // A three hour old position is still shown, with its real age.
 expect((await seen())[0].latitude).toBeCloseTo(-34.6);
 expect(Date.now()-new Date((await seen())[0].updated_at).getTime()).toBeGreaterThan(2.9*3600*1000);
 // An older position never replaces a newer one; a future capture time is clamped.
 expect(await publish("now()-interval '5 hours'",-35)).toBe(true);
 expect((await seen())[0].latitude).toBeCloseTo(-34.6);
 expect(await publish("now()+interval '1 day'",-36)).toBe(true);
 expect(new Date((await seen())[0].updated_at).getTime()).toBeLessThanOrEqual(Date.now()+1000);
 expect(await as('anon',a,`select public.publish_friend_location('${'f'.repeat(64)}',-34,150,10,null) as ok`).then(r=>r.rows[0].ok)).toBe(false);
 // Past the 24 hour window nothing is shown.
 await db.exec("reset role;update public.friend_presence_shares set updated_at=now()-interval '25 hours' where user_id='"+a+"'");
 expect(await seen()).toHaveLength(0);
 // Turning sharing off revokes the credential.
 await as('authenticated',a,'select public.set_friend_location(false)');
 expect(await publish('null')).toBe(false);
 await as('authenticated',a,`select public.set_friend_location(true,-34.59,150.87,10)`);
 expect(await publish('null')).toBe(false);
},30000);
it('wakes only active sharers with a stale position and a signed-in device, once per interval',async()=>{
 const sess=(await db.query("select gen_random_uuid() as id")).rows[0].id;
 await db.exec(`reset role;
  insert into auth.sessions(id,user_id) values('${sess}','${a}');
  insert into public.push_devices(installation_id,owner_id,session_id,apns_token,environment) values(gen_random_uuid(),'${a}','${sess}','${'c'.repeat(64)}','production');
  update public.friend_presence_shares set enabled=true,updated_at=now()-interval '30 minutes' where user_id='${a}';`);
 const claim=async()=>(await db.query('select * from public.claim_location_checkins()')).rows;
 await db.exec('reset role;set role service_role');
 expect(await claim()).toEqual([expect.objectContaining({owner_id:a,apns_token:'c'.repeat(64),environment:'production'})]);
 // The claim is remembered: nothing is sent again within the interval.
 expect(await claim()).toHaveLength(0);
 await db.exec("reset role;update public.location_checkins set last_sent_at=now()-interval '20 minutes';update public.friend_presence_shares set updated_at=now()-interval '5 minutes' where user_id='"+a+"'");
 await db.exec('set role service_role');
 expect(await claim()).toHaveLength(0);
 // A position older than a week belongs to an abandoned phone.
 await db.exec("reset role;update public.friend_presence_shares set updated_at=now()-interval '8 days' where user_id='"+a+"'");
 await db.exec('set role service_role');
 expect(await claim()).toHaveLength(0);
 // Sharing off: never woken. Clients cannot call the claim at all.
 await db.exec("reset role;update public.friend_presence_shares set enabled=false,updated_at=now()-interval '30 minutes' where user_id='"+a+"'");
 await db.exec('set role service_role');
 expect(await claim()).toHaveLength(0);
 await expect(as('authenticated',a,'select * from public.claim_location_checkins()')).rejects.toThrow();
},30000);
it('shows the resting place name only with the position it was published with',async()=>{
 await as('authenticated',a,`select public.set_friend_location(true,-34.59,150.87,10)`);
 const token=(await as('authenticated',a,'select * from public.issue_my_friend_location_token()')).rows[0].publish_token;
 const publish=(extra,at)=>as('anon',a,`select public.publish_friend_location('${token}',-34.6,150.9,12,${at},${extra}) as ok`);
 const seen=async()=>(await as('authenticated',c,'select * from public.my_friend_locations()')).rows[0];
 await db.exec("reset role;update public.friend_presence_shares set updated_at=now()-interval '5 hours' where user_id='"+a+"'");
 await publish("'  School  ',now()-interval '4 hours'","now()-interval '1 hour'");
 expect(await seen()).toMatchObject({place_name:'School'});
 expect(Date.now()-new Date((await seen()).place_since).getTime()).toBeGreaterThan(3.9*3600*1000);
 // The next position without a label (she moved) clears it.
 await publish('null,null','now()');
 expect((await seen()).place_name).toBeNull();
 // PGlite's wall clock can return the same millisecond for adjacent calls.
 // The publisher correctly ignores equal capture times, so make the prior fix older.
 await db.exec("reset role;update public.friend_presence_shares set updated_at=now()-interval '1 second' where user_id='"+a+"'");
 await publish("'School',null",'now()+interval \'1 minute\'');
 expect((await seen()).place_name).toBe('School');
 // The foreground app also reports every 30 s without a label: the same stay keeps it.
 await publish("'School',null",'now()+interval \'2 minutes\'');
 await as('authenticated',a,`select public.set_friend_location(true,-34.6003,150.9002,10)`);
 expect((await seen()).place_name).toBe('School');
 // A session-path position from somewhere else clears it.
 await as('authenticated',a,`select public.set_friend_location(true,-34.59,150.87,10)`);
 expect((await seen()).place_name).toBeNull();
 // A future "since" is clamped to the capture time.
 await db.exec("reset role;update public.friend_presence_shares set updated_at=now()-interval '1 second' where user_id='"+a+"'");
 await publish("'Home',now()+interval '1 day'",'now()+interval \'1 minute\'');
 expect(new Date((await seen()).place_since).getTime()).toBeLessThanOrEqual(Date.now()+1000);
},30000);
