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

it('titles a drive that ends at Home as driving home, not after a park beside Home',()=>{
 const shop=p(-34.4,150.88),home=p(-34.42,150.9);
 const t=drive('home-drive',shop,home,10000,540);
 // The car sat beside Morley Park (dwell evidence) right where Home is.
 t.points=[{...shop,timestamp:10000},{...home,timestamp:10300},{...home,timestamp:10420},{...home,timestamp:10540}];
 t.visibleRouteStart=0;t.visibleRouteEnd=3;t.title='Automatically detected journey';
 const meta=emptyGrouping(owner);
 meta.places[placeKey(home)]={candidates:[{name:'Morley Park',placeID:'apple:morley',category:'park',latitude:home.latitude+.0004,longitude:home.longitude}],nearbyName:'Morley Park'};
 const places=[{id:'home',name:'Home',kind:'home',latitude:home.latitude,longitude:home.longitude,radius:150}];
 const [journey]=buildJourneys([t],{owner,metadata:meta,vehicles,places}).journeys;
 expect(journey.generatedTitle).not.toMatch(/Morley Park/);
 expect(journey.generatedTitle).toBe('Driving home');
});
it('titles a drive that ends at Home as driving home when the person also saved a place right on top of Home',()=>{
 // The real case: Home, and a favourite "MorleyPark" saved about ten metres away, so every drive home ended inside both.
 const shop=p(-34.5725,150.8150),home=p(-34.546189,150.853836);
 const t=drive('home-drive-2',shop,home,10000,600);
 t.points=[{...shop,timestamp:10000},{...p(-34.56,150.84),timestamp:10200},...Array.from({length:10},(_,i)=>({...p(-34.54625+i*0.00001,150.85380+i*0.00001),timestamp:10400+i*20}))];
 t.visibleRouteStart=0;t.visibleRouteEnd=11;t.title='Automatically detected journey';
 const places=[{id:'home',name:'Home',kind:'home',latitude:home.latitude,longitude:home.longitude,radius:150},
  {id:'morley',name:'MorleyPark',kind:'favourite',latitude:-34.546285,longitude:150.853784,radius:200}];
 const [journey]=buildJourneys([t],{owner,metadata:emptyGrouping(owner),vehicles,places}).journeys;
 expect(journey.generatedTitle).not.toMatch(/Morley/);
 expect(journey.generatedTitle).toBe('Driving home');
});
it('still names a saved destination that is nowhere near Home',()=>{
 const home=p(-34.546189,150.853836),gym=p(-34.5509,150.8601);
 const t=drive('to-gym',home,gym,10000,300);
 t.points=[{...home,timestamp:10000},{...p(-34.549,150.857),timestamp:10150},{...gym,timestamp:10300}];
 t.visibleRouteStart=0;t.visibleRouteEnd=2;t.title='Automatically detected journey';
 const places=[{id:'home',name:'Home',kind:'home',latitude:home.latitude,longitude:home.longitude,radius:150},
  {id:'gym',name:'PlusFitness',kind:'favourite',latitude:gym.latitude,longitude:gym.longitude,radius:200}];
 const [journey]=buildJourneys([t],{owner,metadata:emptyGrouping(owner),vehicles,places}).journeys;
 expect(journey.generatedTitle).toMatch(/PlusFitness/);
});
it('an edited title wins over a cached presentation saved before the edit',()=>{
 const t=drive('edit',locations.sydney,locations.kew);t.geometryLoaded=false;t.updatedAt=5;
 const saved=(updatedAt)=>({updatedAt,pointCount:t.points?.length??0,distanceMeters:t.distanceMeters??0,visibleRouteStart:t.visibleRouteStart??null,visibleRouteEnd:t.visibleRouteEnd??null,summary:{gaps:[]},presentation:{title:'Old cached title',tags:[],recognisedStops:[]}});
 const meta=(updatedAt)=>({...emptyGrouping(owner),distanceSummaries:{edit:saved(updatedAt)}});
 expect(build([t],meta(5)).journeys[0].title).toBe('Old cached title');
 const edited={...t,title:'My new title',updatedAt:6,details:{...t.details,titleEdited:true}};
 expect(build([edited],meta(5)).journeys[0].title).toBe('My new title');
});
// Feedback 45: a favourite saved on top of Home ("Morley Park", about ten metres away, 200 m radius) named every drive that STARTED at
// Home. The end of a trip was already guarded; the start (and a place lookup) took whichever overlapping place was saved first.
const houseSpot=p(-34.546189,150.853836),gymSpot=p(-34.5509,150.8601);
const overlapping=[{id:'home',name:'Home',kind:'home',latitude:houseSpot.latitude,longitude:houseSpot.longitude,radius:100},
 {id:'morley',name:'Morley Park',kind:'favourite',latitude:-34.546285,longitude:150.853784,radius:200},
 {id:'gym',name:'Plus Fitness',kind:'favourite',latitude:gymSpot.latitude,longitude:gymSpot.longitude,radius:150}];
