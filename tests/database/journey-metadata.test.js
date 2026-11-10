import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it } from 'vitest';
const db = new PGlite();
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const session = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function as(role, user, sql) {
  await db.exec(`reset role; set role ${role}; select set_config('request.jwt.claim.sub','${user}',false); select set_config('request.jwt.claims','${JSON.stringify({ session_id: session })}',false);`);
  return db.query(sql);
}
// The payloads are exactly what src/lib/journeyMetadata.js queues: record values
// keyed by domain, plus the once-per-account enrichment cutoff.
const snapshot = owner => `select public.journey_metadata_snapshot('${owner}') as data`;
const revision = owner => `select public.journey_metadata_revision('${owner}') as revision`;
const apply = (owner, changes, expected = 'null') =>
  `select public.journey_apply_changes('${owner}',$journey$${JSON.stringify(changes)}$journey$,${expected}) as data`;
const mine = (user, changes, expected = 'null') => as('authenticated', user, apply(user, changes, expected));
const read = async (user = a) => (await as('authenticated', user, snapshot(user))).rows[0].data;
// The pull answer carries the cloud revision next to the grouping; the app drops the
// bookkeeping keys before validating, so the test does the same.
const grouping = data => {
  const copy = { ...data };
  delete copy.revision;
  delete copy.updatedAt;
  return copy;
};
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

const journey = {
  enrichFrom: 1700000000000,
  activities: [
    { ref: 'a', title: 'Morning drive', type: 'Driving', manualTags: ['work', 'early'], hiddenTags: [], enrichedAt: 1700000100000 },
    { ref: 'b', title: null, type: 'Walking', manualTags: [], hiddenTags: ['internal'], enrichedAt: null },
  ],
  // Reversed on purpose: a merge is the same record whichever side it is sent from.
  pairs: [
    { relation: 'link', left: 'b', right: 'a' },
    { relation: 'cut', left: 'a', right: 'c' },
    { relation: 'source', left: 'b', right: 'd' },
  ],
  stops: [
    { ref: 'dwell:a:1700000000', name: 'Cafe Anna', tags: ['coffee'], replaceTags: true },
    { ref: 'native:c:1700000600', ignored: true },
  ],
  places: [{ ref: '52.5163,13.3777', lookup: { nearbyName: 'Brandenburg Gate', categories: ['park'] } }],
  roads: [{ ref: 'a:1700000000:1700000060', record: { version: 2, status: 'route', distanceMeters: 800, line: 'abc' } }],
  summaries: [{ ref: 'a', snapshot: { distanceMeters: 1200, pointCount: 340 } }],
};

it('hands back an empty grouping before anything is stored', async () => {
  const data = await read();
  expect(data).toMatchObject({ version: 1, owner: a, links: [], cuts: [], sourceLinks: [], history: [],
    titles: {}, types: {}, manualTags: {}, hiddenTags: {}, enriched: {}, places: {}, roads: {},
    stopEdits: {}, distanceSummaries: {}, enrichFrom: null, revision: null, updatedAt: null });
  expect((await as('authenticated', a, revision(a))).rows[0].revision).toBeNull();
  const parsed = await import('../../src/lib/journeyGrouping.js');
  expect(parsed.validateGrouping(grouping(data), a)).not.toBeNull();
});

it('stores every decision and derived answer as one record each', async () => {
  expect((await mine(a, journey)).rows[0].data.revision).toBe(1);
  const data = await read();
  expect(data).toMatchObject({
    titles: { a: 'Morning drive' }, types: { a: 'Driving', b: 'Walking' },
    manualTags: { a: ['work', 'early'] }, hiddenTags: { b: ['internal'] },
    enriched: { a: 1700000100000 },
    links: ['["a","b"]'], cuts: ['["a","c"]'], sourceLinks: [['b', 'd']],
    stopEdits: { 'dwell:a:1700000000': { name: 'Cafe Anna', tags: ['coffee'], replaceTags: true },
      'native:c:1700000600': { ignored: true } },
    enrichFrom: 1700000000000, revision: 1,
  });
  expect(data.places['52.5163,13.3777']).toEqual({ nearbyName: 'Brandenburg Gate', categories: ['park'] });
  expect(data.roads['a:1700000000:1700000060'].distanceMeters).toBe(800);
  expect(data.distanceSummaries.a.pointCount).toBe(340);
  expect(Number.isFinite(Date.parse(data.updatedAt))).toBe(true);
  // The same answer the app validates locally, so a pull needs no translation.
  const parsed = await import('../../src/lib/journeyGrouping.js');
  expect(parsed.validateGrouping(grouping(data), a)).toMatchObject({ owner: a, titles: { a: 'Morning drive' } });
  const counts = await as('authenticated', a, `select
    (select count(*) from public.journey_activity_metadata where owner_id='${a}') as activities,
    (select count(*) from public.journey_pair_metadata where owner_id='${a}') as pairs,
    (select count(*) from public.journey_stop_metadata where owner_id='${a}') as stops`);
  expect(counts.rows[0]).toMatchObject({ activities: 2, pairs: 3, stops: 2 });
});

