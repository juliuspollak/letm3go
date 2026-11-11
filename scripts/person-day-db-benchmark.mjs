import {PGlite} from '@electric-sql/pglite';
const log=(...a)=>console.log(...a);
import {readFile,readdir} from 'node:fs/promises';
// Local timing of the person-day reads on PGlite (WASM Postgres) for a heavy day: 30 shared
// activities x 600 points, 3 stored roads of 800 vertices each, a friend viewing. This is NOT a
// hosted Supabase measurement: run it against staging with real roles for that.
// Usage: node scripts/person-day-db-benchmark.mjs
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',friend='33333333-3333-4333-8333-333333333333';
async function as(role,user,sql){await db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claims','{}',false);`);return db.query(sql);}
const enc=n=>{n=Math.round(n*1e5);n=n<0?~(n<<1):n<<1;let o='';while(n>=32){o+=String.fromCharCode((32|(n&31))+63);n>>=5;}return o+String.fromCharCode(n+63);};
const time=async(label,fn,runs=5)=>{await fn();const t=performance.now();for(let i=0;i<runs;i++)await fn();log('PERF',label,((performance.now()-t)/runs).toFixed(1),'ms');};
async function setup(){
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);insert into auth.users(id) values('${owner}'),('${friend}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
 for(const f of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 const code=(await as('authenticated',owner,'select public.create_friend_invite() as code')).rows[0].code;
 await as('authenticated',friend,`select public.accept_friend_invite('${code}')`);
 await as('authenticated',owner,`insert into public.saved_places(id,name,kind,latitude,longitude,radius) values('99999999-9999-4999-8999-999999999999','Home','home',-34.5,150.8,100),('88888888-9999-4999-8999-999999999999','Work','work',-34.4,150.9,100)`);
 // 30 shared activities on one day, 600 points each, 3 roads of ~800 vertices each
 for(let a=0;a<30;a++){
  const id=`00000000-0000-4000-8000-${String(a).padStart(12,'0')}`,start=1900000000+a*1000;
  await as('authenticated',owner,`insert into public.activities(id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters) values('${id}','A${a}','Driving','manual',to_timestamp(${start}),to_timestamp(${start}+900),900,9000)`);
  const pts=Array.from({length:600},(_,i)=>({latitude:-34.7-i*1e-4,longitude:150.95+a*1e-3,segment:0,t:start+i}));
  await as('service_role','',`select public.publish_social_journey('${owner}','${id}',1,'friends','selected',array['${friend}']::uuid[],'${JSON.stringify({title:'A',activity:'Driving',points:pts,photos:[]})}'::jsonb)`);
  for(let r=0;r<3;r++){
   let line='',lat0=0,lon0=0;for(let i=0;i<800;i++){const la=Math.round((-34.7-i*1e-4)*1e5),lo=Math.round((150.95+r*1e-2)*1e5);let d1=la-lat0,d2=lo-lon0;lat0=la;lon0=lo;for(let v of [d1,d2]){v=v<0?~(v<<1):v<<1;while(v>=32){line+=String.fromCharCode((32|(v&31))+63);v>>=5;}line+=String.fromCharCode(v+63);}}
   await as('service_role','',`insert into public.journey_road_metadata(owner_id,ref,record) values('${owner}','${id.toUpperCase()}:${r}:${r+1}',jsonb_build_object('status','route','line',${"'"+line.replace(/'/g,"''")+"'"}))`);
  }
 }
}
async function measure(){
 const from="to_timestamp(1900000000-100)",to="to_timestamp(1900000000+40000)";
 const q=`select count(*)::int as n,sum(length(points::text))::int as pts,sum(length(roads::text))::int as roads from public.my_shared_day('${owner}',${from},${to},'{}')`;
 const r=(await as('authenticated',friend,q)).rows[0];log('PERF payload (friend, 30 activities)',JSON.stringify(r));
 await time('my_shared_day friend, cold (30 activities x 3 roads x 800 vertices)',()=>as('authenticated',friend,q),3);
 const etags=(await as('authenticated',friend,`select array_agg(etag) as e from public.my_shared_day('${owner}',${from},${to},'{}')`)).rows[0].e;
 await time('my_shared_day friend, revalidation with all etags',()=>as('authenticated',friend,`select count(*) from public.my_shared_day('${owner}',${from},${to},'{${etags.join(',')}}')`),3);
 await time('my_shared_day OWNER, cold',()=>as('authenticated',owner,`select count(*) from public.my_shared_day('${owner}',${from},${to},'{}')`),3);
 const plan=(await as('authenticated',friend,`explain (analyze,costs off,timing off) select * from public.my_shared_day('${owner}',${from},${to},'{}')`)).rows.map(x=>x['QUERY PLAN']).join('\\n');
 log('PLAN\\n'+plan);

 // A full live trail: 3000 points and 40 stored roads, a friend polling it (every 10 s while a map is open).
 await as('authenticated',owner,'select public.set_friend_location(true,-34.7,150.9,5)');
 const now=Math.floor(Date.now()/1000)-4000;
 const points=Array.from({length:3000},(_,i)=>[-34.7-i*1e-5,150.95,now+i,0]);
 const roads={};for(let r=0;r<40;r++)roads['R'+r]={l:enc(-34.9)+enc(151.2)+enc(-0.01)+enc(0.01),c:true};
 await as('service_role','',`insert into public.live_trails(owner_id,activity_ref,points,roads) values('${owner}','live1','${JSON.stringify(points)}'::jsonb,'${JSON.stringify(roads).replace(/\\/g,'\\\\')}'::jsonb) on conflict(owner_id) do update set points=excluded.points,roads=excluded.roads,activity_ref=excluded.activity_ref,updated_at=now()`);
}
async function liveMeasure(){
 const q="select point_count,jsonb_array_length(points) as n,length(points::text) as bytes,length(roads::text) as road_bytes from public.my_live_trail('"+owner+"')";
 log('PERF live trail payload (friend, 3000 points, 40 roads)',JSON.stringify((await as('authenticated',friend,q)).rows[0]));
 await time('my_live_trail friend, full trail',()=>as('authenticated',friend,"select * from public.my_live_trail('"+owner+"')"),5);
 await time('my_live_trail friend, incremental (nothing new)',()=>as('authenticated',friend,"select * from public.my_live_trail('"+owner+"',"+(Math.floor(Date.now()/1000)+10)+")"),5);
 await time('my_live_trail OWNER, full trail',()=>as('authenticated',owner,"select * from public.my_live_trail('"+owner+"')"),5);
}
await setup();await measure();await liveMeasure();await db.close();
