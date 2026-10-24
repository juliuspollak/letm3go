import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it } from 'vitest';
const db=new PGlite(),a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333',sa='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sb='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',installation='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
async function as(role,user,sql,session=''){await db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claims','${JSON.stringify({session_id:session})}',false);`);return db.query(sql);}
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);insert into auth.users(id) values('${a}'),('${b}'),('${c}');insert into auth.sessions values('${sa}','${a}'),('${sb}','${b}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;`);
 for(const file of ['20261024000000_initial_profiles.sql','20261024010000_smart_activities.sql','20261024020000_auth_onboarding_households.sql'])await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
},30000);
afterAll(()=>db.close());
let invite;
it('persists setup per user and rejects cross-user edits',async()=>{
 await as('authenticated',a,`insert into public.account_preferences(user_id,display_name,onboarding_step,onboarding_complete) values('${a}','A',5,true)`);
 expect((await as('authenticated',b,'select * from public.account_preferences')).rows).toHaveLength(0);
 await expect(as('authenticated',b,`insert into public.account_preferences(user_id) values('${a}')`)).rejects.toThrow();
});
it('creates a household and a single-use invitation without sharing history',async()=>{
 await as('authenticated',a,"select * from public.create_household('Family')");
 invite=(await as('authenticated',a,'select public.invite_to_household() as token')).rows[0].token;
 await as('authenticated',b,`select * from public.accept_household_invitation('${invite}')`);
 expect((await as('authenticated',b,'select * from public.my_household()')).rows[0].role).toBe('member');
 expect((await as('authenticated',b,'select * from public.activities')).rows).toHaveLength(0);
 await expect(as('authenticated',c,`select * from public.accept_household_invitation('${invite}')`)).rejects.toThrow();
 await expect(as('authenticated',b,'select public.invite_to_household()')).rejects.toThrow();
 await expect(as('anon','',"select * from public.create_household('Fake')")).rejects.toThrow();
});
it('prevents direct membership manipulation and limits member directory access',async()=>{
 await expect(as('authenticated',c,`insert into public.household_memberships values('${c}',gen_random_uuid(),'owner',now())`)).rejects.toThrow();
 expect((await as('authenticated',c,'select * from public.household_members()')).rows).toHaveLength(0);
 expect((await as('authenticated',b,'select * from public.household_members()')).rows).toHaveLength(2);
});
it('ties APNs tokens to authenticated owner and live session',async()=>{
 const token='a'.repeat(64);
 await as('authenticated',a,`select public.register_push_device('${installation}','${token}','sandbox','${a}')`,sa);
 await expect(as('authenticated',b,'select * from public.push_devices',sb)).rejects.toThrow();
 await expect(as('authenticated',b,`select public.register_push_device('${installation}','${'b'.repeat(64)}','sandbox','${a}')`,sb)).rejects.toThrow();
 await expect(as('authenticated',b,`select public.register_push_device('${installation}','${'b'.repeat(64)}','sandbox','${b}')`,sb)).rejects.toThrow();
 await as('authenticated',b,`select public.register_push_device('${installation}','${token}','sandbox','${b}')`,sb);
 expect((await as('service_role','',`select * from public.eligible_push_devices('${a}')`)).rows).toHaveLength(0);
 expect((await as('service_role','',`select * from public.eligible_push_devices('${b}')`)).rows).toHaveLength(1);
 await db.exec(`reset role;delete from auth.sessions where id='${sb}'`);
 expect((await as('service_role','',`select * from public.eligible_push_devices('${b}')`)).rows).toHaveLength(0);
});
it('keeps provider tokens unavailable to every client, including their owner',async()=>{
 await as('service_role','',`insert into public.provider_credentials values('${a}','apple','ciphertext',now())`);
 await expect(as('authenticated',a,'select * from public.provider_credentials')).rejects.toThrow();
 await expect(as('authenticated',b,'select * from public.provider_credentials')).rejects.toThrow();
});
it('deletes owned activity/photo/token data and transfers household ownership',async()=>{
 const trip='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 await as('authenticated',a,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters) values('${trip}','Walk','Walking','manual',now(),now(),1,1)`);
 await db.exec(`reset role;delete from auth.users where id='${a}'`);
 expect((await as('authenticated',b,'select * from public.my_household()')).rows[0].role).toBe('owner');
 expect((await as('service_role','','select * from public.provider_credentials')).rows).toHaveLength(0);
 expect((await as('service_role','','select * from public.activities')).rows).toHaveLength(0);
});
