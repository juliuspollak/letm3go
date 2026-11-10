// Journey metadata is the record of what the user decided about a grouping, plus the
// enrichment answers saved for its recordings. These tests pin what the Supabase write
// path depends on: describing a grouping is stable, a change set rebuilds it, and
// replaying a change set is idempotent, so a retried request cannot double anything.
import {describe,it,expect} from 'vitest';
import {emptyGrouping} from './journeyGrouping.js';
import {applyChanges,changesEmpty,describeGrouping,edgePair,gapRefs,groupingChanges,mergeChanges,stopRefs,ACTIVITY_TYPES} from './journeyMetadata.js';
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
describe('batches of records',()=>{
 it('keeps the newest value when a record appears twice in one batch',()=>{
  const first={activities:[{ref:'a',title:'First',enrichedAt:1700000000000}]};
  const merged=mergeChanges(first,{activities:[{ref:'a',title:'Second',enrichedAt:1700000000000}]});
  expect(merged.activities).toHaveLength(1);
  expect(merged.activities[0].title).toBe('Second');
 });
 it('sends only the records that changed, with no merge bookkeeping',()=>{
  const before=populated(),after={...before,titles:{...before.titles,a:'Renamed'}};
  const changes=groupingChanges(before,after);
  expect(Object.keys(changes)).toEqual(['activities']);
  expect(changes.activities).toHaveLength(1);
  expect(changes.activities[0]).toMatchObject({ref:'a',title:'Renamed'});
  expect(Object.keys(changes.activities[0]).filter(key=>key.startsWith('_'))).toEqual([]);
  expect(groupingChanges(before,{...before,history:[{note:'local undo only'}]})).toEqual({});
 });
});
describe('what one grouping is worth',()=>{
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
  // Gym is a recordable activity; the server accepts it, so an edit to it must not be dropped.
  expect(ACTIVITY_TYPES).toContain('Gym');
  expect(applyChanges(emptyGrouping(OWNER),{activities:[{ref:'g',type:'Gym'}]}).types).toEqual({g:'Gym'});
  expect(ACTIVITY_TYPES).not.toContain('Teleporting');
 });
});