it('re-sends a value without duplicating it and refuses a stale write', async () => {
  // A retried request is the same records: one row, one more revision.
  expect((await mine(a, { activities: [journey.activities[0]] }, 1)).rows[0].data.revision).toBe(2);
  expect((await as('authenticated', a, `select count(*) as total from public.journey_activity_metadata where owner_id='${a}'`)).rows[0].total).toBe(2);
  await expect(mine(a, { activities: [{ ref: 'a', title: 'Stale' }] }, 1)).rejects.toThrow('conflict');
  expect((await read()).titles.a).toBe('Morning drive');
  expect((await mine(a, { activities: [{ ref: 'a', title: 'Renamed' }] }, 2)).rows[0].data.revision).toBe(3);
  expect((await read()).titles.a).toBe('Renamed');
});

it('writes nothing at all when one record in a batch is refused', async () => {
  await expect(mine(a, { activities: [{ ref: 'e', title: 'New' }], places: [{ ref: '0,0', lookup: 'nonsense' }] }, 3))
    .rejects.toThrow('Invalid place answer');
  const data = await read();
  expect(data.titles.e).toBeUndefined();
  expect(data.revision).toBe(3);
});

it('removes what the user undid and leaves everything else alone', async () => {
  expect((await mine(a, {
    activities: [{ ref: 'a', delete: true }],
    pairs: [{ relation: 'link', left: 'a', right: 'b', delete: true }],
    stops: [{ ref: 'dwell:a:1700000000', name: null }],
    roads: [{ ref: 'a:1700000000:1700000060', delete: true }],
  }, 3)).rows[0].data.revision).toBe(4);
  const data = await read();
  expect(data.titles.a).toBeUndefined();
  expect(data.links).toEqual([]);
  expect(data.cuts).toEqual(['["a","c"]']);
  expect(data.stopEdits['dwell:a:1700000000']).toBeUndefined();
  expect(data.roads).toEqual({});
  // Domains the batch did not mention keep their answers.
  expect(data.distanceSummaries.a).toEqual({ distanceMeters: 1200, pointCount: 340 });
  expect(data.places['52.5163,13.3777'].nearbyName).toBe('Brandenburg Gate');
});

it('decides the enrichment cutoff once per account', async () => {
  expect((await mine(a, { enrichFrom: 1800000000000 }, 4)).rows[0].data.revision).toBe(5);
  expect((await read()).enrichFrom).toBe(1700000000000);
  expect((await mine(b, { enrichFrom: 1900000000000 })).rows[0].data.revision).toBe(1);
  expect((await read(b)).enrichFrom).toBe(1900000000000);
});

it('refuses another account and hides its records', async () => {
  await expect(as('authenticated', a, snapshot(b))).rejects.toThrow('owner mismatch');
  await expect(as('authenticated', a, apply(b, { activities: [{ ref: 'x', title: 'Hijack' }] }))).rejects.toThrow();
  await expect(as('authenticated', a, revision(b))).rejects.toThrow('owner mismatch');
  expect((await as('authenticated', b, `select count(*) as total from public.journey_activity_metadata where owner_id='${a}'`)).rows[0].total).toBe(0);
  expect((await as('authenticated', b, `select count(*) as total from public.journey_metadata_state where owner_id='${a}'`)).rows[0].total).toBe(0);
  await expect(as('anon', '', snapshot(a))).rejects.toThrow(/owner mismatch|permission denied/);
  await expect(as('anon', '', `select count(*) from public.journey_activity_metadata`)).rejects.toThrow();
});

it('refuses changes the grouping screen could not have produced', async () => {
  await expect(mine(a, { history: [] })).rejects.toThrow('Unsupported journey change domain');
  await expect(mine(a, { titles: {} })).rejects.toThrow('Unsupported journey change domain');
  await expect(mine(a, { activities: 'nope' })).rejects.toThrow('must be lists');
  await expect(mine(a, { activities: [{ ref: 'a', type: 'Teleporting' }] })).rejects.toThrow('activity type');
  await expect(mine(a, { activities: [{ ref: 'x'.repeat(81), title: 'Long' }] })).rejects.toThrow('Invalid activity reference');
  await expect(mine(a, { activities: [{ ref: 'a', title: 'x'.repeat(151) }] })).rejects.toThrow('Invalid journey title');
  await expect(mine(a, { activities: [{ ref: 'a', manualTags: Array.from({ length: 21 }, (_, index) => `t${index}`) }] }))
    .rejects.toThrow('Too many journey tags');
  await expect(mine(a, { pairs: [{ relation: 'link', left: 'a', right: 'a' }] })).rejects.toThrow('Invalid journey pair');
  await expect(mine(a, { pairs: [{ relation: 'merge', left: 'a', right: 'b' }] })).rejects.toThrow('pair relation');
  await expect(mine(a, { stops: [{ ref: 'nope', name: 'x'.repeat(101) }] })).rejects.toThrow('Invalid stop name');
  await expect(mine(a, { summaries: [{ ref: 'a', snapshot: [] }] })).rejects.toThrow('Invalid distance summary answer');
  expect((await read()).revision).toBe(5);
});

