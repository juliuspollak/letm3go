import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {beforeAll,afterAll,expect,it} from 'vitest';
const db=new PGlite(),a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',session='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function as(role,user,sql){await db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claims','${JSON.stringify({session_id:session})}',false);`);return db.query(sql);}
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
const row=id=>({id,title:'Walk',activity:'Walking',recording_mode:'automatic',started_at:'2026-11-09T00:00:00Z',ended_at:'2026-11-09T01:00:00Z',duration_seconds:3600,distance_meters:1000,route_points:[{latitude:-33,longitude:151,timestamp:1794182400,segment:0},{latitude:-33.01,longitude:151.01,timestamp:1794182460,segment:0}]});
const hash=letter=>/^[a-f0-9]{64}$/.test(letter)?letter:letter.repeat(64);
const backup=(payload,fp,rev=null,base=null,owner=a)=>as('authenticated',owner,`select (public.backup_private_activity('${owner}','${JSON.stringify(payload)}','${hash(fp)}',${rev??'null'},${base?`'${hash(base)}'`:'null'})->>'revision')::integer as revision`);
it('recovers an existing legacy backup after place changes, without weakening privacy revision invalidation',async()=>{
 const id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',payload=row(id);
 // Simulate the four-argument client which produced the existing cloud records.
 expect((await as('authenticated',a,`select public.backup_private_activity('${a}','${JSON.stringify(payload)}','${hash('a')}',null) as revision`)).rows[0].revision).toBe(1);
 await as('authenticated',a,`insert into public.saved_places(id,name,kind,latitude,longitude,radius) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Home','home',-34,150,100)`);
 const current=(await as('authenticated',a,`select revision,sync_fingerprint from public.activities where id='${id}'`)).rows[0];
 expect(current.revision).toBeGreaterThan(1);expect(current.sync_fingerprint).toBe(hash('a'));
 const next=await backup({...payload,title:'Updated locally'},'b',1,'a');
 expect(next.rows[0].revision).toBe(current.revision+1);
 expect((await backup({...payload,title:'Updated locally'},'b',1,'a')).rows[0].revision).toBe(current.revision+1);
 await expect(backup({...payload,title:'Other stale device'},'c',1,'a')).rejects.toThrow('content changed');
 expect((await as('authenticated',a,`select title from public.activities where id='${id}'`)).rows[0].title).toBe('Updated locally');
});
it('invalidates the baseline after a direct material edit and refuses a stale overwrite',async()=>{
 const id='ffffffff-ffff-4fff-8fff-ffffffffffff',payload=row(id);
 await backup(payload,'a');
 await as('authenticated',a,`update public.activities set title='Edited elsewhere' where id='${id}'`);
 expect((await as('authenticated',a,`select sync_fingerprint from public.activities where id='${id}'`)).rows[0].sync_fingerprint).toBeNull();
 await expect(backup({...payload,title:'Stale phone'},'b',1,'a')).rejects.toThrow('content changed');
});
it('does not recover an unknown baseline by blindly adopting the latest revision',async()=>{
 const id='dddddddd-dddd-4ddd-8ddd-dddddddddddd',payload=row(id);
 await backup(payload,'a');await backup({...payload,title:'Second backup'},'b',1,'a');
 await expect(backup(payload,'c',1,null)).rejects.toThrow('conflict');
});
it('enforces owner isolation and never resurrects a deleted recording',async()=>{
 const id='cccccccc-cccc-4ccc-8ccc-cccccccccccc',payload=row(id);
 await backup(payload,'a');
 await expect(as('authenticated',b,`select public.backup_private_activity('${a}','${JSON.stringify(payload)}','${hash('b')}',1,'${hash('a')}')`)).rejects.toThrow('owner mismatch');
 await as('authenticated',a,`delete from public.activities where id='${id}'`);
 await expect(backup(payload,'b',1,'a')).rejects.toThrow('removed');
 await expect(backup(payload,'b',null,null)).rejects.toThrow('deleted');
});
it('retains the legacy four-argument revision guard and rejects malformed baselines',async()=>{
 const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',payload=row(id);
 await backup(payload,'a');await backup({...payload,title:'New'},'b',1,'a');
 await expect(as('authenticated',a,`select public.backup_private_activity('${a}','${JSON.stringify(payload)}','${hash('c')}',1)`)).rejects.toThrow('conflict');
 await expect(as('authenticated',a,`select public.backup_private_activity('${a}','${JSON.stringify(payload)}','${hash('c')}',2,'not-a-fingerprint')`)).rejects.toThrow('Invalid backup fingerprint');
});

it('runs the actual JavaScript backup through the migration chain and recovers a legacy receipt after privacy invalidation',async()=>{
 const {syncPrivateActivities}=await import('../../src/lib/cloudSync.js');
 const {webcrypto}=await import('node:crypto');
 const id='abacabad-abac-4aba-8aba-abacabadabac';
 const original={id:id.toUpperCase(),source:'device',recordingMode:'automatic',title:'Original',activity:'Driving',startedAt:100,endedAt:200,durationSeconds:100,distanceMeters:50,updatedAt:10,points:[{latitude:-33,longitude:151,timestamp:100,segment:0},{latitude:-33.01,longitude:151.01,timestamp:130,segment:0}]};
 let legacy=true;
 const sdk={auth:{getUser:async()=>({data:{user:{id:a}},error:null})},rpc:async(name,args)=>{
  expect(name).toBe('backup_private_activity');
  const quote=value=>value==null?'null':`'${String(value).replaceAll("'","''")}'`;
  const values=[quote(args.p_owner),quote(JSON.stringify(args.p_payload)),quote(args.p_fingerprint),args.p_expected_revision??'null'];
  if(!legacy)values.push(quote(args.p_base_fingerprint));
  try{return {data:(await as('authenticated',a,`select public.backup_private_activity(${values.join(',')}) as acknowledgement`)).rows[0].acknowledgement,error:null};}
  catch(error){return {data:null,error:{code:error.code,message:error.message}};}
 }};
 const run=(record,receipts={})=>syncPrivateActivities(sdk,{ownerID:a,trips:[record],places:[]},receipts,{cryptoImpl:webcrypto,publishSegments:false,throwOnFailure:false,now:10000});
 const first=await run(original);expect(first.uploaded).toBe(1);
 // Recreate the old uppercase key and six-hour failure left by an earlier build.
 const held={...first.receipts[id],backupVersion:2};
 const oldReceipts={[id.toUpperCase()]:held,['backup-failure:'+id.toUpperCase()]:{owner:a,message:'Cloud activity conflict',attempts:9,updatedAt:20,at:1,nextAt:999999999}};
 await as('authenticated',a,`update public.saved_places set name='Renamed Home' where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'`);
 const changed=(await as('authenticated',a,`select revision from public.activities where id='${id}'`)).rows[0].revision;
 expect(changed).toBeGreaterThan(held.revision);
 legacy=false;
 const second=await run({...original,title:'Changed on recording phone',updatedAt:20},oldReceipts);
 expect(second.uploaded).toBe(1);expect(second.failed).toBe(0);
 expect(second.receipts[id].revision).toBe(changed+1);expect(second.receipts['backup-failure:'+id].cleared).toBe(true);
 expect(second.receipts[id.toUpperCase()]).toBeUndefined();
 const remote=await run({...original,title:'Changed by second device',updatedAt:30},second.receipts);
 expect(remote.uploaded).toBe(1);
 const stale=await run({...original,title:'Stale first device',updatedAt:40},second.receipts);
 expect(stale.failed).toBe(1);expect(stale.uploaded).toBe(0);
 expect((await as('authenticated',a,`select title from public.activities where id='${id}'`)).rows[0].title).toBe('Changed by second device');
});

it('acknowledges equivalent typed content without rewriting, bumping revisions or revoking a shared projection',async()=>{
 const id='99999999-9999-4999-8999-999999999999',payload=row(id);
 await backup(payload,'a');
 await as('service_role','',`insert into public.shared_journeys(activity_id,owner_id,audience,snapshot) values('${id}','${a}','public','{"title":"Walk","activity":"Walking","points":[],"photos":[]}'::jsonb)`);
 const before=(await as('authenticated',a,`select revision,updated_at,sync_fingerprint from public.activities where id='${id}'`)).rows[0];
 const differentlyOrdered={...payload,id:id.toUpperCase(),route_points:payload.route_points.map(p=>({segment:p.segment,timestamp:p.timestamp,longitude:p.longitude,latitude:p.latitude}))};
 const ack=(await as('authenticated',a,`select public.backup_private_activity('${a}','${JSON.stringify(differentlyOrdered)}','${hash('b')}',null,null) as ack`)).rows[0].ack;
 expect(ack.revision).toBe(before.revision);expect(ack.base_fingerprint).toMatch(/^[a-f0-9]{64}$/);
 await as('authenticated',a,`set time zone 'Australia/Sydney'`);
 const zoned=(await as('authenticated',a,`select public.backup_private_activity('${a}','${JSON.stringify(differentlyOrdered)}','${hash('b')}',null,null) as ack`)).rows[0].ack;
 expect(zoned).toEqual(ack);
 await as('authenticated',a,`set time zone 'UTC'`);
 expect((await as('authenticated',a,`select revision,updated_at,sync_fingerprint from public.activities where id='${id}'`)).rows[0]).toEqual(before);
 expect((await as('service_role','',`select count(*)::int as n from public.shared_journeys where activity_id='${id}'`)).rows[0].n).toBe(1);
 expect((await backup({...payload,title:'A real local edit'},'c',ack.revision,ack.base_fingerprint)).rows[0].revision).toBe(before.revision+1);
});
