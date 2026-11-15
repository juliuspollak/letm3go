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
const build=(activities,metadata,extra={})=>buildJourneys(activities,{owner,metadata,vehicles,places:[],autoGroup:true,...extra});
it('shows a stop the native recorder kept inside one drive, so a round trip never hides it',()=>{
 const home=p(-33.86,151.2),shop=p(-33.80,151.25);
 const t=drive('round',home,home,10000,3600);
 t.points=[{...home,timestamp:10000},{...shop,timestamp:10600},{...shop,timestamp:10600+900,segment:1},{...home,timestamp:13600,segment:1}]; t.visibleRouteStart=0;t.visibleRouteEnd=3;
 t.details={...t.details,stops:[{start:10600,end:11500,verdict:'ambiguous',confidence:'low',reasons:['stopped 15 min','no walking, visit or on-foot evidence; the phone may have stayed in the vehicle']},{start:12000,end:12060,verdict:'temporaryPause'}]};
 const meta=emptyGrouping(owner);const [journey]=build([t],meta).journeys;
 const stops=journey.recognisedStops.filter(s=>s.id.startsWith('native:'));
 expect(stops).toHaveLength(1);
 expect(stops[0]).toMatchObject({startedAt:10600,endedAt:11500,durationSeconds:900,verdict:'ambiguous'});
 expect(stops[0].tags).toContain('Possible destination');
 expect(stops[0].reasons[1]).toContain('stayed in the vehicle');
 const ignored={...meta,stopEdits:{[stops[0].id]:{ignored:true}}};
 expect(build([t],ignored).journeys[0].recognisedStops.some(s=>s.id===stops[0].id)).toBe(false);
 expect(build([{...t,details:{...t.details,stops:[{start:10600,end:11500}]}}],meta).journeys[0].recognisedStops.filter(s=>s.id.startsWith('native:'))).toEqual([]);
 expect(build([{...t,details:{...t.details,stops:[{start:10600,end:11500,verdict:'temporaryPause'}]}}],meta).journeys[0].recognisedStops.filter(s=>s.id.startsWith('native:'))).toEqual([]);
});
it('keeps a published stop out of grouping until it is finalised',()=>{
 const {activities,meta}=setup();
 const stopped={...activities[0],details:{...activities[0].details,provisional:true,continuationEndsAt:activities[0].endedAt+1200}};
 expect(build([stopped],meta).journeys).toHaveLength(0);
 expect(build([{...stopped,details:{...stopped.details,provisional:undefined}}],meta).journeys).toHaveLength(1);
});
it('reprocessing, reordered input and duplicate sync deliveries are idempotent',()=>{
 const {activities,meta}=setup();const expected=build(activities,meta);expect(build([...activities].reverse(),meta)).toEqual(expected);expect(build([...activities,...activities],meta)).toEqual(expected);
 const earlier=build(activities.slice(0,2),meta).journeys[0];expect(expected.journeys[0].id).toBe(earlier.id);
});
it('ignores traffic lights but recognises a sustained lookout dwell without editing the segment',()=>{
 const {meta}=setup(),context={owner,metadata:meta,places:[],vehicles,telemetry:[]};const t=drive('lookout',locations.kew,locations.coffs);t.points=Array.from({length:7},(_,i)=>({...locations.kew,timestamp:10000+i*60}));expect(internalStops(t,context)).toHaveLength(1);expect(internalStops({...t,points:t.points.slice(0,3)},context)).toHaveLength(0);
});
it('rejects foreign saved metadata and has no unscoped grouping fallback',()=>{
 const {activities,meta}=setup();expect(readGrouping(JSON.stringify(meta),'wife')).toEqual(emptyGrouping('wife'));expect(buildJourneys(activities,{}).journeys).toHaveLength(0);expect(()=>changeGrouping(meta,{type:'rename',anchor:'a',title:'No'},{owner:'wife',activities,vehicles})).toThrow('Account');
});

it('reuses a projection across unrelated place updates and invalidates relevant evidence',()=>{
 const metadata=emptyGrouping(owner),projectionCache=new Map(),places=[],vehicles=[],telemetry=[];
 const activity={id:'cache-walk',source:'device',activity:'Walking',recordingMode:'manual',title:'Walking · 1 Nov 2026 at 10:47 am',startedAt:100,endedAt:200,state:'finished',tags:[],points:[p(-34,151,100),p(-34.001,151,200)]};
 const options={owner,metadata,projectionCache,places,vehicles,telemetry};
 const first=buildJourneys([activity],options).journeys[0];
 const other=structuredClone(metadata);other.places.unrelated={locality:'Elsewhere'};
 expect(buildJourneys([activity],{...options,metadata:other}).journeys[0]).toBe(first);
 other.places[placeKey(activity.points[0])]={nearbyName:'Named trailhead'};
 const changed=buildJourneys([activity],{...options,metadata:other}).journeys[0];
 expect(changed).not.toBe(first);expect(changed.tags).toContain('Named trailhead');
 buildJourneys([],{...options,metadata:other});expect(projectionCache.size).toBe(0);
});

it('refuses a 61st hidden tag without discarding an earlier user decision',()=>{
 const {activities,meta}=setup();meta.hiddenTags.a=Array.from({length:60},(_,i)=>`Hidden ${i}`);
 const before=structuredClone(meta);
 expect(()=>changeGrouping(meta,{type:'hideTag',anchor:'a',tag:'New hidden tag'},{owner,activities,vehicles})).toThrow('existing choices have been kept');
 expect(meta).toEqual(before);
});