it('reports a record it replaced instead of replacing it silently', async () => {
  // Two devices answer the same question at the same time. The later write still wins,
  // because a record is a value, but its answer names what it replaced.
  expect((await mine(a, { activities: [{ ref: 'a', title: 'Renamed on the iPhone' }] }, 5)).rows[0].data)
    .toEqual({ revision: 6, overwritten: [] });
  const second = (await mine(a, { activities: [{ ref: 'a', title: 'Renamed on the iPad' }] }, 6)).rows[0].data;
  expect(second.revision).toBe(7);
  expect(second.overwritten).toEqual([{ domain: 'activities', ref: 'a' }]);
  // Re-sending the value the cloud already holds is not an overwrite.
  expect((await mine(a, { activities: [{ ref: 'a', title: 'Renamed on the iPad' }] }, 7)).rows[0].data)
    .toEqual({ revision: 8, overwritten: [] });
  // Stop corrections and derived answers report the same way, in the order they land.
  expect((await mine(a, {
    stops: [{ ref: 'native:c:1700000600', name: 'Supermarket' }],
    places: [{ ref: '52.5163,13.3777', lookup: { nearbyName: 'Pariser Platz' } }],
  }, 8)).rows[0].data.overwritten).toEqual([
    { domain: 'stops', ref: 'native:c:1700000600' },
    { domain: 'places', ref: '52.5163,13.3777' },
  ]);
});

it('removes every record with the account', async () => {
  const c = '33333333-3333-4333-8333-333333333333';
  await db.exec(`reset role; insert into auth.users values('${c}','{}')`);
  await mine(c, { activities: [{ ref: 'z', title: 'Last drive' }], places: [{ ref: '1,2', lookup: { kind: 'park' } }] });
  expect((await as('service_role', '', `select count(*) as total from public.journey_activity_metadata where owner_id='${c}'`)).rows[0].total).toBe(1);
  await db.exec(`reset role; delete from auth.users where id='${c}'`);
  const left = await as('service_role', '', `select
    (select count(*) from public.journey_metadata_state where owner_id='${c}') as state,
    (select count(*) from public.journey_activity_metadata where owner_id='${c}') as activities,
    (select count(*) from public.journey_place_metadata where owner_id='${c}') as places`);
  expect(left.rows[0]).toEqual({ state: 0, activities: 0, places: 0 });
});

// End-to-end application reducers -> real SQL -> validation -> app reducers.
it('round trips merges, splits, source links, stop edits and reloads through SQL',async()=>{
 const {emptyGrouping,changeGrouping,buildJourneys}=await import('../../src/lib/journeyGrouping.js');
 const {groupingChanges}=await import('../../src/lib/journeyMetadata.js');
 const {loadSnapshot}=await import('../../src/lib/journeyMetadataStore.js');
 const owner='44444444-4444-4444-8444-444444444444';
 await db.exec(`reset role; insert into auth.users values('${owner}','{}')`);
 const client={async rpc(name,args){try{
  const data=name==='journey_metadata_snapshot'?await read(owner):(await mine(owner,args.p_changes,args.p_expected_revision??'null')).rows[0].data;
  return {data,error:null};
 }catch(error){return {data:null,error:{message:error.message}};}}};
 const point=(latitude,timestamp)=>({latitude,longitude:151.2,timestamp,accuracy:5,speed:2,segment:0});
 const activities=[0,1,2].map((n)=>({id:['z','a','b'][n],ownerID:owner,source:'device',state:'finished',activity:'Walking',title:`Leg ${n}`,startedAt:10000+n*400,endedAt:10300+n*400,durationSeconds:300,distanceMeters:400,points:[point(-33.86+n*.001,10000+n*400),point(-33.859+n*.001,10300+n*400)],details:{tags:[]}}));
 const context={owner,activities,vehicles:[],places:[]};
 let local=emptyGrouping(owner),rev=null;
 const roundTrip=async action=>{
  const next=changeGrouping(local,action,context);
  rev=(await mine(owner,groupingChanges(local,next),rev??'null')).rows[0].data.revision;
  local=(await loadSnapshot(client,owner)).metadata;return local;
 };
 await roundTrip({type:'merge',ids:['z','a','b']});
 expect(local.links).toEqual(['["a","b"]','["a","z"]']);
 expect(buildJourneys(activities,{...context,metadata:local}).journeys[0].segmentIDs).toEqual(['z','a','b']);
 await roundTrip({type:'stop',id:'["a","z"]',name:'Cafe',tags:['coffee'],replaceTags:true});
 expect(local.stopEdits['["a","z"]']).toEqual({name:'Cafe',tags:['coffee'],replaceTags:true});
 await roundTrip({type:'split',after:'z',before:'a'});
 expect(local.links).toEqual(['["a","b"]']);expect(local.cuts).toEqual(['["a","z"]']);
 expect(buildJourneys(activities,{...context,metadata:local}).journeys).toHaveLength(2);
 const next={...local,sourceLinks:[['linked:z','z']]};
 await mine(owner,groupingChanges(local,next),rev);
 const reloaded=(await loadSnapshot(client,owner)).metadata;
 expect(reloaded.sourceLinks).toEqual([['linked:z','z']]);
 expect(reloaded.cuts.every(pair=>typeof pair==='string'&&Array.isArray(JSON.parse(pair)))).toBe(true);
 expect(reloaded.stopEdits).toEqual(local.stopEdits);
});