function nativeDrive(title,details={}){
 return recordedJourney({id:'from-home',source:'device',ownerID:owner,state:'finished',recordingMode:'automatic',activity:'Driving',title,vehicle:'Kia',startedAt:10000,endedAt:10300,durationSeconds:300,distanceMeters:2100,
  points:[{...p(-34.54625,150.85380),timestamp:10000},{...p(-34.549,150.857),timestamp:10150},{...gymSpot,timestamp:10300}],
  details:{tags:[],startPlace:'Morley Park',endPlace:'Plus Fitness',...details}});
}
it('names where a drive started after Home, whatever order the overlapping places were saved in',()=>{
 for(const places of [overlapping,[...overlapping].reverse()]){
  const [journey]=buildJourneys([nativeDrive('Driving')],{owner,metadata:emptyGrouping(owner),vehicles,places}).journeys;
  expect(journey.location).toBe('Home → Plus Fitness');
 }
});
it('shows Home instead of a favourite on top of it in a title the recorder stored before the overlap rule',()=>{
 const t=nativeDrive('Morley Park → Plus Fitness');
 for(const places of [overlapping,[...overlapping].reverse()]){
  const [journey]=buildJourneys([t],{owner,metadata:emptyGrouping(owner),vehicles,places}).journeys;
  expect(journey.title).toBe('Home → Plus Fitness');
  expect(journey.location).toBe('Home → Plus Fitness');
 }
 // The round trip suffix survives, and the end is repaired the same way.
 const round=nativeDrive('Morley Park → Morley Park · stopped 8 min',{endPlace:'Morley Park'});
 round.points=[{...p(-34.54625,150.85380),timestamp:10000},{...gymSpot,timestamp:10150},{...p(-34.54626,150.85381),timestamp:10300}];
 expect(buildJourneys([round],{owner,metadata:emptyGrouping(owner),vehicles,places:overlapping}).journeys[0].title).toBe('Home → Home · stopped 8 min');
});
it('repairs that title even when the activity was enriched and cached with the old one',()=>{
 const t=nativeDrive('Morley Park → Plus Fitness');t.updatedAt=7;
 const meta={...emptyGrouping(owner),distanceSummaries:{[t.id]:{updatedAt:7,pointCount:t.points.length,distanceMeters:t.distanceMeters??0,visibleRouteStart:t.visibleRouteStart,visibleRouteEnd:t.visibleRouteEnd,summary:{gaps:[]},
  presentation:{title:'Morley Park → Plus Fitness',location:'Morley Park → Plus Fitness',tags:[],recognisedStops:[]}}}};
 const [journey]=buildJourneys([t],{owner,metadata:meta,vehicles,places:overlapping}).journeys;
 expect(journey.title).toBe('Home → Plus Fitness');
 expect(journey.location).toBe('Home → Plus Fitness');
});
it('leaves a title alone that the person wrote, or that the recorder did not generate from its start and end places',()=>{
 const places=overlapping,meta=emptyGrouping(owner);
 const title=activity=>buildJourneys([activity],{owner,metadata:meta,vehicles,places}).journeys[0].title;
 expect(title(nativeDrive('Morley Park → Plus Fitness',{titleEdited:true,userCorrected:true}))).toBe('Morley Park → Plus Fitness');
 expect(title(nativeDrive('Dropping the car at Morley Park'))).toBe('Dropping the car at Morley Park');
 expect(title({...nativeDrive('Morley Park → Plus Fitness'),recordingMode:'manual'})).toBe('Morley Park → Plus Fitness');
 // A rename kept in the journey metadata wins as it always did.
 expect(buildJourneys([nativeDrive('Morley Park → Plus Fitness')],{owner,metadata:{...meta,titles:{'from-home':'My commute'}},vehicles,places}).journeys[0].title).toBe('My commute');
 // Away from Home the favourite still names the start.
 const elsewhere=nativeDrive('Morley Park → Plus Fitness');elsewhere.points=[{...p(-34.5505,150.8590),timestamp:10000},{...gymSpot,timestamp:10300}];
 expect(title(elsewhere)).toBe('Morley Park → Plus Fitness');
});
// A list row (a cloud activity whose route is not loaded) has no points to count, so its cached presentation can only be judged by when
// the activity was last updated; the saved point count describes the full route and can never match.
const listRow=(over={})=>{
 const t=drive('list-row',locations.sydney,locations.kew);
 return {...t,geometryLoaded:false,points:[],updatedAt:5,...over};
};
const cachedFor=(updatedAt)=>({...emptyGrouping(owner),distanceSummaries:{'list-row':{updatedAt,pointCount:177,distanceMeters:100000,visibleRouteStart:0,visibleRouteEnd:176,summary:{gaps:[]},presentation:{title:'Home → Gym',location:'Home → Gym',tags:['Gym'],recognisedStops:[]}}}});
it('still shows the cached presentation of a list row that has no route loaded',()=>{
 const [journey]=build([listRow()],cachedFor(5)).journeys;
 expect(journey.title).toBe('Home → Gym');
 expect(journey.location).toBe('Home → Gym');
 expect(journey.tags).toContain('Gym');
});
it('ignores the cached presentation of a list row that was updated after it was saved',()=>{
 const edited=listRow({title:'My renamed drive',updatedAt:6,details:{...drive('x',locations.sydney,locations.kew).details,titleEdited:true}});
 const [journey]=build([edited],cachedFor(5)).journeys;
 expect(journey.title).toBe('My renamed drive');
});
it('keeps a title worked out from a stop on a Home round trip, which the repair of the recorder\'s start and end names must not replace',()=>{
 const t=recordedJourney({id:'round-trip',source:'device',ownerID:owner,state:'finished',recordingMode:'automatic',activity:'Driving',title:'Home → Home · stopped 8 min',vehicle:'Kia',startedAt:10000,endedAt:10900,durationSeconds:900,distanceMeters:4200,
  points:[{...p(-34.54625,150.85380),timestamp:10000},{...gymSpot,timestamp:10300},{...gymSpot,timestamp:10800,segment:1},{...p(-34.54626,150.85381),timestamp:10900,segment:1}],
  details:{tags:[],startPlace:'Home',endPlace:'Home',stops:[{start:10400,end:10780,verdict:'ambiguous',confidence:'low',reasons:[]}]}});
 const [journey]=buildJourneys([t],{owner,metadata:emptyGrouping(owner),vehicles,places:overlapping}).journeys;
 expect(journey.title).toBe('Home → Plus Fitness → Home');
});
