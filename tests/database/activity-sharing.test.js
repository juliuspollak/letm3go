import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {beforeAll,afterAll,expect,it} from 'vitest';
// Sharing an activity from its Share sheet (20261119000000): household, chosen
// friends or both; updating and stopping; access follows the recorded reason.
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',both='22222222-2222-4222-8222-222222222222',friend='33333333-3333-4333-8333-333333333333',member='44444444-4444-4444-8444-444444444444',late='55555555-5555-4555-8555-555555555555';
const trip='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
async function as(role,user,sql){
 await db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claims','{}',false);`);
 return db.query(sql);
}
const snapshot='{"title":"Coastal walk","activity":"Walking","points":[],"photos":[]}';
const revision=async()=>(await as('authenticated',owner,`select revision from public.activities where id='${trip}'`)).rows[0].revision;
// What the journeys Edge Function does: one service-role call with the verified owner.
async function share(audience,mode,recipients=[]){
 const list=recipients.length?`array[${recipients.map(id=>`'${id}'`).join(',')}]::uuid[]`:`'{}'::uuid[]`;
 await as('service_role','',`select public.publish_social_journey('${owner}','${trip}',${await revision()},'${audience}','${mode}',${list},'${snapshot}'::jsonb)`);
}
const sees=async user=>Boolean((await as('authenticated',user,`select public.read_social_journey('${trip}') as shared`)).rows[0].shared);
const current=async()=>(await as('authenticated',owner,`select public.my_activity_sharing('${trip}') as s`)).rows[0].s;
async function befriend(other){
 const code=(await as('authenticated',owner,'select public.create_friend_invite() as code')).rows[0].code;
 await as('authenticated',other,`select public.accept_friend_invite('${code}')`);
}
async function joinHousehold(other){
 const token=(await as('authenticated',owner,'select public.invite_to_household() as token')).rows[0].token;
 await as('authenticated',other,`select * from public.accept_household_invitation('${token}')`);
}
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 insert into auth.users(id) values('${owner}'),('${both}'),('${friend}'),('${member}'),('${late}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 grant usage on schema auth to anon,authenticated,service_role;
 grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
 for(const filename of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())
  await db.exec(await readFile('supabase/migrations/'+filename,'utf8'));
 await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters)
  values('${trip}','Coastal walk','Walking','manual',now(),now(),1800,2500)`);
 await as('authenticated',owner,"select * from public.create_household('Family')");
 await befriend(both);await befriend(friend);
 await joinHousehold(both);await joinHousehold(member);
},90000);
afterAll(()=>db.close());

it('a never-shared activity opens with nothing selected, and nobody can see it',async()=>{
 expect(await current()).toEqual({audience:'private',household:false,friends:[]});
 for(const user of [both,friend,member])expect(await sees(user)).toBe(false);
 await expect(as('authenticated',friend,`select public.my_activity_sharing('${trip}') as s`)).resolves.toMatchObject({rows:[{s:{audience:'private'}}]});
});
it('shares with one friend, then several, and the sheet reads the selection back',async()=>{
 await share('friends','selected',[friend]);
 expect(await current()).toEqual({audience:'friends',household:false,friends:[friend]});
 expect(await sees(friend)).toBe(true);expect(await sees(both)).toBe(false);expect(await sees(member)).toBe(false);
 await share('friends','selected',[friend,both]);
 expect((await current()).friends.sort()).toEqual([both,friend].sort());
 expect(await sees(both)).toBe(true);
});
it('household only: members see it, a friend who is not in the household does not',async()=>{
 await share('household','household');
 expect(await current()).toEqual({audience:'household',household:true,friends:[]});
 expect(await sees(member)).toBe(true);expect(await sees(both)).toBe(true);expect(await sees(friend)).toBe(false);
});
it('household and selected friends together; removing a friend revokes them at once',async()=>{
 await share('friends','mixed',[friend]);
 expect(await current()).toEqual({audience:'friends',household:true,friends:[friend]});
 expect(await sees(member)).toBe(true);expect(await sees(friend)).toBe(true);
 await share('friends','mixed',[both]);
 expect(await sees(friend)).toBe(false);expect(await sees(both)).toBe(true);
});
it('someone shared with through the household loses it on leaving, even if they are a friend',async()=>{
 await share('household','household');
 expect(await sees(both)).toBe(true);
 await as('authenticated',both,'select public.leave_household()');
 expect(await sees(both)).toBe(false); // a friend, but never chosen as one
 await joinHousehold(both);
 // The case that used to leak: a mixed share (household + other chosen friends).
 await share('friends','mixed',[friend]);
 expect(await sees(both)).toBe(true);
 await as('authenticated',both,'select public.leave_household()');
 expect(await sees(both)).toBe(false);
 expect(await sees(friend)).toBe(true);
 await joinHousehold(both);
});
it('new friends and household members do not inherit earlier shares',async()=>{
 await share('friends','mixed',[friend]);
 await befriend(late);await joinHousehold(late);
 expect(await sees(late)).toBe(false);
});
it('stopping sharing removes every recipient, immediately',async()=>{
 await share('friends','mixed',[friend,both]);
 await as('authenticated',owner,`select public.revoke_activity_publication('${trip}')`);
 expect(await current()).toEqual({audience:'private',household:false,friends:[]});
 for(const user of [both,friend,member])expect(await sees(user)).toBe(false);
 expect(Number((await as('service_role','',`select count(*)::int n from public.social_journey_recipients where activity_id='${trip}'`)).rows[0].n)).toBe(0);
});
it('switching to a public link clears private recipients in the same step',async()=>{
 await share('friends','selected',[friend]);
 await as('service_role','',`select public.commit_shared_journey('${trip}','${owner}',${await revision()},'public','${snapshot}'::jsonb)`);
 expect(await current()).toMatchObject({audience:'public',household:false,friends:[]});
 expect(await sees(friend)).toBe(false);
 expect(Number((await as('service_role','',`select count(*)::int n from public.social_journey_policies where activity_id='${trip}'`)).rows[0].n)).toBe(0);
});
it('a failed update keeps the last confirmed recipients',async()=>{
 await share('friends','selected',[friend]);
 // A stranger cannot be chosen: the whole save rolls back.
 await expect(share('friends','selected',['99999999-9999-4999-8999-999999999999'])).rejects.toThrow(/current friend/);
 expect(await current()).toEqual({audience:'friends',household:false,friends:[friend]});
 expect(await sees(friend)).toBe(true);
});
it('lists the owner\'s shared activities with their recipients, for the Activities indicators',async()=>{
 await share('friends','mixed',[friend]);
 const rows=(await as('authenticated',owner,'select * from public.my_social_publications()')).rows;
 expect(rows).toEqual([expect.objectContaining({activity_id:trip,household:true,friend_ids:[friend]})]);
 expect((await as('authenticated',friend,'select * from public.my_social_publications()')).rows).toEqual([]);
 await expect(as('authenticated',friend,'select * from public.social_journey_recipients')).rejects.toThrow();
});