it('merges independent offline fields and preserves competing field values with real revision checks',async()=>{
 const {emptyGrouping}=await import('../../src/lib/journeyGrouping.js');
 const {groupingChanges,mergeChanges}=await import('../../src/lib/journeyMetadata.js');
 const {runJourneySync,emptyStatus}=await import('../../src/lib/journeyMetadataStore.js');
 const owner='55555555-5555-4555-8555-555555555555';
 await db.exec(`reset role; insert into auth.users values('${owner}','{}')`);
 const client={async rpc(name,args){try{
  let data;
  if(name==='journey_metadata_snapshot')data=await read(owner);
  else if(name==='journey_metadata_revision')data=(await as('authenticated',owner,revision(owner))).rows[0].revision;
  else data=(await mine(owner,args.p_changes,args.p_expected_revision??'null')).rows[0].data;
  return {data,error:null};
 }catch(error){return {data:null,error:{message:error.message}};}}};
 const device=()=>{
  const state={metadata:emptyGrouping(owner),queue:{},status:emptyStatus(owner)};
  return {read:()=>state,write:async patch=>Object.assign(state,typeof patch==='function'?patch(state):patch)};
 };
 const one=device(),two=device(),sync=device=>runJourneySync({client,owner,...device});
 await sync(one);await sync(two);
 const edit=(device,patch)=>{const s=device.read(),next={...s.metadata,...patch};s.queue=mergeChanges(s.queue,groupingChanges(s.metadata,next));s.metadata=next;};
 edit(one,{titles:{a:'From A'}});await sync(one);
 // B had no edits: its revision check discovers A's title.
 await sync(two);expect(two.read().metadata.titles.a).toBe('From A');
 // Both go offline and edit unrelated fields of the same activity.
 edit(one,{titles:{a:'A title offline'}});edit(two,{manualTags:{a:['B tag offline']}});
 await sync(one);expect((await sync(two)).state).toBe('active');await sync(one);
 expect((await read(owner))).toMatchObject({titles:{a:'A title offline'},manualTags:{a:['B tag offline']}});
 expect(one.read().metadata.manualTags.a).toEqual(['B tag offline']);
 edit(one,{stopEdits:{'native:a:10':{name:'Cafe'}}});
 edit(two,{stopEdits:{'native:a:10':{tags:['coffee'],replaceTags:true}}});
 await sync(one);expect((await sync(two)).state).toBe('active');await sync(one);
 expect((await read(owner)).stopEdits['native:a:10']).toEqual({name:'Cafe',tags:['coffee'],replaceTags:true});
 edit(two,{manualTags:{a:[]}});expect((await sync(two)).state).toBe('active');await sync(one);
 expect((await read(owner)).manualTags.a).toBeUndefined();
 // Concurrent changes of the same field are not last-writer-wins.
 edit(one,{titles:{a:'A competing title'}});edit(two,{titles:{a:'B competing title'}});
 await sync(one);expect((await sync(two)).state).toBe('offline');
 expect((await read(owner)).titles.a).toBe('A competing title');
 expect(two.read().queue.activities[0].title).toBe('B competing title');
 expect(two.read().status.error).toContain('a.title');
 // CAS refuses an actual stale device without storing even its unrelated edits.
 await expect(mine(owner,{activities:[{ref:'untouched',title:'stale'}]},1)).rejects.toThrow('conflict');
 expect((await read(owner)).titles.untouched).toBeUndefined();
});

it('can reapply the unshipped migration without losing existing records',async()=>{
 const before=await read();
 await db.exec(`reset role`);
 await db.exec(await readFile('supabase/migrations/20261120000000_journey_metadata_records.sql','utf8'));
 expect(await read()).toEqual(before);
});

