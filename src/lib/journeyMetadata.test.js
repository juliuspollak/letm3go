// Journey metadata is the record of what the user decided about a grouping, plus the
// enrichment answers saved for its recordings. These tests pin the two properties the
// sync depends on: describing a grouping is stable, and replaying a change set is
// idempotent, so a retried request cannot double anything.
import {describe,it,expect} from 'vitest';
import {emptyGrouping} from './journeyGrouping.js';
import {applyChanges,changesEmpty,clearPushed,describeGrouping,edgePair,fitCache,gapRefs,groupingChanges,
 fitQueue,mergeChanges,migrationChanges,missingRecords,recordCounts,stopRefs,JOURNEY_CACHE_BYTES,JOURNEY_QUEUE_BYTES,JOURNEY_QUEUE_HARD_BYTES,ACTIVITY_TYPES} from './journeyMetadata.js';
const OWNER='owner-1';
const EDGE=JSON.stringify(['a','b']);
const DWELL='dwell:a:1700000000';
const NATIVE='native:c:1700000600';
const GAP='a:1700000000:1700000900';
const LINKED_GAP='linked:b:1700000000:1700000900';
function populated(){
 const m=emptyGrouping(OWNER);
 m.links=[EDGE,JSON.stringify(['b','c'])];
 m.cuts=[JSON.stringify(['c','d'])];
 m.sourceLinks=[['a','linked:a']];
 m.titles={a:'Morning drive',b:'Errands'};
 m.types={a:'Driving',b:'Walking'};
 m.manualTags={a:['work','school']};
 m.hiddenTags={a:['Possible charge']};
 m.enriched={a:1700000000000,b:1700000100000};
 m.stopEdits={[DWELL]:{name:'Cafe',tags:['coffee'],replaceTags:true},[NATIVE]:{ignored:true},[EDGE]:{name:'Lay-by'}};
 m.places={home:{name:'Home',locality:'Zurich',lookedUpAt:1700000000000}};
 m.roads={[GAP]:{version:2,status:'route',distanceMeters:800,line:'abc',lookedUpAt:1700000000000},
  [LINKED_GAP]:{version:2,status:'none',lookedUpAt:1700000400000}};
 m.distanceSummaries={a:{updatedAt:1700000000000,pointCount:120,distanceMeters:5000,visibleRouteStart:null,visibleRouteEnd:null,summary:{gapCount:1,roadGaps:1}}};
 m.enrichFrom=1699999999000;
 return m;
}
describe('keys the grouping already uses',()=>{
 it('reads an edge key as two recording ids',()=>{
  expect(edgePair(EDGE)).toEqual(['a','b']);
  expect(edgePair('not json')).toBeNull();
  expect(edgePair(JSON.stringify(['a']))).toBeNull();
  expect(edgePair(JSON.stringify(['a','']))).toBeNull();
  expect(edgePair(JSON.stringify(['a','b','c']))).toBeNull();
 });
 it('tells a stop inside one recording from a stop between two',()=>{
  expect(stopRefs(DWELL)).toEqual({after:null,before:null,segment:'a'});
  expect(stopRefs(NATIVE)).toEqual({after:null,before:null,segment:'c'});
  expect(stopRefs(EDGE)).toEqual({after:'a',before:'b',segment:null});
  expect(stopRefs('nonsense')).toEqual({after:null,before:null,segment:null});
 });
 it('reads the recording id off a road gap key that may itself contain a colon',()=>{
  expect(gapRefs(GAP)).toBe('a');
  expect(gapRefs(LINKED_GAP)).toBe('linked:b');
  expect(gapRefs('a:1700000000')).toBeNull();
  expect(gapRefs('')).toBeNull();
 });
});
describe('a change set rebuilds the grouping',()=>{
 it('rebuilds every domain from the records alone',()=>{
  const full=populated(),base=emptyGrouping(OWNER);
  const changes=groupingChanges(base,full);
  expect(applyChanges(base,changes)).toEqual(full);
  expect(groupingChanges(full,full)).toEqual({});
  expect(changesEmpty(groupingChanges(full,full))).toBe(true);
 });
 it('is idempotent, so a retried or replayed request cannot double anything',()=>{
  const full=populated(),base=emptyGrouping(OWNER),changes=groupingChanges(base,full);
  expect(applyChanges(applyChanges(base,changes),changes)).toEqual(full);
  expect(applyChanges(full,groupingChanges(full,full))).toEqual(full);
 });
 it('sends a deletion when the user undoes a merge, a split or a stop correction',()=>{
  const before=populated(),changes=groupingChanges(before,emptyGrouping(OWNER));
  expect(changes.pairs.filter(item=>item.delete===true)).toHaveLength(4);
  expect(changes.stops.filter(item=>item.delete===true)).toHaveLength(3);
  const cleared=applyChanges(before,changes);
  expect(cleared.links).toEqual([]);
  expect(cleared.cuts).toEqual([]);
  expect(cleared.sourceLinks).toEqual([]);
  expect(cleared.titles).toEqual({});
  expect(cleared.manualTags).toEqual({});
  expect(cleared.stopEdits).toEqual({});
  // Decided once per account, so there is nothing to undo.
  expect(cleared.enrichFrom).toBe(1699999999000);
 });
 it('keeps a merge and a split of the same pair from both being stored',()=>{
  const meta={...populated(),cuts:[...populated().cuts,EDGE]};
  const merged=applyChanges(emptyGrouping(OWNER),groupingChanges(emptyGrouping(OWNER),meta));
  expect(merged.links).toEqual([JSON.stringify(['b','c'])]);
  expect(merged.cuts).toEqual([JSON.stringify(['c','d']),EDGE]);
 });
});
describe('what the queue holds and forgets',()=>{
 const sent={activities:[{ref:'a',title:'Sent',enrichedAt:1700000000000,enrichmentState:'done',enrichmentVersion:1}]};
 it('keeps the newest value when a record is edited twice before it is sent',()=>{
  const queued=mergeChanges(sent,{activities:[{ref:'a',title:'Edited after the request',enrichedAt:1700000000000,enrichmentState:'done',enrichmentVersion:1}]});
  expect(queued.activities).toHaveLength(1);
  expect(queued.activities[0].title).toBe('Edited after the request');
 });
 it('forgets only the records the cloud confirmed',()=>{
  expect(clearPushed(sent,sent)).toEqual({});
  const edited={activities:[{...sent.activities[0],title:'Edited after the request'}]};
  expect(clearPushed(edited,sent).activities[0].title).toBe('Edited after the request');
 });
});
describe('bringing an existing device into the cloud',()=>{
 it('adds what the cloud lacks and never overwrites what it has',()=>{
  const local=populated(),cloud=emptyGrouping(OWNER);
  cloud.titles={a:'Named on my iPad'};
  const {changes,conflicts}=migrationChanges(local,cloud);
  expect(changes.activities.map(item=>item.ref)).toEqual(['b']);
  expect(changes.activities[0].title).toBe('Errands');
  expect(conflicts.activities).toBe(1);
  expect(changes.enrichFrom).toBe(1699999999000);
  // Once migrated, the same device finds nothing left to add.
  const migrated=applyChanges(cloud,changes);
  expect(changesEmpty(migrationChanges(migrated,migrated).changes)).toBe(true);
  expect(missingRecords(migrated,migrated)).toEqual([]);
 });
 it('lets an account-wide enrichment cutoff set in the cloud win',()=>{
  const local=populated(),cloud={...emptyGrouping(OWNER),enrichFrom:1600000000000};
  const {changes}=migrationChanges(local,cloud);
  expect(changes.enrichFrom).toBeUndefined();
 });
 it('reports everything the cloud is still missing, so nothing is replaced early',()=>{
  const local=populated(),cloud=emptyGrouping(OWNER),{changes}=migrationChanges(local,cloud);
  expect(missingRecords(applyChanges(cloud,changes),cloud).length).toBeGreaterThan(0);
  const missing=missingRecords(applyChanges(cloud,changes),applyChanges(cloud,changes));
  expect(missing).toEqual([]);
 });
});
describe('the device mirror stays inside its limit',()=>{
 it('leaves a grouping that already fits untouched',()=>{
  const meta=populated();
  expect(fitCache(meta)).toEqual({metadata:meta,evicted:0});
 });
 it('drops the oldest derived enrichment before any user decision',()=>{
  const meta=emptyGrouping(OWNER);
  meta.titles={a:'Keep me'};meta.manualTags={a:['work']};meta.stopEdits={[DWELL]:{name:'Cafe'}};
  for(let i=0;i<200;i++)meta.roads[`a:${1700000000+i}:${1700000060+i}`]={version:2,status:'route',distanceMeters:800,
   line:'x'.repeat(200),lookedUpAt:1700000000000+i};
  const {metadata,evicted}=fitCache(meta,20000);
  expect(evicted).toBeGreaterThan(0);
  expect(JSON.stringify(metadata).length).toBeLessThanOrEqual(20000);
  expect(metadata.titles).toEqual({a:'Keep me'});
  expect(metadata.manualTags).toEqual({a:['work']});
  expect(metadata.stopEdits).toEqual({[DWELL]:{name:'Cafe'}});
  // The newest road survives; the oldest went first.
  expect(metadata.roads['a:1700000199:1700000259']).toBeDefined();
  expect(metadata.roads['a:1700000000:1700000060']).toBeUndefined();
  expect(JOURNEY_CACHE_BYTES).toBe(900000);
 });
});
describe('the queue of unsent values stays inside its limit',()=>{
 const road=index=>({ref:`a:${1700000000+index}:${1700000060+index}`,
  record:{version:2,status:'route',distanceMeters:800,line:'x'.repeat(400),lookedUpAt:1700000000000+index}});
 it('leaves a queue that already fits untouched, with nothing reported',()=>{
  const queue={activities:[{ref:'a',title:'Morning drive'}]};
  expect(fitQueue(queue)).toEqual({queue,dropped:{}});
 });
 it('keeps every decision and gives up the oldest recomputable answer first',()=>{
  const decisions={activities:[{ref:'a',title:'Keep me'}],pairs:[{relation:'link',left:'a',right:'b'}],
   stops:[{ref:DWELL,name:'Cafe',tags:['coffee']}],enrichFrom:1699999999000};
  const queue={...decisions,roads:Array.from({length:100},(_,index)=>road(index)),places:[{ref:'1,2',lookup:{kind:'park'}}]};
  const fitted=fitQueue(queue,{limit:20000});
  expect(JSON.stringify(fitted.queue).length).toBeLessThanOrEqual(20000);
  expect(fitted.queue.activities).toEqual(decisions.activities);
  expect(fitted.queue.pairs).toEqual(decisions.pairs);
  expect(fitted.queue.stops).toEqual(decisions.stops);
  expect(fitted.queue.enrichFrom).toBe(decisions.enrichFrom);
  expect(fitted.dropped.roads).toBeGreaterThan(0);
  // Newest first out: the road queued last is still waiting to be sent.
  expect(fitted.queue.roads.at(-1)).toEqual(road(99));
  expect(fitted.queue.roads[0]).not.toEqual(road(0));
  // A place lookup is given up only after every road has gone.
  expect(fitted.dropped.places).toBeUndefined();
 });
 it('reports what it gave up for as long as the queue is unsent',()=>{
  const fitted=fitQueue({roads:Array.from({length:100},(_,index)=>road(index))},{limit:5000,dropped:{roads:7}});
  expect(fitted.dropped.roads).toBeGreaterThan(7);
  // An empty queue has nothing left to report.
  expect(fitQueue({},{dropped:{roads:7}})).toEqual({queue:{},dropped:{}});
 });
 it('keeps a large number of decisions and only bounds them past what the device can store',()=>{
  // 9 000 renames is already far more than anyone makes; it is kept whole, because a
  // decision is never the thing this queue gives up.
  const plenty=Array.from({length:9000},(_,index)=>({ref:`recording-${index}`,title:`Journey number ${index}`}));
  const kept=fitQueue({activities:plenty});
  expect(kept.dropped).toEqual({});
  expect(kept.queue.activities).toHaveLength(9000);
  // Past the size the device refuses outright, the oldest are lost - and counted.
  const absurd=Array.from({length:24000},(_,index)=>({ref:`recording-${index}`,title:`Journey number ${index}`}));
  expect(JSON.stringify({activities:absurd}).length).toBeGreaterThan(JOURNEY_QUEUE_HARD_BYTES);
  const fitted=fitQueue({activities:absurd});
  expect(JSON.stringify(fitted.queue).length).toBeLessThanOrEqual(JOURNEY_QUEUE_HARD_BYTES);
  expect(fitted.dropped.activities).toBeGreaterThan(0);
  // The newest decisions are the ones kept.
  expect(fitted.queue.activities.at(-1).ref).toBe('recording-23999');
 });
});
describe('what one grouping is worth',()=>{
 it('counts one record per activity, pair, stop, place, road and summary',()=>{
  expect(recordCounts(emptyGrouping(OWNER))).toEqual({activities:0,pairs:0,stops:0,places:0,roads:0,summaries:0,enrichFrom:false});
  expect(recordCounts(populated())).toEqual({activities:2,pairs:4,stops:3,places:1,roads:2,summaries:1,enrichFrom:true});
 });
 it('ignores anything the grouping screen could not have produced',()=>{
  const junk={...emptyGrouping(OWNER),titles:{a:'ok',b:'x'.repeat(200)},types:{a:'Teleporting',c:'Driving'},
   manualTags:{a:['fine','t'.repeat(80)]},stopEdits:{[DWELL]:'not an edit'},roads:{a:'nope'},
   links:['nonsense',JSON.stringify(['a','b'])],enriched:{d:'yesterday'}};
  const described=describeGrouping(junk);
  expect(described.activities.get('a')).toMatchObject({title:'ok',type:null,manualTags:['fine'],enrichedAt:null,enrichmentState:'pending'});
  expect(described.activities.get('b').title).toBeNull();
  expect(described.activities.get('c')).toMatchObject({type:'Driving',title:null});
  expect(described.activities.get('d').enrichmentState).toBe('pending');
  expect(described.stops.size).toBe(0);
  expect(described.roads.size).toBe(0);
  expect([...described.pairs.keys()]).toEqual(['link|a|b']);
 });
 it('lists the activity types the app is allowed to store',()=>{
  expect(ACTIVITY_TYPES).toContain('Driving');
  expect(ACTIVITY_TYPES).not.toContain('Teleporting');
 });
});

