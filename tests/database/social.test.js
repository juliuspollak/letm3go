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
 await as('authenticated',a,`select public.publish_social_journey('${id}',1,'friends','selected',array['${b}']::uuid[],'${snapshot}'::jsonb)`);
 expect((await as('authenticated',b,`select public.read_social_journey('${id}') as shared`)).rows[0].shared.snapshot.title).toBe('Coastal walk');
 expect((await as('authenticated',c,`select public.read_social_journey('${id}') as shared`)).rows[0].shared).toBeNull();
 await expect(as('anon','',`select public.read_social_journey('${id}')`)).rejects.toThrow();
 const changed='{"title":"Changed without recipient approval","activity":"Walking","points":[]}';
 await expect(as('authenticated',a,`select public.publish_social_journey('${id}',1,'friends','selected',array['${c}']::uuid[],'${changed}'::jsonb)`)).rejects.toThrow();
 expect((await as('authenticated',b,`select public.read_social_journey('${id}') as shared`)).rows[0].shared.snapshot.title).toBe('Coastal walk');
 await as('authenticated',a,`select public.remove_friend('${b}')`);
 expect((await as('authenticated',b,`select public.read_social_journey('${id}') as shared`)).rows[0].shared).toBeNull();
 await as('authenticated',a,`select public.revoke_activity_publication('${id}')`);
 expect((await as('authenticated',a,`select public.read_social_journey('${id}') as shared`)).rows[0].shared).toBeNull();
 expect(Number((await as('service_role','',`select count(*)::integer as total from public.social_journey_policies where activity_id='${id}'`)).rows[0].total)).toBe(0);
},30000);