it('preserves a large reconstructed route and all 60 legacy hidden tags',async()=>{
 const owner='66666666-6666-4666-8666-666666666666';
 await db.exec(`reset role; insert into auth.users values('${owner}','{}')`);
 const hiddenTags=Array.from({length:60},(_,i)=>`hidden ${i}`),line='abc'.repeat(180000);
 await mine(owner,{activities:[{ref:'large',hiddenTags}],roads:[{ref:'large:10:20',record:{version:1,status:'route',line,distanceMeters:1000}}]});
 const result=await read(owner);
 expect(result.hiddenTags.large).toEqual(hiddenTags);expect(result.roads['large:10:20'].line).toBe(line);
});

it('does not erase the only legacy cloud copy during an ordinary settings backup',async()=>{
 const owner='77777777-7777-4777-8777-777777777777',fingerprint='1'.repeat(64),next='2'.repeat(64);
 await db.exec(`reset role; insert into auth.users values('${owner}','{}')`);
 const legacy=JSON.stringify({version:1,owner,titles:{a:'Legacy title'},links:[],cuts:[],history:[],places:{},stopEdits:{}});
 await as('authenticated',owner,`select public.backup_account_settings('${owner}',$payload$${JSON.stringify({displayName:'Old',journeyGrouping:legacy})}$payload$,'${fingerprint}',null)`);
 await as('authenticated',owner,`select public.backup_account_settings('${owner}','{"displayName":"New settings"}','${next}',1)`);
 const stored=(await as('authenticated',owner,`select payload from public.account_settings where owner_id='${owner}'`)).rows[0].payload;
 expect(stored.displayName).toBe('New settings');expect(stored.journeyGrouping).toBe(legacy);
});

it('preserves contradictory offline merge/split choices instead of replacing the remote choice',async()=>{
 const {emptyGrouping}=await import('../../src/lib/journeyGrouping.js');
 const {groupingChanges,rebaseChanges}=await import('../../src/lib/journeyMetadata.js');
 const owner='88888888-8888-4888-8888-888888888888';
 await db.exec(`reset role; insert into auth.users values('${owner}','{}')`);
 const before=emptyGrouping(owner),merge={...before,links:['["a","b"]']},split={...before,cuts:['["a","b"]']};
 await mine(owner,groupingChanges(before,merge));
 const {revision:_r,updatedAt:_t,...remote}=await read(owner);void _r;void _t;
 const pending=groupingChanges(before,split),rebased=rebaseChanges(pending,remote);
 expect(rebased.conflicts).toMatchObject([{domain:'pairs',field:'grouping',local:'cut',remote:'link'}]);
 expect((await read(owner)).links).toEqual(['["a","b"]']);expect(pending.pairs[0].relation).toBe('cut');
});

const selectiveOwner='99999999-9999-4999-8999-999999999999';
const selectiveID=i=>`d${String(i).padStart(7,'0')}-0000-4000-8000-000000000000`;
const sqlValue=value=>value===null?'null':Array.isArray(value)?`array[${value.map(sqlValue).join(',')}]::text[]`:typeof value==='string'?`'${value.replaceAll("'","''")}'`:String(value);
const selectiveRPC=async (args,owner=selectiveOwner)=> (await as('authenticated',owner,`select public.journey_metadata_snapshot(${Object.entries({p_owner:owner,...args}).map(([key,value])=>`${key}=>${sqlValue(value)}`).join(',')}) as data`)).rows[0].data;
it('selectively lists a 5000-activity account without downloading historical geometry',async()=>{
 await db.exec(`reset role; insert into auth.users values('${selectiveOwner}','{}');
  insert into public.journey_metadata_state(owner_id,enrich_from,revision) values('${selectiveOwner}',1700000000000,1);
  alter table public.activities disable trigger journey_activity_change;
  insert into public.activities(id,owner_id,title,activity,recording_mode,started_at,ended_at,distance_meters,duration_seconds,route_points)
   select ('d'||lpad(i::text,7,'0')||'-0000-4000-8000-000000000000')::uuid,'${selectiveOwner}','Walk '||i,'Walking','manual',
    '2026-11-08T10:00:00Z'::timestamptz-i*interval '1 day','2026-11-08T11:00:00Z'::timestamptz-i*interval '1 day',1000,3600,
    '[{"latitude":-34,"longitude":151,"timestamp":1},{"latitude":-34.01,"longitude":151.01,"timestamp":2}]'::jsonb from generate_series(0,4999) i;
  alter table public.activities enable trigger journey_activity_change;
  insert into public.journey_activity_metadata(owner_id,ref,enriched_at) select '${selectiveOwner}',id::text,1700000000001 from public.activities where owner_id='${selectiveOwner}';
  insert into public.journey_road_metadata(owner_id,ref,record) select '${selectiveOwner}',id::text||':1:2',jsonb_build_object('line',repeat('x',2000),'distanceMeters',2000,'status','route','version',1) from public.activities where owner_id='${selectiveOwner}';`);
 const today=await selectiveRPC({p_refs:[],p_list:true,p_from:'2026-11-08T00:00:00Z',p_to:'2026-11-09T00:00:00Z'});
 expect(today.pageRefs).toEqual([selectiveID(0)]);expect(today.activityRows).toHaveLength(1);
 expect(today.activityRows[0].route_points).toBeNull();expect(today.roads).toEqual({});expect(today.places).toEqual({});
 expect(JSON.stringify(today).length).toBeLessThan(10000);
 const first=await selectiveRPC({p_refs:[],p_list:true});
 expect(first.pageRefs).toHaveLength(50);expect(first.activityRows).toHaveLength(50);expect(first.nextActivity.id).toBe(selectiveID(49));
 const second=await selectiveRPC({p_refs:[],p_list:true,p_before:first.nextActivity.at,p_before_id:first.nextActivity.id,p_before_metric:first.nextActivity.metric});
 expect(second.pageRefs[0]).toBe(selectiveID(50));expect(second.pageRefs).toHaveLength(50);
 const detail=await selectiveRPC({p_refs:[selectiveID(4999)],p_detail_refs:[selectiveID(4999)],p_geometry:true});
 expect(Object.keys(detail.roads)).toEqual([selectiveID(4999)+':1:2']);expect(detail.activityRows[0].route_points).toHaveLength(2);
 expect(detail.scope).toEqual([selectiveID(4999)]);
},30000);

