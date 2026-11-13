import {webcrypto} from 'node:crypto';
import {beforeEach,describe,expect,it,vi} from 'vitest';

// What survives the existing cloud backup and restore for the three kinds of stop.
// Runs the real syncPrivateActivities and restoreCloudJournal against an in-memory
// Supabase: rows written by the backup are what the restore reads.
const cloud=vi.hoisted(()=>({rows:[],restored:[],known:[]}));
vi.mock('./supabase.js',()=>{
 const query=table=>{
  const chain={select:()=>chain,eq:()=>chain,is:()=>chain,order:()=>chain,limit:()=>chain,
   maybeSingle:()=>Promise.resolve({data:null,error:null}),
   then:resolve=>resolve({data:table==='activities'?cloud.rows:[],error:null})};
  return chain;
 };
 return {supabase:{auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null})},from:query,functions:{invoke:async()=>({data:null,error:null})}}};
});
vi.mock('./recorder.js',()=>({recorder:{getState:async()=>({ownerID:'owner',trips:cloud.known}),restoreActivity:async activity=>{cloud.restored.push(activity);return {restored:true};},restorePhoto:async()=>({restored:false})}}));
const {syncPrivateActivities}=await import('./cloudSync.js');
const {restoreCloudJournal}=await import('./cloudRestore.js');
const {backupClassification}=await import('./stopBackup.js');

const fix=(t,segment=0,latitude=-33.87+t/1e6)=>({latitude,longitude:151.2,timestamp:t,accuracy:5,altitude:20,speed:12,segment});
const drive=(id,start,end,points,details={})=>({id,title:'Driving',activity:'Driving',source:'device',recordingMode:'automatic',startedAt:start,endedAt:end,
 durationSeconds:points.length?points.at(-1).timestamp-points[0].timestamp-(details.stoppedSeconds||0):0,distanceMeters:2000,points,state:'finished',details});
// Home -> shop: a destination; the drive home is its own activity.
const outbound=drive('out',1000,1200,[fix(1000),fix(1100),fix(1200)],{destinationStop:{start:1200,end:2100,verdict:'meaningfulDestination',confidence:'high',reasons:['stopped 15 min']}});
const homeward=drive('back',2100,2300,[fix(2100),fix(2200),fix(2300)]);
// One drive that kept a traffic pause and a possible destination as segment breaks.
const continued=drive('round',5000,7600,[fix(5000),fix(5100),fix(5400,1),fix(5500,1),fix(6400,2),fix(7600,2)],{stoppedSeconds:1100,
 stops:[{start:5100,end:5400,verdict:'temporaryPause',confidence:'high',reasons:['vehicle motion for 120s during the stop: congestion or creeping traffic']},
        {start:5500,end:6400,verdict:'ambiguous',confidence:'low',reasons:['stopped 15 min','no walking, visit or on-foot evidence; the phone may have stayed in the vehicle']}]});

