import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {afterAll,beforeAll,expect,it} from 'vitest';

const db=new PGlite();
const [viewer,friend,housemate,stranger,noConsent]=[1,2,3,4,5].map(n=>`00000000-0000-4000-8000-00000000000${n}`);
const owners=[viewer,friend,housemate,stranger,noConsent];
beforeAll(async()=>{
 await db.exec(`
 create role anon;
 create role authenticated;
 create role service_role;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as
 $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create schema vault;
 create table vault.decrypted_secrets(name text,decrypted_secret text);
 insert into vault.decrypted_secrets values ('push_worker_url','https://worker'),('push_worker_secret','test-only');
 create schema net;
 create table net.requests(body jsonb);
 create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds int) returns bigint
 language sql as $$ insert into net.requests values (body); select 1::bigint $$;
 create table public.location_checkins(owner_id uuid primary key,last_sent_at timestamptz);
 create table public.household_memberships(user_id uuid,household_id uuid);
 insert into public.household_memberships values ('${viewer}','${viewer}'),('${housemate}','${viewer}');
 create table public.household_live_locations(user_id uuid,enabled boolean);
 insert into public.household_live_locations values ('${housemate}',true);
 create table public.friend_connections(user_low uuid,user_high uuid);
 insert into public.friend_connections values ('${viewer}','${friend}'),('${viewer}','${noConsent}');
 create table public.friend_presence_shares(user_id uuid,enabled boolean);
 insert into public.friend_presence_shares values ('${friend}',true),('${stranger}',true),('${noConsent}',false);
 create function public.eligible_push_devices(p_owner uuid)
 returns table(owner_id uuid,apns_token text,environment text)
 language sql as $$ select p_owner,'fixture-token','sandbox' $$;
 `);
 await db.exec(await readFile('supabase/migrations/20261218000000_requested_location_refresh.sql','utf8'));
});
afterAll(()=>db.close());

it('queues only consented peers, throttles repeats and rechecks consent before sending',async()=>{
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${viewer}',false)`);
 const pull=()=>db.query('select public.request_location_refresh($1::uuid[]) as count',[owners]);
 expect((await pull()).rows).toEqual([{count:2}]);
 expect((await pull()).rows).toEqual([{count:0}]);
 await expect(db.query('select * from public.requested_location_refresh_devices($1,$2)',[viewer,owners])).rejects.toThrow(/permission denied/);
 await db.exec('reset role');
 const [{body}]=(await db.query('select body from net.requests')).rows;
 expect(body).toMatchObject({mode:'requested-checkin',viewer});
 expect(body.owners.toSorted()).toEqual([friend,housemate].toSorted());
 await db.query('update public.friend_presence_shares set enabled=false where user_id=$1',[friend]);
 await db.exec('set role service_role');
 const result=await db.query('select owner_id from public.requested_location_refresh_devices($1,$2)',[viewer,body.owners]);
 expect(result.rows).toEqual([{owner_id:housemate}]);
 await db.exec('reset role; set role anon');
 await expect(pull()).rejects.toThrow(/permission denied/);
});