it('returns cursor-paged invalidations and retains deletion tombstones without historical payloads',async()=>{
 const before=(await selectiveRPC({p_refs:[]})).revision;
 await mine(selectiveOwner,{activities:[{ref:selectiveID(0),title:'Changed on A'},{ref:selectiveID(1),title:'Second rename'}]},before);
 let first=await selectiveRPC({p_refs:[],p_since_revision:before,p_limit:1});
 expect(first.invalidations).toHaveLength(1);expect(first.next).toBeTruthy();expect(first.activityRows).toEqual([]);expect(first.roads).toEqual({});
 const second=await selectiveRPC({p_refs:[],p_since_revision:before,p_limit:1,p_at_revision:first.atRevision,p_cursor:first.next});
 expect(second.invalidations).toHaveLength(1);expect(second.next).toBeNull();
 await mine(selectiveOwner,{roads:[{ref:selectiveID(0)+':1:2',delete:true}]},first.revision);
 first=await selectiveRPC({p_refs:[],p_since_revision:first.revision});
 expect(first.invalidations).toMatchObject([{domain:'roads',deleted:true}]);expect(JSON.stringify(first).length).toBeLessThan(2000);
});

it('closes merged/split/source context across dates and page boundaries',async()=>{
 const revision=(await selectiveRPC({p_refs:[]})).revision;
 await mine(selectiveOwner,{pairs:[{relation:'link',left:selectiveID(49),right:selectiveID(50)},{relation:'source',left:selectiveID(50),right:selectiveID(51)},{relation:'cut',left:selectiveID(51),right:selectiveID(52)}],stops:[{ref:JSON.stringify([selectiveID(49),selectiveID(50)]),name:'Across dates'}]},revision);
 const scoped=await selectiveRPC({p_refs:[selectiveID(49)]});
 expect(new Set(scoped.scope)).toEqual(new Set([selectiveID(49),selectiveID(50),selectiveID(51)]));
 expect(scoped.activityRows).toHaveLength(3);expect(scoped.links).toEqual([JSON.stringify([selectiveID(49),selectiveID(50)])]);
 expect(scoped.cuts).toEqual([JSON.stringify([selectiveID(51),selectiveID(52)])]);
 expect(scoped.stopEdits[JSON.stringify([selectiveID(49),selectiveID(50)])].name).toBe('Across dates');
 await expect(selectiveRPC({p_refs:[selectiveID(0)]},a)).resolves.toMatchObject({activityRows:[],roads:{}});
 await expect(as('authenticated',a,`select public.journey_metadata_snapshot('${selectiveOwner}',array['${selectiveID(0)}'])`)).rejects.toThrow('owner mismatch');
});

