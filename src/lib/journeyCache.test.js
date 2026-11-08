import {expect,it} from 'vitest';
import {emptyGrouping} from './journeyGrouping.js';
import {applyChanges} from './journeyMetadata.js';
import {cachedScope,emptyJourneyCache,invalidateJourneyCache,mergeScope,scopeKey,trimJourneyCache} from './journeyCache.js';
const owner='owner',now=1800000000000;
const scope=(ids,at=now)=>({ids,details:ids,places:[],at,revision:1,stale:false});
const state=()=>({metadata:emptyGrouping(owner),queue:{},activityRows:{},cache:emptyJourneyCache(),status:{owner,migratedAt:now}});
it('evicts only cloud-confirmed scopes, retaining pending edits, large roads and unfinished work',()=>{
 const s=state();s.metadata.titles={old:'old',pending:'pending',work:'work',recent:'recent'};
 s.metadata.roads={'old:1:2':{line:'old'},'pending:1:2':{line:'x'.repeat(1000000)},'work:1:2':{line:'work'}};
 s.queue={activities:[{ref:'pending',title:'pending'}],roads:[{ref:'pending:1:2',record:s.metadata.roads['pending:1:2']}]};
 s.cache.work.work={state:'pending'};
 for(const [i,id] of ['old','pending','work','recent'].entries()){s.cache.scopes[id]=scope([id],now-i);s.activityRows[id]={id,route_points:[{latitude:1,longitude:2}]};}
 const trimmed=trimJourneyCache(s,{maxActivities:1,maxBytes:100,now});
 expect(trimmed.queue).toEqual(s.queue);expect(trimmed.metadata.titles).toEqual({pending:'pending',work:'work'});
 expect(trimmed.metadata.roads['pending:1:2'].line).toHaveLength(1000000);
 expect(Object.keys(trimmed.activityRows).sort()).toEqual(['pending','work']);
 // Once acknowledged/completed these scopes become ordinary cache entries.
 expect(Object.keys(trimJourneyCache({...trimmed,queue:{},cache:{...trimmed.cache,work:{work:{state:'done'}}}},{maxActivities:0,maxBytes:0,now}).metadata.roads)).toEqual([]);
});
it('never evicts migration sources before readback verification',()=>{
 const s=state();s.status.migratedAt=null;s.metadata.titles={old:'only copy'};
 expect(trimJourneyCache(s,{maxActivities:0,maxBytes:0})).toBe(s);
 s.status.migratedAt=now;s.cache.migrationRequired=true;expect(trimJourneyCache(s,{maxActivities:0,maxBytes:0})).toBe(s);
});
it('merges list refreshes without downgrading cached detail and overlays pending decisions',()=>{
 const s=state(),metadata={...emptyGrouping(owner),titles:{a:'Cloud'},distanceSummaries:{a:{updatedAt:1,pointCount:2,summary:{gaps:[]}}}};
 s.activityRows.a={id:'a',revision:4,route_points:[{latitude:1,longitude:2}]};s.metadata.distanceSummaries.a=metadata.distanceSummaries.a;
 s.metadata.roads['a:1:2']={line:'saved'};s.queue={activities:[{ref:'a',title:'Offline title',manualTags:[],hiddenTags:[],type:null,enrichedAt:null}]};
 const fetched={metadata:{...metadata,distanceSummaries:{a:{...metadata.distanceSummaries.a,listOnly:true}}},scope:['a'],revision:2,activityRows:[{id:'a',revision:4,route_points:null}],unavailableRefs:[]};
 const merged=mergeScope(s,fetched,['a'],[],now);
 expect(merged.activityRows.a.route_points).toHaveLength(1);expect(merged.metadata.roads).toEqual(s.metadata.roads);
 expect(merged.metadata.distanceSummaries.a.listOnly).toBeUndefined();expect(merged.metadata.titles.a).toBe('Offline title');
 expect(cachedScope(merged,['a'],[],now)).toBeTruthy();expect(cachedScope(merged,['a'],['a'],now)).toBeUndefined();
});
it('invalidates only affected relationship scopes and leaves their saved values available offline',()=>{
 const s=state();s.metadata.titles={a:'saved'};s.cache.scopes={a:scope(['a','b']),c:scope(['c'])};
 const next=invalidateJourneyCache(s,[{domain:'pairs',ref:JSON.stringify(['link','a','b']),revision:2}]);
 expect(next.cache.scopes.a.stale).toBe(true);expect(next.cache.scopes.c.stale).toBe(false);expect(next.metadata.titles.a).toBe('saved');
});
it('preserves whole merged scopes and removes page cursors whose recordings were evicted',()=>{
 const s=state();s.cache.scopes={merged:scope(['a','b']),older:scope(['c'],now-100)};
 s.cache.pages={current:{ids:['a','b']},old:{ids:['c']}};
 s.activityRows={a:{id:'a'},b:{id:'b'},c:{id:'c'}};
 const next=trimJourneyCache(s,{maxActivities:2,now});expect(Object.keys(next.activityRows)).toEqual(['a','b']);expect(next.cache.pages.old).toBeUndefined();
 expect(cachedScope(next,['a','b'],['a'],now)).toBeTruthy();
});
it('keeps completed enrichment ledger across eviction and durable row round trip',async()=>{
 const {journeyRows,stateFromJourneyRows}=await import('./journeyMetadataStore.js');
 const s=state();s.cache.work.a={state:'done'};s.metadata.enriched.a=123;s.cache.scopes[scopeKey(['a'])]=scope(['a']);
 const next=trimJourneyCache(s,{maxActivities:0,maxBytes:0,now});expect(next.metadata.enriched.a).toBeUndefined();
 const restored=stateFromJourneyRows(journeyRows(next),owner);expect(restored.cache.work.a.state).toBe('done');
});
it('retains pending POIs with no activity association',()=>{
 const s=state();s.queue={places:[{ref:'1,2',lookup:{name:'saved once'}}]};s.metadata=applyChanges(s.metadata,s.queue);
 expect(trimJourneyCache(s,{maxActivities:0,maxBytes:0}).metadata.places['1,2']).toEqual({name:'saved once'});
});
it('refuses a late scoped read while the legacy source is still awaiting cloud verification',()=>{
 const s=state();s.cache.migrationRequired=true;s.metadata.titles.a='Only remaining legacy title';
 expect(()=>mergeScope(s,{scope:['a'],metadata:emptyGrouping(owner),activityRows:[],revision:2},['a'],[])).toThrow('cloud verification');
 expect(s.metadata.titles.a).toBe('Only remaining legacy title');
});
