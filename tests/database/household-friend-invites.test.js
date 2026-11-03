import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';

// A household is built from friends, and nobody joins without accepting: joining
// shares location, so an invitation is the only way in by name.
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',friend='22222222-2222-4222-8222-222222222222',stranger='33333333-3333-4333-8333-333333333333';
async function as(user,sql,role='authenticated'){
 await db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${user||''}',false);select set_config('request.jwt.claims','{}',false);`);
 return db.query(sql);
}
const members=async()=>{await db.exec('reset role;');return (await db.query('select user_id from public.household_memberships order by user_id')).rows.map(row=>row.user_id);};
const befriend=()=>db.exec(`reset role;insert into public.friend_connections(user_low,user_high) values(least('${owner}'::uuid,'${friend}'::uuid),greatest('${owner}'::uuid,'${friend}'::uuid)) on conflict do nothing;`);
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 insert into auth.users(id,raw_user_meta_data) values('${owner}','{"display_name":"Julius"}'),('${friend}','{"display_name":"Anna"}'),('${stranger}','{"display_name":"Sam"}');
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
 await db.exec(`reset role;delete from public.household_friend_invites;delete from public.household_memberships;delete from public.households;delete from public.friend_connections;`);
 await as(owner,"select * from public.create_household('Pollak')");
});
it('invites a friend without adding them',async()=>{
 await befriend();
 await as(owner,`select public.invite_friend_to_household('${friend}')`);
 expect(await members()).toEqual([owner]);
 expect((await as(friend,'select * from public.my_household_requests()')).rows[0]).toMatchObject({household_name:'Pollak',invited_by_name:'Julius'});
 expect((await as(owner,'select * from public.my_household_friend_invites()')).rows).toEqual([{friend_id:friend}]);
});
it('adds them only when they accept, and removes the request',async()=>{
 await befriend();
 await as(owner,`select public.invite_friend_to_household('${friend}')`);
 const {id}=(await as(friend,'select * from public.my_household_requests()')).rows[0];
 await as(friend,`select public.respond_household_request('${id}',true)`);
 expect(await members()).toEqual([owner,friend]);
 expect((await as(friend,'select * from public.my_household_requests()')).rows).toEqual([]);
});
it('leaves them out when they decline',async()=>{
 await befriend();
 await as(owner,`select public.invite_friend_to_household('${friend}')`);
 const {id}=(await as(friend,'select * from public.my_household_requests()')).rows[0];
 await as(friend,`select public.respond_household_request('${id}',false)`);
 expect(await members()).toEqual([owner]);
});
it('refuses someone who is not a friend',async()=>{
 await expect(as(owner,`select public.invite_friend_to_household('${stranger}')`)).rejects.toThrow('Friends only');
});
it('only lets the organiser invite',async()=>{
 await befriend();
 await expect(as(friend,`select public.invite_friend_to_household('${owner}')`)).rejects.toThrow('Household owner required');
});
it('does not let anyone else answer',async()=>{
 await befriend();
 await as(owner,`select public.invite_friend_to_household('${friend}')`);
 const {id}=(await as(friend,'select * from public.my_household_requests()')).rows[0];
 await expect(as(stranger,`select public.respond_household_request('${id}',true)`)).rejects.toThrow('invalid');
 await expect(as(owner,`select public.respond_household_request('${id}',true)`)).rejects.toThrow('invalid');
 expect(await members()).toEqual([owner]);
});
it('keeps the invitations private from direct reads and from anonymous callers',async()=>{
 await expect(as(friend,'select * from public.household_friend_invites')).rejects.toThrow();
 await expect(as('','select public.my_household_requests()','anon')).rejects.toThrow();
});
