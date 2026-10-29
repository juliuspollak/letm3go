import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {beforeAll,afterAll,beforeEach,expect,it} from 'vitest';

// Household location sharing, end to end at the database boundary: what a
// household member can publish, and what each other account is allowed to read.
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',partner='22222222-2222-4222-8222-222222222222',stranger='33333333-3333-4333-8333-333333333333';
async function as(role,user,sql){
 await db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${user||''}',false);select set_config('request.jwt.claims','{}',false);`);
 return db.query(sql);
}
async function admin(sql){await db.exec('reset role;');return db.query(sql);}
const status=async(user)=>(await as('authenticated',user,'select * from public.my_household_location_status()')).rows;
const legacy=async(user)=>(await as('authenticated',user,'select * from public.my_household_live_locations()')).rows;
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
 // Membership predates every published position in these scenarios.
 await admin(`update public.household_memberships set joined_at=now()-interval '2 days'`);
});

it('reproduces the build 46 failure: a sharing member vanished 90 seconds after her last publish, and stays visible now',async()=>{
 await as('authenticated',partner,'select public.set_my_live_location(true,-33.87,151.21,12)');
 expect(await legacy(owner)).toHaveLength(1);
 // Her phone is locked at home and has not published for three minutes.
 await admin(`update public.household_live_locations set location_at=now()-interval '3 minutes',expires_at=now()-interval '90 seconds'`);
 expect(await legacy(owner)).toHaveLength(0);
 const [anna]=await status(owner);
 expect(anna).toMatchObject({user_id:partner,display_name:'Anna',sharing_enabled:true,latitude:-33.87,longitude:151.21,accuracy_m:12});
 expect(new Date(anna.server_now)-new Date(anna.location_at)).toBeGreaterThanOrEqual(179000);
});
it('shows both sharing members to each other and never returns the caller',async()=>{
 await as('authenticated',owner,'select public.set_my_live_location(true,-33.8701,151.2101,8)');
 await as('authenticated',partner,'select public.set_my_live_location(true,-33.8702,151.2102,9)');
 expect((await status(owner)).map(r=>[r.user_id,r.latitude])).toEqual([[partner,-33.8702]]);
 expect((await status(partner)).map(r=>[r.user_id,r.latitude])).toEqual([[owner,-33.8701]]);
});
it('reports a member who shares but has no position yet, and a member who does not share, without coordinates',async()=>{
 const [notSharing]=await status(owner);
 expect(notSharing).toMatchObject({sharing_enabled:false,latitude:null,longitude:null,location_at:null});
 await as('authenticated',partner,'select public.set_my_live_location(true)');
 expect(await status(owner)).toEqual([expect.objectContaining({sharing_enabled:true,latitude:null,location_at:null})]);
});
it('withholds coordinates older than 24 hours but keeps the time, so the app can say the location is unavailable',async()=>{
 await as('authenticated',partner,'select public.set_my_live_location(true,-33.87,151.21,12)');
 await admin(`update public.household_live_locations set location_at=now()-interval '25 hours'`);
 const [anna]=await status(owner);
 expect(anna).toMatchObject({sharing_enabled:true,latitude:null,longitude:null,accuracy_m:null});
 expect(anna.location_at).not.toBeNull();
});
it('erases the position and revokes the device credential when sharing is turned off',async()=>{
 await as('authenticated',partner,'select public.set_my_live_location(true,-33.87,151.21,12)');
 const token=(await as('authenticated',partner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
 await as('authenticated',partner,'select public.set_my_live_location(false)');
 expect(await status(owner)).toEqual([expect.objectContaining({sharing_enabled:false,latitude:null,location_at:null})]);
 expect((await as('anon',null,`select public.publish_live_location('${token}',-33.9,151.3,10) as ok`)).rows[0].ok).toBe(false);
 const stored=(await admin('select latitude,publish_token_hash from public.household_live_locations')).rows[0];
 expect(stored).toEqual({latitude:null,publish_token_hash:null});
 // Turning sharing back on never resurrects the erased position.
 await as('authenticated',partner,'select public.set_my_live_location(true)');
 expect((await status(owner))[0]).toMatchObject({sharing_enabled:true,latitude:null,location_at:null});
});
it('lets a backgrounded phone publish only its own position with its device credential',async()=>{
 await expect(as('authenticated',partner,'select * from public.issue_my_live_location_token()')).rejects.toThrow(/Turn on location sharing/);
 await as('authenticated',partner,'select public.set_my_live_location(true,-33.87,151.21,12)');
 const token=(await as('authenticated',partner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
 expect(token).toMatch(/^[0-9a-f]{64}$/);
 expect((await as('anon',null,`select public.publish_live_location('${token}',-33.88,151.22,7,40) as ok`)).rows[0].ok).toBe(true);
 expect((await status(owner))[0]).toMatchObject({latitude:-33.88,longitude:151.22,accuracy_m:7,speed_kmh:40});
 expect((await as('anon',null,`select public.publish_live_location('${'0'.repeat(64)}',-1,1,5) as ok`)).rows[0].ok).toBe(false);
 // Only the hash is stored, and a new credential replaces the old one.
 expect((await admin(`select count(*)::int as n from public.household_live_locations where publish_token_hash=sha256(convert_to('${token}','UTF8'))`)).rows[0].n).toBe(1);
 await as('authenticated',partner,'select * from public.issue_my_live_location_token()');
 expect((await as('anon',null,`select public.publish_live_location('${token}',-33.89,151.23,7) as ok`)).rows[0].ok).toBe(false);
 await expect(as('anon',null,`select public.publish_live_location('${token}',95,151,7)`)).rejects.toThrow(/Invalid location/);
});
it('denies coordinates to an account outside the household, and the table to everyone',async()=>{
 await as('authenticated',partner,'select public.set_my_live_location(true,-33.87,151.21,12)');
 expect(await status(stranger)).toHaveLength(0);
 expect(await legacy(stranger)).toHaveLength(0);
 await expect(as('authenticated',stranger,'select * from public.household_live_locations')).rejects.toThrow();
 await expect(as('authenticated',owner,'select * from public.household_live_locations')).rejects.toThrow();
 await expect(as('anon',null,'select * from public.my_household_location_status()')).rejects.toThrow();
 await expect(as('anon',null,'select * from public.issue_my_live_location_token()')).rejects.toThrow();
});
it('revokes access immediately when a member leaves, ends their sharing and their credential',async()=>{
 await as('authenticated',partner,'select public.set_my_live_location(true,-33.87,151.21,12)');
 const token=(await as('authenticated',partner,'select * from public.issue_my_live_location_token()')).rows[0].publish_token;
 await as('authenticated',partner,'select public.leave_household()');
 expect(await status(owner)).toHaveLength(0);
 expect(await status(partner)).toHaveLength(0);
 expect((await as('anon',null,`select public.publish_live_location('${token}',-33.9,151.3,10) as ok`)).rows[0].ok).toBe(false);
 // Consent given to one household never carries over to the next one.
 const invite=(await as('authenticated',owner,'select public.invite_to_household() as code')).rows[0].code;
 await as('authenticated',partner,`select * from public.accept_household_invitation('${invite}')`);
 expect(await status(owner)).toEqual([expect.objectContaining({sharing_enabled:false,latitude:null})]);
});
it('never shows a position captured before both people were in the household',async()=>{
 await as('authenticated',partner,'select public.set_my_live_location(true,-33.87,151.21,12)');
 await admin(`update public.household_memberships set joined_at=now()+interval '1 minute' where user_id='${owner}'`);
 expect(await status(owner)).toEqual([expect.objectContaining({sharing_enabled:true,latitude:null,location_at:null})]);
});