it('publishes idempotent segments from a private activity without revealing the activity',async()=>{
 const id='e0000000-0000-4000-8000-000000000001';
 const geometry=JSON.stringify(Array.from({length:10},(_,i)=>[-34+i*0.0001,151]));
 const proposal=`select public.create_mtb_segment(p_client_id=>'${id}',p_name=>'Shared selected descent',p_geometry=>'${geometry}'::jsonb,p_distance_meters=>100) as id`;
 expect((await as('authenticated',a,proposal)).rows[0].id).toBe(id);
 expect((await as('authenticated',a,proposal)).rows[0].id).toBe(id);
 // Published at once: no moderation step.
 expect((await as('authenticated',a,`select status,visibility from public.mtb_segments where id='${id}'`)).rows[0]).toEqual({status:'approved',visibility:'public'});
 expect((await as('authenticated',b,`select id from public.mtb_segments where id='${id}'`)).rows).toEqual([{id}]);
 await expect(as('authenticated',b,proposal)).rejects.toThrow('another creator');
 await expect(as('anon','',proposal)).rejects.toThrow();
 // A replacement client and another ordinary user discover the same permanent row.
 const publicRows=(await as('authenticated',selectiveOwner,`select * from public.mtb_segments_in_bbox(-34.1,-33.9,150.9,151.1)`)).rows;
 expect(publicRows.some(row=>row.id===id&&row.status==='approved'&&row.visibility==='public')).toBe(true);
 const shared=publicRows.find(row=>row.id===id);
 expect(shared.geometry).toEqual(JSON.parse(geometry));
 expect(JSON.stringify(shared)).not.toMatch(/route_points|heartRate|energy|timestamp|privateActivity/);
 expect((await as('authenticated',selectiveOwner,`select id from public.activities where owner_id='${a}'`)).rows).toEqual([]);
 expect((await as('authenticated',a,proposal)).rows[0].id).toBe(id);
 // The creator renaming on the device edits the same segment; the route is unchanged.
 expect((await as('authenticated',a,proposal.replace('Shared selected descent','Renamed descent'))).rows[0].id).toBe(id);
 expect((await as('authenticated',b,`select name from public.mtb_segments where id='${id}'`)).rows[0].name).toBe('Renamed descent');
 expect(Number((await as('service_role','',`select count(*) from public.mtb_segment_geometry where segment_id='${id}'`)).rows[0].count)).toBe(1);
});

it('cleans metadata only for an actual cloud recording deletion and journals all removed records',async()=>{
 const id=selectiveID(49),peer=selectiveID(50);
 await mine(selectiveOwner,{activities:[{ref:id,title:'Delete me'}],roads:[{ref:`${id}:1:2`,record:{line:'saved'}}],summaries:[{ref:id,snapshot:{pointCount:2}}],stops:[{ref:`native:${id}:1`,name:'Stop'}],pairs:[{relation:'source',left:id,right:peer}]});
 const before=(await as('authenticated',selectiveOwner,revision(selectiveOwner))).rows[0].revision;
 await as('authenticated',selectiveOwner,`delete from public.activities where id='${id}'`);
 const scoped=await selectiveRPC({p_refs:[id],p_detail_refs:[id]});
 expect(scoped.unavailableRefs).toContain(id);expect(scoped.titles[id]).toBeUndefined();expect(scoped.roads[`${id}:1:2`]).toBeUndefined();expect(scoped.distanceSummaries[id]).toBeUndefined();expect(scoped.stopEdits[`native:${id}:1`]).toBeUndefined();
 const changed=await selectiveRPC({p_refs:[],p_since_revision:before});
 expect(changed.invalidations).toContainEqual(expect.objectContaining({domain:'activityRows',ref:id,deleted:true}));
 expect(changed.invalidations).toContainEqual(expect.objectContaining({domain:'activities',ref:id,deleted:true}));
});

it('reapplies selective/cache and segment migrations without removing saved records',async()=>{
 await as('service_role','',`select 1`);
 const before=(await db.query(`select count(*) from public.journey_road_metadata`)).rows;
 await db.exec('reset role');
 for(const file of ['20261121000000_selective_journey_cache.sql','20261122000000_mtb_segment_persistence.sql'])await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
 expect((await db.query(`select count(*) from public.journey_road_metadata`)).rows).toEqual(before);
});

