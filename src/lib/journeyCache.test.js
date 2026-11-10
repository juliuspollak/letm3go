import {expect,it} from 'vitest';
import {emptyGrouping} from './journeyGrouping.js';
import {cachedScope,emptyJourneyCache,invalidateJourneyCache,mergeScope,scopeKey,trimJourneyCache} from './journeyCache.js';
// The journey cache is a bounded, read-only copy of Supabase's records. Supabase's values
// always replace it; nothing in it is ever sent back.
const owner='owner',now=1800000000000;
const scope=(ids,at=now)=>({ids,details:ids,places:[],at,revision:1,stale:false});
const state=()=>({metadata:emptyGrouping(owner),activityRows:{},cache:emptyJourneyCache(),status:{owner,revision:1,cursorRevision:1}});
it('evicts the oldest scopes first, keeping the one in view and unfinished enrichment',()=>{
 const s=state();s.metadata.titles={old:'old',view:'view',work:'work',recent:'recent'};
 s.metadata.roads={'old:1:2':{line:'old'},'view:1:2':{line:'x'.repeat(1000000)},'work:1:2':{line:'work'}};
 s.cache.active=['view'];s.cache.work.work={state:'pending'};
 for(const [i,id] of ['old','view','work','recent'].entries()){s.cache.scopes[id]=scope([id],now-i);s.activityRows[id]={id,route_points:[{latitude:1,longitude:2}]};}
 const trimmed=trimJourneyCache(s,{maxActivities:1,maxBytes:100,now});
 expect(trimmed.metadata.titles).toEqual({view:'view',work:'work'});
 expect(trimmed.metadata.roads['view:1:2'].line).toHaveLength(1000000);
 expect(Object.keys(trimmed.activityRows).sort()).toEqual(['view','work']);
 // Once enrichment is finished and the view moves on, they are ordinary cache entries too.
 expect(Object.keys(trimJourneyCache({...trimmed,cache:{...trimmed.cache,active:[],work:{work:{state:'done'}}}},{maxActivities:0,maxBytes:0,now}).metadata.roads)).toEqual([]);
});
it('replaces cached records with Supabase’s, keeping fetched detail the list refresh lacks',()=>{
 const s=state(),metadata={...emptyGrouping(owner),titles:{a:'Cloud'},distanceSummaries:{a:{updatedAt:1,pointCount:2,summary:{gaps:[]}}}};
 s.activityRows.a={id:'a',revision:4,route_points:[{latitude:1,longitude:2}]};s.metadata.distanceSummaries.a=metadata.distanceSummaries.a;
 s.metadata.titles.a='Stale local title';s.metadata.roads['a:1:2']={line:'saved'};
 const fetched={metadata:{...metadata,distanceSummaries:{a:{...metadata.distanceSummaries.a,listOnly:true}}},scope:['a'],revision:2,activityRows:[{id:'a',revision:4,route_points:null}],unavailableRefs:[]};
 const merged=mergeScope(s,fetched,['a'],[],now);
 // Supabase wins: a stale cached title never survives a refresh.
 expect(merged.metadata.titles.a).toBe('Cloud');
 expect(merged.activityRows.a.route_points).toHaveLength(1);expect(merged.metadata.roads).toEqual(s.metadata.roads);
 expect(merged.metadata.distanceSummaries.a.listOnly).toBeUndefined();
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
it('keeps the completed enrichment ledger across eviction and the durable row round trip',async()=>{
 const {journeyRows,stateFromJourneyRows}=await import('./journeyMetadataStore.js');
 const s=state();s.cache.work.a={state:'done'};s.metadata.enriched.a=123;s.cache.scopes[scopeKey(['a'])]=scope(['a']);
 const next=trimJourneyCache(s,{maxActivities:0,maxBytes:0,now});expect(next.metadata.enriched.a).toBeUndefined();
 const restored=stateFromJourneyRows(journeyRows(next),owner);expect(restored.cache.work.a.state).toBe('done');
});
