import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {beforeAll,afterAll,beforeEach,expect,it} from 'vitest';

// Time at a place: when a household member arrived where they are now, derived
// only from positions they already share, and only when it was actually observed.
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',partner='22222222-2222-4222-8222-222222222222',stranger='33333333-3333-4333-8333-333333333333';
async function as(role,user,sql){
 await db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${user||''}',false);select set_config('request.jwt.claims','{}',false);`);
 return db.query(sql);
}
async function admin(sql){await db.exec('reset role;');return db.query(sql);}
const anna=async(viewer=owner)=>(await as('authenticated',viewer,'select * from public.my_household_location_status()')).rows.find(r=>r.user_id===partner);
const minutesBefore=(row,at)=>Math.round((new Date(row.server_now)-new Date(at))/60000);
// One position from Anna's phone, `ago` minutes before now. Same path as both publishers: an update of her row.
const fix=(latitude,longitude,ago,{accuracy=10,speed=0}={})=>admin(`update public.household_live_locations set latitude=${latitude},longitude=${longitude},
 accuracy_m=${accuracy},speed_kmh=${speed},location_at=now()-interval '${ago} minutes',updated_at=now() where user_id='${partner}'`);
const HOME=[-33.8700,151.2100],SCHOOL=[-33.8900,151.2300],GYM=[-33.8500,151.1900];
// North of a point by `metres`.
const north=([latitude,longitude],metres)=>[latitude+metres/111195,longitude];
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 insert into auth.users(id,raw_user_meta_data) values('${owner}','{"display_name":"Julius"}'),('${partner}','{"display_name":"Anna"}'),('${stranger}','{}');
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
beforeEach(async()=>{
 await db.exec(`reset role;delete from public.household_live_locations;delete from public.household_memberships;delete from public.household_invitations;delete from public.households;`);
 await as('authenticated',owner,"select * from public.create_household('Pollak')");
 const invite=(await as('authenticated',owner,'select public.invite_to_household() as code')).rows[0].code;
 await as('authenticated',partner,`select * from public.accept_household_invitation('${invite}')`);
 await admin(`update public.household_memberships set joined_at=now()-interval '2 days'`);
 // Sharing on, no position yet.
 await as('authenticated',partner,'select public.set_my_live_location(true)');
});
// Anna drives from school and arrives home 125 minutes ago; her phone confirms every 10 minutes.
async function arriveHome(){
 await fix(...SCHOOL,140);await fix(...SCHOOL,135,{speed:30});
 await fix(...HOME,125);
 for(let ago=115;ago>=5;ago-=10)await fix(...HOME,ago);
}