it('uses the real scoped engine for idle-device discovery, offline field merges and preserved same-field conflicts',async()=>{
 const {createJourneySync,runJourneySync}=await import('../../src/lib/journeyMetadataStore.js');
 const {groupingChanges}=await import('../../src/lib/journeyMetadata.js');
 const owner='85858585-8585-4585-8585-858585858585',id=selectiveID(7000),calls=[];
 await db.exec(`reset role;insert into auth.users values('${owner}','{}');insert into public.activities(id,owner_id,title,activity,recording_mode,started_at,ended_at,duration_seconds,distance_meters,route_points) values('${id}','${owner}','Original','Walking','manual','2026-11-08T00:00:00Z','2026-11-08T01:00:00Z',3600,100,'[]')`);
 const client={rpc:async(name,args)=>{calls.push({name,args});try{return {data:(await as('authenticated',owner,`select public.${name}(${Object.entries(args).map(([key,value])=>`${key}=>${key==='p_changes'?`$json$${JSON.stringify(value)}$json$::jsonb`:sqlValue(value)}`).join(',')}) as data`)).rows[0].data};}catch(error){return {error};}},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null})})})})};
 const makeDevice=()=>{let rows={};return createJourneySync({owner,preferences:{},savePreferences:async()=>{},storage:{read:async()=>structuredClone(rows),commit:async ops=>{const next=structuredClone(rows);for(const op of ops)if(op.remove)delete next[op.key];else next[op.key]=structuredClone(op.value);rows=next;}}});};
 const A=makeDevice(),B=makeDevice();await A.ready();await B.ready();A.configureScope([id]);B.configureScope([id]);
 const sync=device=>runJourneySync({client,owner,...device});
 expect((await sync(A)).state).toBe('active');expect((await sync(B)).state).toBe('active');
 const edit=async(device,patch)=>device.write(latest=>{const metadata={...latest.metadata,...patch};return {metadata,queue:groupingChanges(latest.metadata,metadata)};});
 await edit(A,{titles:{[id]:'From A'}});expect((await sync(A)).state).toBe('active');
 expect(B.read().queue).toEqual({});expect((await sync(B)).state).toBe('active');expect(B.read().metadata.titles[id]).toBe('From A');
 // Both start from the same cloud baseline, then make independent offline fields.
 await edit(A,{titles:{[id]:'Second title'}});await edit(B,{manualTags:{[id]:['offline tag']}});
 await sync(A);expect((await sync(B)).state).toBe('active');await sync(A);
 expect(A.read().metadata.titles[id]).toBe('Second title');expect(A.read().metadata.manualTags[id]).toEqual(['offline tag']);
 await edit(A,{titles:{[id]:'First conflicting value'}});await edit(B,{titles:{[id]:'Second conflicting value'}});
 await sync(A);expect((await sync(B)).error).toContain('.title');
 expect(B.read().queue.activities[0].title).toBe('Second conflicting value');
 expect((await selectiveRPC({p_refs:[id]},owner)).titles[id]).toBe('First conflicting value');
 expect(calls.filter(call=>call.name==='journey_metadata_snapshot').every(call=>Array.isArray(call.args.p_refs))).toBe(true);
 // Once settled, an idle device needs only the revision, no historical snapshot.
 await sync(A);calls.length=0;await sync(A);expect(calls.map(call=>call.name)).toEqual(['journey_metadata_revision']);
});

it('invalidates saved home places and private photo descriptors independently of local activity edits',async()=>{
 const id=selectiveID(0),place='c1000000-0000-4000-8000-000000000001',photo='c2000000-0000-4000-8000-000000000001';
 const before=(await as('authenticated',selectiveOwner,revision(selectiveOwner))).rows[0].revision;
 await as('authenticated',selectiveOwner,`insert into public.saved_places(id,owner_id,name,kind,latitude,longitude,radius) values('${place}','${selectiveOwner}','My home','home',-34,151,100)`);
 await as('service_role','',`insert into public.media_assets(id,owner_id,activity_id,object_key,byte_size,mime_type) values('${photo}','${selectiveOwner}','${id}','${selectiveOwner}/${id}/${photo}.jpg',100,'image/jpeg')`);
 const changed=await selectiveRPC({p_refs:[],p_since_revision:before});
 // Saving a place touches every activity's updated_at; that must not journal the whole history.
 expect(changed.revision-before).toBeLessThan(5);expect(changed.invalidations.length).toBeLessThan(5);
 expect(changed.invalidations).toContainEqual(expect.objectContaining({domain:'savedPlaces',ref:place}));
 expect(changed.invalidations).toContainEqual(expect.objectContaining({domain:'activityRows',ref:id}));
 expect((await selectiveRPC({p_refs:[]})).savedPlaces).toContainEqual(expect.objectContaining({id:place,name:'My home'}));
 expect((await selectiveRPC({p_refs:[id],p_detail_refs:[id],p_geometry:true})).activityRows[0].photos).toContainEqual(expect.objectContaining({id:photo}));
 await expect(selectiveRPC({p_refs:[],p_since_revision:0,p_limit:null})).rejects.toThrow('scope is too large');
});

it('syncs a private Gym classification and preserves owner access',async()=>{
 await db.exec('reset role');
 await db.exec(await readFile('supabase/migrations/20261128000000_gym_activity.sql','utf8'));
 await mine(a,{activities:[{ref:'gym-session',title:'Gym cardio',type:'Gym'}]});
 expect((await as('authenticated',a,"select type from public.journey_activity_metadata where ref='gym-session'")).rows).toEqual([{type:'Gym'}]);
 expect((await as('authenticated',b,"select type from public.journey_activity_metadata where ref='gym-session'")).rows).toEqual([]);
});
