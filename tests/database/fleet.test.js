import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it } from 'vitest';
const db = new PGlite();
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const session = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const trip = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
async function as(role, user, sql) {
  await db.exec(`reset role; set role ${role}; select set_config('request.jwt.claim.sub','${user}',false); select set_config('request.jwt.claims','${JSON.stringify({ session_id: session })}',false);`);
  let result;for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))result=await db.query(statement);return result;
}
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
    insert into auth.users values('${a}','{}'),('${b}','{}'); insert into auth.sessions values('${session}','${a}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const name of (await readdir('supabase/migrations')).filter(n => n.endsWith('.sql')).sort()) await db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
}, 30000);
afterAll(() => db.close());
const vehicle='dddddddd-dddd-4ddd-8ddd-dddddddddddd',vin='5YJ3E1EA0KF000001';
it('enforces source ownership, service-only ingestion and idempotent event insert',async()=>{
 await as('service_role','',`insert into public.vehicles(id,owner_id,name,tesla_vehicle_id) values('${vehicle}','${a}','Tesla','123');insert into public.connected_services(owner_id,provider,status) values('${a}','tesla','connected');insert into public.fleet_bindings(vin,vehicle_id,owner_id,enabled,enabled_since,config_synced) values('${vin}','${vehicle}','${a}',true,now()-interval '1 day',true);`);
 await expect(as('authenticated',a,`select public.ingest_fleet_event('${vin}','${'a'.repeat(64)}',now(),'{}')`)).rejects.toThrow();
 const first=await as('service_role','',`select public.ingest_fleet_event('${vin}','${'a'.repeat(64)}',now(),'{}') as snapshot`);const second=await as('service_role','',`select public.ingest_fleet_event('${vin}','${'a'.repeat(64)}',now(),'{}') as snapshot`);expect(second.rows[0].snapshot.revision).toBe(first.rows[0].snapshot.revision);
 await expect(as('authenticated',a,'select * from public.fleet_events')).rejects.toThrow();expect((await as('authenticated',b,'select * from public.fleet_bindings')).rows).toHaveLength(0);
 await expect(as('authenticated',a,`insert into public.activities(id,owner_id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,route_points) values('${trip}','${a}','Fake','Driving','tesla',now(),now(),0,0,'[]')`)).rejects.toThrow('server-managed');
});
it('atomically commits a projection, rejects stale revisions and preserves manual metadata',async()=>{
 const now=Date.now()/1000,drive={id:trip,startedAt:now-60,endedAt:now,durationSeconds:60,distanceMeters:1000,points:[],details:{classification:{predicted:'Driving'}}};
 const revision=(await as('service_role','',`select revision from public.fleet_bindings where vin='${vin}'`)).rows[0].revision;
 const q=(r)=>`select public.commit_fleet_projection('${vin}',${r},'${JSON.stringify([drive])}','[]') as ok`;
 expect((await as('service_role','',q(Number(revision)+1))).rows[0].ok).toBe(false);expect((await as('service_role','',q(revision))).rows[0].ok).toBe(true);
 await as('authenticated',a,`update public.activities set title='Our road trip',notes='Photo memories',user_corrected=true where id='${trip}'`);
 await as('service_role','',q(revision));expect((await as('authenticated',a,`select title,notes from public.activities where id='${trip}'`)).rows[0]).toEqual({title:'Our road trip',notes:'Photo memories'});
 await expect(as('authenticated',a,`update public.activities set route_points='[{"spoof":true}]' where id='${trip}'`)).rejects.toThrow('server-managed');
});
it('does not share a private vehicle journey merely because users join a household',async()=>{
 await as('authenticated',a,"select * from public.create_household('Family')");const invite=(await as('authenticated',a,'select public.invite_to_household() as token')).rows[0].token;await as('authenticated',b,`select * from public.accept_household_invitation('${invite}')`);
 expect((await as('authenticated',b,`select * from public.activities where id='${trip}'`)).rows).toHaveLength(0);
 const household=(await as('service_role','',`select household_id from public.household_memberships where user_id='${a}'`)).rows[0].household_id;
 await as('service_role','',`update public.fleet_bindings set household_id='${household}',share_from=now()-interval '1 day' where vehicle_id='${vehicle}';update public.fleet_segments set household_id='${household}' where id='${trip}';`);
 expect((await as('authenticated',b,`select * from public.activities where id='${trip}'`)).rows).toHaveLength(1);
 await expect(as('authenticated',b,`update public.fleet_bindings set enabled=false where vehicle_id='${vehicle}'`)).rejects.toThrow();
 expect((await as('authenticated',b,`delete from public.activities where id='${trip}' returning id`)).rows).toHaveLength(0);
 await as('service_role','',`update public.fleet_bindings set household_id=null,share_from=null where vehicle_id='${vehicle}'`);
 expect((await as('authenticated',b,`select * from public.activities where id='${trip}'`)).rows).toHaveLength(0);
});
it('rejects cross-owner association and prevents duplicate VIN recording owners',async()=>{
 const other='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';await as('service_role','',`insert into public.vehicles(id,owner_id,name) values('${other}','${b}','Other')`);
 await expect(as('service_role','',`insert into public.fleet_bindings(vin,vehicle_id,owner_id) values('5YJ3E1EA0KF000002','${vehicle}','${b}')`)).rejects.toThrow();
 await expect(as('service_role','',`insert into public.fleet_bindings(vin,vehicle_id,owner_id) values('${vin}','${other}','${b}')`)).rejects.toThrow();
});
it('retains a source deletion and never resurrects it on repeated processing',async()=>{
 await as('authenticated',a,`delete from public.activities where id='${trip}'`);const source=(await as('service_role','',`select activity_id from public.fleet_segments where id='${trip}'`)).rows[0];expect(source.activity_id).toBeNull();
 const revision=(await as('service_role','',`select revision from public.fleet_bindings where vin='${vin}'`)).rows[0].revision;
 const now=Date.now()/1000;const drive={id:trip,startedAt:now-60,endedAt:now,durationSeconds:60,distanceMeters:1000,points:[]};await as('service_role','',`select public.commit_fleet_projection('${vin}',${revision},'${JSON.stringify([drive])}','[]')`);expect((await as('authenticated',a,`select * from public.activities where id='${trip}'`)).rows).toHaveLength(0);
});
it('stops ingestion on disconnect and cascades account deletion without retaining telemetry',async()=>{
 await as('service_role','',`insert into public.activities(id,owner_id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,route_points,vehicle_id) values('ffffffff-ffff-4fff-8fff-ffffffffffff','${a}','Live source','Driving','tesla',now()-interval '1 minute',now(),60,500,'[]','${vehicle}');insert into public.fleet_segments(id,activity_id,owner_id,vehicle_id,started_at,ended_at) values('ffffffff-ffff-4fff-8fff-ffffffffffff','ffffffff-ffff-4fff-8fff-ffffffffffff','${a}','${vehicle}',now()-interval '1 minute',now());`);
 await as('service_role','',`delete from public.connected_services where owner_id='${a}' and provider='tesla'`);expect((await as('service_role','',`select enabled from public.fleet_bindings where vin='${vin}'`)).rows[0].enabled).toBe(false);
 const result=(await as('service_role','',`select public.ingest_fleet_event('${vin}','${'b'.repeat(64)}',now(),'{}') as snapshot`)).rows[0].snapshot;expect(result.ignored).toBe(true);
 await db.exec(`reset role;delete from auth.users where id='${a}'`);expect((await as('service_role','','select * from public.fleet_events')).rows).toHaveLength(0);expect((await as('service_role','','select * from public.fleet_bindings')).rows).toHaveLength(0);
});