describe('stop metadata through cloud backup and restore',()=>{
 beforeEach(()=>{cloud.rows=[];cloud.restored=[];cloud.known=[];});
 it('keeps destination, temporary and ambiguous verdicts with timing, reasons and route breaks',async()=>{
  const rpc=vi.fn(async(name,{p_payload})=>{cloud.rows.push({...p_payload,sync_fingerprint:'f',revision:1});return {data:1,error:null};});
  const client={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from:()=>{const c={upsert:()=>c,delete:()=>c,eq:()=>c,then:r=>r({error:null})};return c;},rpc};
  await syncPrivateActivities(client,{ownerID:'owner',trips:[outbound,homeward,continued],places:[]},{},{cryptoImpl:webcrypto});
  // The backup schema accepts only five view keys; stop verdicts are not among them.
  for(const row of cloud.rows)expect(Object.keys(row.view_metadata).every(key=>['visibleRouteStart','visibleRouteEnd','startPlace','endPlace','coverPhotoID'].includes(key))).toBe(true);
  await restoreCloudJournal();
  const byID=Object.fromEntries(cloud.restored.map(a=>[a.id,a]));
  // Destination: both legs come back as separate activities with their own times.
  expect([byID.out?.startedAt,byID.out?.endedAt,byID.back?.startedAt,byID.back?.endedAt]).toEqual([1000,1200,2100,2300]);
  expect(byID.out.points.map(p=>p.timestamp)).toEqual([1000,1100,1200]);
  expect(byID.back.points[0].timestamp).toBe(2100);
  // Continued drive: the stops stay as segment breaks and moving time still excludes them.
  expect(byID.round.points.map(p=>p.segment)).toEqual([0,0,1,1,2,2]);
  expect(byID.round.accumulatedSeconds).toBe(continued.durationSeconds);
  expect(byID.round.accumulatedSeconds).toBe(2600-1100);
  expect(byID.round.details.stops).toEqual(continued.details.stops);
  expect(byID.out.details.destinationStop).toEqual(outbound.details.destinationStop);
  expect(byID.round.details.classification).toEqual({predicted:'Unknown',confidence:'low',evidence:[]});
  expect(byID.round.details.classification.journeyStops).toBeUndefined();
 });
 it('restores legacy classification unchanged and ignores malformed or future envelopes',async()=>{
  const classification={predicted:'Driving',confidence:'high',evidence:['GPS speed']};
  const row={id:'legacy',activity:'Driving',recording_mode:'automatic',started_at:new Date(1000*1000).toISOString(),ended_at:new Date(2000*1000).toISOString(),route_points:[fix(1000),fix(2000)],classification};
  cloud.rows=[row,{...row,id:'bad',classification:{...classification,journeyStops:{version:1,stops:[{start:1500,end:1400},{start:900,end:1100},{start:1400,end:Infinity}],destinationStop:{start:'1500',end:2100}}}},
   {...row,id:'future',classification:{...classification,journeyStops:{version:2,stops:continued.details.stops}}}];
  await restoreCloudJournal();
  for(const activity of cloud.restored){
   expect(activity.details.classification).toEqual(classification);
   expect(activity.details.stops).toBeUndefined();
   expect(activity.details.destinationStop).toBeUndefined();
  }
 });
 it('bounds annotations, preserves the normal classifier and never uploads transient evidence',()=>{
  const stop={start:1200,end:1500,verdict:'ambiguous',confidence:'low',reasons:['a'.repeat(500),17,...Array(10).fill('reason')]};
  const classification={predicted:'Driving',confidence:'high',evidence:['GPS'],journeyStops:{version:999}};
  const details={classification,stops:Array(1100).fill(stop),stopEvidence:{private:'transient'},provisional:true};
  const backed=backupClassification(details,1000,2000);
  expect(backed.predicted).toBe('Driving');
  expect(backed.evidence).toEqual(['GPS']);
  expect(backed.journeyStops.version).toBe(1);
  expect(backed.journeyStops.stops).toHaveLength(1024);
  expect(backed.journeyStops.stops[0].reasons).toHaveLength(8);
  expect(backed.journeyStops.stops[0].reasons[0]).toHaveLength(300);
  expect(backed.journeyStops.stopEvidence).toBeUndefined();
  expect(backed.journeyStops.provisional).toBeUndefined();
  expect(classification.journeyStops.version).toBe(999);
 });

});

it('does not adopt fresh cloud acknowledgements for activities that already exist locally',async()=>{
 const id='abcdef01-2345-4678-89ab-cdef01234567',missing='11111111-2222-4333-8444-555555555555';
 cloud.known=[{id:id.toUpperCase(),title:'Unreviewed local edit'}];
 const saved={title:'Cloud edit',activity:'Driving',recording_mode:'automatic',started_at:'2026-11-09T00:00:00Z',ended_at:'2026-11-09T01:00:00Z',duration_seconds:3600,distance_meters:1000,route_points:[],classification:{},sync_fingerprint:'a'.repeat(64),revision:11};
 cloud.rows=[{...saved,id},{...saved,id:missing}];
 const result=await restoreCloudJournal();
 expect(result.receipts[id]).toBeUndefined();
 expect(result.receipts[missing]).toMatchObject({revision:11});
 expect(cloud.restored.map(t=>t.id)).toEqual([missing]);
});
