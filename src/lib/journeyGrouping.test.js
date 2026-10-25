import {it,expect} from 'vitest';
import {buildJourneys,emptyGrouping,changeGrouping,placeKey,internalStops,readGrouping} from './journeyGrouping.js';
import {recordedJourney} from './recorder.js';
const owner='owner',vehicles=[{id:'car',name:'Kia'}];
const p=(lat,lon,timestamp=0)=>({latitude:lat,longitude:lon,timestamp,accuracy:5,altitude:0,speed:0,segment:0});
const locations={sydney:p(-33.86,151.2),kew:p(-31.63,152.73),coffs:p(-30.30,153.11),gold:p(-28.0,153.43)};
function drive(id,from,to,start=10000,duration=3600,vehicle='Kia'){
 return recordedJourney({id,source:'device',ownerID:owner,state:'finished',recordingMode:'automatic',activity:'Driving',title:id,vehicle,startedAt:start,endedAt:start+duration,durationSeconds:duration,distanceMeters:100000,points:[{...from,timestamp:start},{...to,timestamp:start+duration}],details:{tags:[],notes:'Original note',userCorrected:true}});
}
function setup(){const a=drive('a',locations.sydney,locations.kew),b=drive('b',locations.kew,locations.coffs,a.endedAt+35*60),c=drive('c',locations.coffs,locations.gold,b.endedAt+45*60);const meta=emptyGrouping(owner);for(const [name,p] of Object.entries(locations))meta.places[placeKey(p)]={locality:{sydney:'Sydney',kew:'Kew',coffs:'Coffs Harbour',gold:'Gold Coast'}[name],possibleCharging:name==='kew'};return {activities:[a,b,c],meta};}
const build=(activities,metadata,extra={})=>buildJourneys(activities,{owner,metadata,vehicles,places:[],...extra});
it('groups Sydney → Kew → Coffs Harbour → Gold Coast with preserved original segments',()=>{
 const {activities,meta}=setup(),before=JSON.stringify(activities);const result=build(activities,meta);
 expect(result.journeys).toHaveLength(1);const j=result.journeys[0];expect(j.title).toBe('Driving to Gold Coast');expect(j.segmentIDs).toEqual(['a','b','c']);expect(j.stops.map(s=>s.name)).toEqual(['Kew','Coffs Harbour']);expect(j.stops[0].charging).toBe('possible');expect(j.distanceMeters).toBe(300000);expect(j.durationSeconds).toBe(10800);expect(j.searchIndex).toContain('kew');expect(j.tags).toContain('Kew');expect(j.routeSegments).toHaveLength(3);expect(JSON.stringify(activities)).toBe(before);expect(j.segments[0]).toBe(activities[0]);
});
it('reprocessing, reordered input and duplicate sync deliveries are idempotent',()=>{
 const {activities,meta}=setup();const expected=build(activities,meta);expect(build([...activities].reverse(),meta)).toEqual(expected);expect(build([...activities,...activities],meta)).toEqual(expected);
 const earlier=build(activities.slice(0,2),meta).journeys[0];expect(expected.journeys[0].id).toBe(earlier.id);
});
it('never auto-combines unknown or different vehicles and excludes household owners',()=>{
 const {activities,meta}=setup();expect(build(activities.map(t=>({...t,vehicle:null})),meta).journeys).toHaveLength(3);expect(build(activities.map(t=>({...t,vehicle:null})),meta).suggestions).toHaveLength(2);
 expect(build([activities[0],{...activities[1],vehicleID:'different'}],meta).journeys).toHaveLength(2);
 expect(build([activities[0],{...activities[1],ownerID:'wife'}],meta).journeys).toHaveLength(1);expect(build([activities[0],{...activities[1],ownerID:undefined,owner_id:'wife'}],meta).journeys).toHaveLength(1);
});
it('does not merge an eight-hour work stop, a home stop or disconnected locations',()=>{
 const {activities:[a,b],meta}=setup();expect(build([a,{...b,startedAt:a.endedAt+8*3600,endedAt:a.endedAt+9*3600}],meta).journeys).toHaveLength(2);
 const work={...locations.kew,name:'Work',kind:'work',radius:100};expect(build([a,b],meta,{places:[work]}).suggestions).toHaveLength(0);expect(build([a,b],meta,{places:[work]}).journeys).toHaveLength(2);
 expect(build([a,b],meta,{places:[{...work,kind:'home'}]}).journeys).toHaveLength(2);
 const disconnected={...b,points:[locations.gold,...b.points.slice(1)]};expect(build([a,disconnected],meta).journeys).toHaveLength(2);
});
it('suggests overnight continuation and supports explicit merging without changing telemetry',()=>{
 const {activities:[a,b],meta}=setup();const later={...b,startedAt:a.endedAt+12*3600,endedAt:a.endedAt+13*3600};const raw=[a,later],context={activities:raw,owner,vehicles};expect(build(raw,meta).suggestions[0].reason).toContain('overnight');const next=changeGrouping(meta,{type:'merge',ids:['a','b']},context);expect(build(raw,next).journeys).toHaveLength(1);expect(raw[0].points).toEqual(a.points);
});
it('split survives re-evaluation, manual rename is retained, and undo restores grouping',()=>{
 const {activities,meta}=setup(),context={activities,owner,vehicles};let next=changeGrouping(meta,{type:'rename',anchor:'a',title:'Our coast adventure'},context);expect(build(activities,next).journeys[0].title).toBe('Our coast adventure');next=changeGrouping(next,{type:'split',after:'a',before:'b'},context);expect(build(activities,next).journeys).toHaveLength(2);expect(build(activities,next).journeys.find(j=>j.segmentIDs)?.segmentIDs).toEqual(['b','c']);next=changeGrouping(next,{type:'undo'},context);expect(build(activities,next).journeys[0].title).toBe('Our coast adventure');expect(build(activities,next).journeys[0].segmentIDs).toEqual(['a','b','c']);
});
it('manual stop corrections enter the search index and undo never touches GPS data',()=>{
 const {activities,meta}=setup(),context={activities,owner,vehicles};const stop=build(activities,meta).journeys[0].stops[0];const next=changeGrouping(meta,{type:'stop',id:stop.id,name:'Kew lookout',tags:['Scenic break']},context);const j=build(activities,next).journeys[0];expect(j.searchIndex).toContain('scenic break');expect(j.searchIndex).toContain('kew lookout');expect(j.tags).toContain('Kew');expect(build(activities,changeGrouping(next,{type:'undo'},context)).journeys[0].stops[0].name).toBe('Kew');
});
it('nearby charging infrastructure is never confirmed without verified owner/vehicle telemetry',()=>{
 const {activities,meta}=setup();const event={...locations.kew,type:'charging',ownerID:owner,vehicleID:'car',verified:true,startedAt:activities[0].endedAt,endedAt:activities[1].startedAt};expect(build(activities,meta,{telemetry:[event]}).journeys[0].stops[0].charging).toBe('confirmed');for(const change of [{ownerID:'wife'},{vehicleID:'other'},{verified:false},{...locations.gold}])expect(build(activities,meta,{telemetry:[{...event,...change}]}).journeys[0].stops[0].charging).toBe('possible');
});
it('ignores traffic lights but recognises a sustained lookout dwell without editing the segment',()=>{
 const {meta}=setup(),context={owner,metadata:meta,places:[],vehicles,telemetry:[]};const t=drive('lookout',locations.kew,locations.coffs);t.points=Array.from({length:7},(_,i)=>({...locations.kew,timestamp:10000+i*60}));expect(internalStops(t,context)).toHaveLength(1);expect(internalStops({...t,points:t.points.slice(0,3)},context)).toHaveLength(0);
});
it('manual merge cannot cross owners, vehicles, overlaps or non-consecutive drives',()=>{
 const {activities,meta}=setup();const context={activities,owner,vehicles};expect(()=>changeGrouping(meta,{type:'merge',ids:['a','c']},context)).toThrow('consecutive');expect(()=>changeGrouping(meta,{type:'merge',ids:['a','foreign']},context)).toThrow();expect(()=>changeGrouping(meta,{type:'merge',ids:['a','b']},{...context,activities:[activities[0],{...activities[1],vehicleID:'other'}]})).toThrow('vehicles');expect(()=>changeGrouping(meta,{type:'merge',ids:['a','b']},{...context,activities:[activities[0],{...activities[1],startedAt:activities[0].startedAt}]})).toThrow();
});
it('local walking at lunch stays intact without breaking a high-confidence driving journey',()=>{
 const {activities,meta}=setup();const walk={...drive('walk',locations.kew,locations.kew,activities[0].endedAt+60,600),activity:'Walking'};const result=build([...activities,walk],meta);expect(result.journeys).toHaveLength(2);expect(result.journeys.find(j=>j.isGroupedJourney).segmentIDs).toEqual(['a','b','c']);expect(result.journeys.find(j=>j.id==='walk').points).toBe(walk.points);
});
it('rejects foreign saved metadata and has no unscoped grouping fallback',()=>{
 const {activities,meta}=setup();expect(readGrouping(JSON.stringify(meta),'wife')).toEqual(emptyGrouping('wife'));expect(buildJourneys(activities,{}).journeys).toHaveLength(0);expect(()=>changeGrouping(meta,{type:'rename',anchor:'a',title:'No'},{owner:'wife',activities,vehicles})).toThrow('Account');
});
it('preserves a manual split even when a delayed segment arrives inside the boundary',()=>{
 const {activities:[a,b],meta}=setup(),context={activities:[a,b],owner,vehicles};const split=changeGrouping(meta,{type:'split',after:a.id,before:b.id},context);
 const mid=drive('delayed',locations.kew,locations.kew,a.endedAt+300,600);
 const result=build([a,mid,b],split);expect(result.journeys).toHaveLength(3);
});
it('preserves titles on both sides and suggests instead of automatically combining differently named journeys',()=>{
 const {activities,meta}=setup();meta.titles.a='Family holiday';meta.titles.c='Weekend escape';const result=build(activities,meta);expect(result.journeys).toHaveLength(2);expect(result.journeys.map(j=>j.title)).toEqual(['Family holiday','Weekend escape']);expect(result.suggestions[0].reason).toContain('titles');
});
it('retains original segment titles, corrections, notes and route gaps after merge and undo',()=>{
 const {activities,meta}=setup();activities[0].title='My custom segment';activities[0].routeSegments=[[[-33,151]],[[-32,152]]];activities[0].notes='Keep me';const before=structuredClone(activities),context={activities,owner,vehicles};const merged=changeGrouping(meta,{type:'merge',ids:['a','b','c']},context);expect(build(activities,merged).journeys[0].segments[0].title).toBe('My custom segment');expect(build(activities,merged).journeys[0].routeSegments).toHaveLength(4);changeGrouping(merged,{type:'undo'},context);expect(activities).toEqual(before);
});
it('lets users remove inferred stop tags or dismiss a congestion stop and undo the decision',()=>{
 const {activities,meta}=setup(),context={activities,owner,vehicles};const stop=build(activities,meta).journeys[0].stops[0];let next=changeGrouping(meta,{type:'stop',id:stop.id,name:'Break',tags:['My stop'],replaceTags:true},context);expect(build(activities,next).journeys[0].stops[0].tags).toEqual(['My stop']);next=changeGrouping(next,{type:'stop',id:stop.id,name:'Break',tags:[],ignored:true},context);expect(build(activities,next).journeys[0].stops.some(s=>s.id===stop.id)).toBe(false);expect(build(activities,changeGrouping(next,{type:'undo'},context)).journeys[0].stops.some(s=>s.id===stop.id)).toBe(true);
});
