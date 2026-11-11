// Real independent PostgreSQL sessions, never a linked/hosted database. The runner
// creates and destroys its own cluster; set LETM3GO_PG_BIN to a local PG bin directory.
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {encodeLine} from '../../src/lib/gapReconstruction.js';

const bin=process.env.LETM3GO_PG_BIN||'/opt/homebrew/opt/postgresql@17/bin';
const root=mkdtempSync(join(tmpdir(),'letm3go-pg-')),socket=join(root,'socket'),data=join(root,'data');
mkdirSync(socket);
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG'))),PGHOST:socket,PGPORT:'55439',PGDATABASE:'postgres',PGUSER:process.env.USER,PGOPTIONS:'-c statement_timeout=10000 -c lock_timeout=5000'};
const exec=(name,args)=>execFileSync(join(bin,name),args,{env,encoding:'utf8',stdio:['pipe','pipe','pipe']});
const sql=query=>exec('psql',['-XqAt','-v','ON_ERROR_STOP=1','-c',query]).trim();
const owner='11111111-1111-4111-8111-111111111111',mate='22222222-2222-4222-8222-222222222222';
const auth=`set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);`;
class Session{
 constructor(name){
  this.name=name;this.buffer='';this.errors='';this.n=0;
  this.child=spawn(join(bin,'psql'),['-XqAt','-v','ON_ERROR_STOP=1'],{env:{...env,PGAPPNAME:name},stdio:'pipe'});
  this.child.stdout.on('data',chunk=>{this.buffer+=chunk;this.flush();});
  this.child.stderr.on('data',chunk=>{this.errors+=chunk;});
  this.child.on('exit',code=>{if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error(`psql ${name} exited ${code}: ${this.errors}`));this.pending=null;}});
 }
 flush(){if(this.pending&&this.buffer.includes(this.pending.marker)){const p=this.pending;this.pending=null;clearTimeout(p.timer);const [out,rest]=this.buffer.split(p.marker);this.buffer=rest.replace(/^\r?\n/,'');p.resolve(out.trim());}}
 run(query){
  assert.ok(!this.pending,'one command per session at a time');
  const marker=`DONE_${++this.n}`;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.child.kill();reject(new Error(`session ${this.name} timeout: ${this.errors}`));},10000);
   this.pending={marker,resolve,reject,timer};this.child.stdin.write(query+'\n\\echo '+marker+'\n');this.flush();});
 }
 close(){this.child.kill('SIGKILL');}
}
async function blocked(name){
 for(let i=0;i<100;i++){
  if(sql(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event_type='Lock'`)==='1')return;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 throw new Error(`${name} did not wait on a database lock`);
}
const points=()=>JSON.stringify([[-34.9,151,Math.floor(Date.now()/1000)-20,0],[-34.91,151,Math.floor(Date.now()/1000)-10,0]]);
let token,serial=0;
const activity=()=>{const id=`aaaaaaaa-0000-4000-8000-${String(++serial).padStart(12,'0')}`;
 sql(`insert into public.activities(id,owner_id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters) values('${id}','${owner}','Test','Driving','automatic',now()+interval '1 minute',now()+interval '2 minutes',60,1000)`);return id;};
const append=(ref,seq=1)=>`select public.append_live_trail('${token}','${ref}',${seq},'${seq<0?'[]':points()}'::jsonb);`;
const auto=id=>`select public.publish_social_journey('${owner}','${id}',(select revision from public.activities where id='${id}'),'household','household','{}','{"points":[]}'::jsonb,true);`;

try{
 exec('initdb',['-D',data,'-A','trust','--no-locale','-E','UTF8']);
 exec('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-k ${socket} -p 55439 -c listen_addresses=''`,'-w','start']);
 sql(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema auth to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
 for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()){
  if(process.env.LETM3GO_MIGRATION_THROUGH&&file.split('_')[0]>process.env.LETM3GO_MIGRATION_THROUGH)continue;
  execFileSync(join(bin,'psql'),['-Xq','-v','ON_ERROR_STOP=1'],{env,input:readFileSync('supabase/migrations/'+file),stdio:['pipe','pipe','pipe']});
 }
 sql(`insert into auth.users(id) values('${owner}'),('${mate}');`);
 sql(auth+`select * from public.create_household('Concurrency');select public.set_auto_share(true);select public.set_my_live_location(true,-34.9,151,5,10,now(),'driving');`);
 token=sql(auth+'select publish_token from public.issue_my_live_location_token();').split('\n').at(-1);
 await test('real PostgreSQL person-day concurrency',{timeout:120000},async t=>{
  for(const existing of [false,true])await t.test(`private hide precedes waiting upload (existing row: ${existing})`,async()=>{
   const ref=activity();sql('delete from public.live_trails');if(existing)sql(append(ref));
   const a=new Session('hide'),b=new Session('upload');
   try{
    await a.run('begin;'+auth+`select public.end_live_trail('${ref}',true);`);
    const waiting=b.run(append(ref));await blocked('upload');await a.run('commit;');
    assert.equal(await waiting,'f');assert.equal(sql(`select coalesce(sum(jsonb_array_length(points)),0) from public.live_trails`),'0');
   }finally{a.close();b.close();}
  });
  await t.test('upload commits first, then a waiting private decision clears points and roads',async()=>{
   const ref=activity(),a=new Session('upload-first'),b=new Session('hide-second');
   try{
    await a.run('begin;'+append(ref));const waiting=b.run(auth+`select public.keep_activity_private('${ref}');`);
    await blocked('hide-second');await a.run('commit;');await waiting;
    assert.equal(sql(`select jsonb_array_length(points) from public.live_trails where owner_id='${owner}'`),'0');
   }finally{a.close();b.close();}
  });
  await t.test('waiting upload cannot use a token whose sharing was disabled',async()=>{
   sql(auth+'select public.set_my_live_location(true);');token=sql(auth+'select publish_token from public.issue_my_live_location_token();').split('\n').at(-1);
   const ref=activity(),a=new Session('disable-live'),b=new Session('upload-disabled');
   try{
    // Hold the trail row so the draft implementation passes its early token check before waiting.
    sql(append(ref));await a.run('begin;'+auth+`select public.set_my_live_location(false);`);
    const waiting=b.run(append(ref));await blocked('upload-disabled');await a.run('commit;');
    assert.equal(await waiting,'f');assert.equal(sql(`select jsonb_array_length(points) from public.live_trails where owner_id='${owner}'`),'0');
   }finally{a.close();b.close();}
  });
  await t.test('automatic publication waits for disabling consent and refuses after commit',async()=>{
   sql(auth+'select public.set_auto_share(true);');const id=activity(),a=new Session('consent-off'),b=new Session('auto-publish');
   try{
    await a.run('begin;'+auth+'select public.set_auto_share(false);');
    const waiting=b.run(auto(id));waiting.catch(()=>{});await blocked('auto-publish');await a.run('commit;');
    await assert.rejects(waiting,/consent|eligible/i);assert.equal(sql(`select count(*) from public.shared_journeys where activity_id='${id}'`),'0');
   }finally{a.close();b.close();}
  });
  for(const decision of ['private','manual'])await t.test(`automatic publication cannot overtake a ${decision} decision`,async()=>{
   sql(auth+'select public.set_auto_share(true);');const id=activity(),a=new Session('decision-first'),b=new Session('auto-after-decision');
   try{
    const decide=decision==='private'?`select public.keep_activity_private('${id}');`:auto(id).replace(',true);',',false);');
    await a.run('begin;'+(decision==='private'?auth:'set role service_role;')+decide);const waiting=b.run(auto(id));waiting.catch(()=>{});
    await blocked('auto-after-decision');await a.run('commit;');await assert.rejects(waiting,/eligible/);
    assert.equal(sql(`select count(*) from public.shared_journeys where activity_id='${id}'`),decision==='private'?'0':'1');
   }finally{a.close();b.close();}
  });
  await t.test('a late road cannot restore geometry after hide',async()=>{
   sql(auth+'select public.set_my_live_location(true);');token=sql(auth+'select publish_token from public.issue_my_live_location_token();').split('\n').at(-1);
   const ref=activity();sql(append(ref));const a=new Session('hide-road'),b=new Session('road-after-hide');
   const line=encodeLine([[-34.9,151],[-34.91,151]]).replaceAll("'","''");
   try{
    await a.run('begin;'+auth+`select public.end_live_trail('${ref}',true);`);
    const waiting=b.run(auth+`select public.put_my_live_road('${ref}','${ref}:1:2','${line}');`);
    await blocked('road-after-hide');await a.run('commit;');assert.equal((await waiting).split('\n').at(-1),'f');
    assert.equal(sql(`select roads from public.live_trails where owner_id='${owner}'`),'{}');
   }finally{a.close();b.close();}
  });
  await t.test('a road waiting behind a Home edit computes its mask after the edit commits',async()=>{
   const ref=activity();sql(append(ref));sql(auth+`insert into public.saved_places(id,name,kind,latitude,longitude,radius) values('bbbbbbbb-0000-4000-8000-000000000001','Home','home',-33,150,100);`);
   const a=new Session('home-first'),b=new Session('road-after-home'),line=encodeLine([[-34.9,151],[-34.91,151]]);
   try{
    await a.run('begin;'+auth+`update public.saved_places set latitude=-34.9,longitude=151 where owner_id=auth.uid() and kind='home';`);
    const waiting=b.run(auth+`select public.put_my_live_road('${ref}','${ref}:1:2','${line}');`);
    await blocked('road-after-home');await a.run('commit;');await waiting;
    assert.equal(sql(`select roads->'${ref}:1:2'->>'c' from public.live_trails where owner_id='${owner}'`),'false');
   }finally{a.close();b.close();}
  });
  await t.test('publication first serialises consent change until its atomic commit',async()=>{
   sql(auth+'select public.set_auto_share(true);');const id=activity(),a=new Session('auto-first'),b=new Session('disable-second');
   try{
    await a.run('begin;'+auto(id));const waiting=b.run(auth+'select public.set_auto_share(false);');
    await blocked('disable-second');await a.run('commit;');await waiting;
    assert.equal(sql(`select count(*) from public.shared_journeys where activity_id='${id}'`),'1');
   }finally{a.close();b.close();}
  });
  for(const mode of ['volatile','stable'])await t.test(`share read uses one authorised snapshot (${mode} control)`,async()=>{
   sql(`alter function public.read_social_journey(uuid) ${mode}`);
   const invite=sql(auth+'select public.invite_to_household();').split('\n').at(-1);
   if(sql(`select count(*) from public.household_memberships where user_id='${mate}'`)==='0')sql(`set role authenticated;select set_config('request.jwt.claim.sub','${mate}',false);select * from public.accept_household_invitation('${invite}');`);
   const id=activity();sql(auto(id).replace(',true);',',false);').replace('{"points":[]}','{"title":"authorised-old","points":[]}'));
   const definition=sql("select pg_get_functiondef('public.can_view_social_journey(uuid)'::regprocedure)");
   // A test-only gate after the real access check makes this otherwise tiny race
   // deterministic. It is installed and removed only in the disposable cluster.
   sql(`alter function public.can_view_social_journey(uuid) rename to test_saved_can_view;
    create function public.can_view_social_journey(p_activity uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
    declare allowed boolean;begin allowed:=public.test_saved_can_view(p_activity);perform pg_advisory_xact_lock(991337);return allowed;end $$;`);
   const a=new Session('replace-share'),b=new Session('read-share');
   try{
    await a.run('begin;select pg_advisory_xact_lock(991337);');
    const waiting=b.run(`set role authenticated;select set_config('request.jwt.claim.sub','${mate}',false);select public.read_social_journey('${id}');`);
    await blocked('read-share');
    await a.run(`delete from public.social_journey_recipients where activity_id='${id}';update public.shared_journeys set snapshot='{"title":"new-unavailable","points":[]}' where activity_id='${id}';commit;`);
    const result=JSON.parse((await waiting).split('\n').at(-1));assert.equal(result.snapshot.title,mode==='stable'?'authorised-old':'new-unavailable');
   }finally{a.close();b.close();sql(definition+";drop function public.test_saved_can_view(uuid);alter function public.read_social_journey(uuid) stable;");}
  });
  await t.test('private decisions do not deadlock with the account deletion freeze lock order',async()=>{
   const id=activity();sql(auto(id).replace(',true);',',false);'));const a=new Session('freeze-owner'),b=new Session('private-during-freeze');
   try{
    await a.run(`begin;select id from auth.users where id='${owner}' for update;`);
    const waiting=b.run(auth+`select public.keep_activity_private('${id}');`);waiting.catch(()=>{});
    await blocked('private-during-freeze');
    await a.run(`delete from public.shared_journeys where owner_id='${owner}';commit;`);await waiting;
    assert.equal(sql(`select count(*) from public.shared_journeys where activity_id='${id}'`),'0');
   }finally{a.close();b.close();}
  });
  await t.test('an upload does not hold its credential while waiting for the deletion freeze',async()=>{
   sql(auth+'select public.set_my_live_location(true);');token=sql(auth+'select publish_token from public.issue_my_live_location_token();').split('\n').at(-1);
   sql('delete from public.live_trails');const ref=activity(),a=new Session('freeze-before-upload'),b=new Session('upload-during-freeze');
   try{
    await a.run(`begin;select id from auth.users where id='${owner}' for update;`);
    const waiting=b.run(append(ref));waiting.catch(()=>{});await blocked('upload-during-freeze');
    await a.run(auth+'select public.set_my_live_location(false);commit;');assert.equal(await waiting,'f');
   }finally{a.close();b.close();}
  });
  await t.test('an end request does not hold the advisory lock while waiting for the deletion freeze',async()=>{
   sql(auth+'select public.set_my_live_location(true);');token=sql(auth+'select publish_token from public.issue_my_live_location_token();').split('\n').at(-1);
   const ref=activity(),a=new Session('freeze-before-end'),b=new Session('end-during-freeze');
   try{
    await a.run(`begin;select id from auth.users where id='${owner}' for update;`);
    const waiting=b.run(auth+`select public.end_live_trail('${ref}',true);`);waiting.catch(()=>{});await blocked('end-during-freeze');
    await a.run(append(ref)+'commit;');await waiting;
    assert.equal(sql(`select jsonb_array_length(points) from public.live_trails where owner_id='${owner}'`),'0');
   }finally{a.close();b.close();}
  });
  await t.test('automatic publication cannot outlive a concurrent household departure',async()=>{
   sql(auth+'select public.set_auto_share(true);');const id=activity(),a=new Session('leave-first'),b=new Session('auto-after-leave');
   try{
    await a.run('begin;'+auth+'select public.leave_household();');const waiting=b.run(auto(id));waiting.catch(()=>{});
    await blocked('auto-after-leave');await a.run('commit;');await assert.rejects(waiting,/consent|eligible/);
    assert.equal(sql(`select count(*) from public.shared_journeys where activity_id='${id}'`),'0');
   }finally{a.close();b.close();}
  });
 });
}finally{
 try{exec('pg_ctl',['-D',data,'-m','immediate','-w','stop']);}catch{/* setup might not have reached startup */}
 rmSync(root,{recursive:true,force:true});
}