it('reports when a member arrived, and keeps it through repeated location updates',async()=>{
 await arriveHome();
 const row=await anna();
 expect(minutesBefore(row,row.arrived_at)).toBe(125);
 expect(minutesBefore(row,row.location_at)).toBe(5);
 // Twelve more confirmations: the arrival time does not move.
 for(let ago=4;ago>=0;ago-=0.5)await fix(...HOME,ago);
 expect(minutesBefore(await anna(),(await anna()).arrived_at)).toBe(125);
});
it('ignores GPS drift: coarse fixes and short moves inside the place keep the visit',async()=>{
 await arriveHome();
 await fix(...north(HOME,180),4,{accuracy:65}); // Wi-Fi estimate 180 m away, ±65 m
 await fix(...north(HOME,120),3,{accuracy:5});  // the far end of the garden
 await fix(...north(HOME,240),2,{accuracy:100});// resting-mode fix, ±100 m
 await fix(...HOME,1);
 const row=await anna();
 expect(minutesBefore(row,row.arrived_at)).toBe(125);
});
it('resets after a confirmed departure, and shows the new place only once she has stayed five minutes',async()=>{
 await arriveHome();
 await fix(...north(HOME,400),4,{speed:5});
 expect((await anna()).arrived_at).toBeNull();
 await fix(...GYM,3,{speed:25});
 await fix(...north(GYM,30),2);
 expect((await anna()).arrived_at).toBeNull();
 await admin(`update public.household_live_locations set location_at=now()+interval '3 minutes' where user_id='${partner}'`);
 const row=await anna();
 expect(Math.round((new Date(row.location_at)-new Date(row.arrived_at))/60000)).toBe(6);
});
it('never invents an arrival: the first position after enabling sharing is "here since unknown"',async()=>{
 for(let ago=120;ago>=0;ago-=10)await fix(...HOME,ago);
 const row=await anna();
 expect(row.latitude).not.toBeNull();
 expect(row.arrived_at).toBeNull();
});
it('does not merge visits across a silence: after 15 minutes without a position the arrival is unknown for that visit',async()=>{
 await arriveHome();
 await admin(`update public.household_live_locations set location_at=now()-interval '60 minutes' where user_id='${partner}'`);
 // Her phone was silent for 55 minutes, then confirms home again.
 await fix(...HOME,5);
 expect((await anna()).arrived_at).toBeNull();
 for(let ago=4;ago>=0;ago--)await fix(...HOME,ago);
 expect((await anna()).arrived_at).toBeNull();
});
it('withholds the arrival while she is moving inside the place radius',async()=>{
 await arriveHome();
 await fix(...north(HOME,60),1,{speed:35});
 expect((await anna()).arrived_at).toBeNull();
 await fix(...HOME,0);
 expect(minutesBefore(await anna(),(await anna()).arrived_at)).toBe(125);
});
it('clears the visit when sharing is turned off, and starts unknown when it is turned on again',async()=>{
 await arriveHome();
 await as('authenticated',partner,'select public.set_my_live_location(false)');
 expect((await admin(`select place_latitude,place_since,place_known from public.household_live_locations`)).rows[0]).toEqual({place_latitude:null,place_since:null,place_known:false});
 await as('authenticated',partner,`select public.set_my_live_location(true,${HOME[0]},${HOME[1]},10)`);
 await admin(`update public.household_live_locations set location_at=now()+interval '30 minutes' where user_id='${partner}'`);
 expect((await anna()).arrived_at).toBeNull();
});
it('keeps the device credential path and the in-app path on the same rules',async()=>{
 const token=(await as('authenticated',partner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
 await fix(...SCHOOL,20,{speed:30});await fix(...SCHOOL,12,{speed:30});
 // The locked phone publishes its arrival at home with the device credential.
 expect((await as('anon',null,`select public.publish_live_location('${token}',${HOME[0]},${HOME[1]},8) as ok`)).rows[0].ok).toBe(true);
 expect((await anna()).arrived_at).toBeNull();
 // Six minutes later the same position is confirmed again.
 await admin(`update public.household_live_locations set location_at=now()+interval '6 minutes' where user_id='${partner}'`);
 const row=await anna();
 expect(Math.round((new Date(row.location_at)-new Date(row.arrived_at))/60000)).toBe(6);
});
it('gives the arrival only to people already allowed to see the position, and never the private anchor',async()=>{
 await arriveHome();
 expect((await as('authenticated',stranger,'select * from public.my_household_location_status()')).rows).toEqual([]);
 const row=await anna();
 expect(Object.keys(row).filter(k=>k.startsWith('place_'))).toEqual([]);
 await expect(as('authenticated',owner,'select place_latitude from public.household_live_locations')).rejects.toThrow();
 // Coordinates older than 24 hours are withheld, and so is the arrival.
 await admin(`update public.household_live_locations set location_at=now()-interval '25 hours' where user_id='${partner}'`);
 expect(await anna()).toMatchObject({latitude:null,arrived_at:null});
 // An arrival before the viewer joined the household is not shared.
 await arriveHome();
 await admin(`update public.household_memberships set joined_at=now()-interval '60 minutes' where user_id='${owner}'`);
 expect(await anna()).toMatchObject({arrived_at:null});
});
it('tells members their own arrival as the household sees it',async()=>{
 await arriveHome();
 const [mine]=(await as('authenticated',partner,'select * from public.my_live_location_arrival()')).rows;
 expect(minutesBefore(mine,mine.arrived_at)).toBe(125);
 expect((await as('authenticated',owner,'select * from public.my_live_location_arrival()')).rows).toEqual([]);
 await expect(as('anon',null,'select * from public.my_live_location_arrival()')).rejects.toThrow();
});
