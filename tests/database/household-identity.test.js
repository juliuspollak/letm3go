import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {beforeAll,afterAll,beforeEach,expect,it} from 'vitest';

// The family map and the Household list must name each person the same way, from
// the same sources the app writes, and only for people in the caller's household.
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',partner='22222222-2222-4222-8222-222222222222',stranger='33333333-3333-4333-8333-333333333333';
async function as(role,user,sql){
 await db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${user||''}',false);select set_config('request.jwt.claims','{}',false);`);
 return db.query(sql);
}
async function admin(sql){await db.exec('reset role;');return db.query(sql);}
const mapNames=async user=>(await as('authenticated',user,'select user_id,display_name from public.my_household_location_status()')).rows;
const listNames=async user=>(await as('authenticated',user,'select user_id,display_name from public.household_members()')).rows;
beforeAll(async()=>{
 // Partner's name exists only where the app writes it at onboarding, the case
 // that reached the map as "Family member" (drawn as "F").
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 insert into auth.users(id,raw_user_meta_data) values('${owner}','{"full_name":"Julius Pollak"}'),('${partner}','{"letm3go_onboarding_v1":{"step":5,"complete":true,"display_name":"Anna"}}'),('${stranger}','{"display_name":"Stranger"}');
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
 await db.exec(`reset role;delete from public.profiles;delete from public.household_live_locations;delete from public.household_memberships;delete from public.household_invitations;delete from public.households;`);
 await as('authenticated',owner,"select * from public.create_household('Pollak')");
 const invite=(await as('authenticated',owner,'select public.invite_to_household() as code')).rows[0].code;
 await as('authenticated',partner,`select * from public.accept_household_invitation('${invite}')`);
});

it('names a member from her onboarding name on the map, never the "Family member" placeholder',async()=>{
 expect(await mapNames(owner)).toEqual([{user_id:partner,display_name:'Anna'}]);
 expect(await mapNames(partner)).toEqual([{user_id:owner,display_name:'Julius Pollak'}]);
});
it('gives the map and the Household list the same name for every member',async()=>{
 const list=Object.fromEntries((await listNames(owner)).map(r=>[r.user_id,r.display_name]));
 for(const row of await mapNames(owner))expect(row.display_name).toBe(list[row.user_id]);
});
it('prefers the profile name the person chose in Account settings, everywhere',async()=>{
 await admin(`insert into public.profiles(id,display_name) values('${partner}','Anna P')`);
 expect((await mapNames(owner))[0].display_name).toBe('Anna P');
 expect((await listNames(owner)).find(r=>r.user_id===partner).display_name).toBe('Anna P');
});
it('returns an empty name, not an invented one, when a member has none',async()=>{
 await admin(`update auth.users set raw_user_meta_data='{}' where id='${partner}'`);
 expect((await mapNames(owner))[0].display_name).toBe('');
 await admin(`update auth.users set raw_user_meta_data='{"letm3go_onboarding_v1":{"display_name":"Anna"}}' where id='${partner}'`);
});
it('never reveals names outside the household, and the resolver is not callable directly',async()=>{
 expect(await mapNames(stranger)).toEqual([]);
 expect(await listNames(stranger)).toEqual([]);
 await expect(as('authenticated',stranger,`select public.person_display_name('${partner}')`)).rejects.toThrow(/permission denied/);
 await expect(as('anon',null,`select public.person_display_name('${partner}')`)).rejects.toThrow(/permission denied/);
});
