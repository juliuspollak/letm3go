import {it,expect} from 'vitest';
import {assessRoutePlaces,recognitionSampleIndexes,cachedLookup,lookupDue,failedLookup,LOOKUP_ATTEMPTS,destinationVisits} from './journeyRecognition.js';
import {compareRoutes} from './journeyGeometry.js';
import {buildJourneys,emptyGrouping,placeKey} from './journeyGrouping.js';
import {automaticTitle} from './activityTitle.js';
import {previewRecognition} from '../../scripts/journey-recognition-preview.mjs';
const center={latitude:-34,longitude:151};
const route=Array.from({length:61},(_,i)=>({...center,latitude:center.latitude+.0004*Math.sin(i*Math.PI/30),longitude:center.longitude+.0005*Math.cos(i*Math.PI/30),timestamp:1000+i*15,accuracy:5,segment:0}));
const trip={id:'walk',ownerID:'owner',activity:'Walking',recordingMode:'manual',title:'Walking · 1 Nov 2026 at 10:47 am',points:route,startedAt:1000,endedAt:1900,state:'finished',tags:[],details:{}};
const reserve={...center,name:'Bass Point Reserve',placeID:'apple:reserve',category:'park'};
const records=[{candidates:[reserve]}];
it('requires sustained route evidence instead of saving every nearby POI',()=>{
 const recognition=assessRoutePlaces(trip,[{candidates:[reserve,{...reserve,latitude:-34.01,name:'Other Reserve',placeID:'apple:other'},{...center,name:'Cafe',category:'cafe'}]}]);
 expect(recognition.primary.name).toBe('Bass Point Reserve');
 expect(recognition.visited.map(p=>p.name)).toEqual(['Bass Point Reserve']);
 expect(recognition.nearby.map(p=>p.name)).toEqual(expect.arrayContaining(['Cafe','Other Reserve']));
 expect(recognition.primary.evidence.containment).toBe(false);
});
it('a single nearby fix or inaccurate route never establishes a visit',()=>{
 expect(assessRoutePlaces({...trip,points:[route[0]]},records).primary).toBeNull();
 expect(assessRoutePlaces({...trip,points:route.map(p=>({...p,accuracy:150}))},records).visited).toEqual([]);
});
it('recognises parking through actual dwell but not a nearby endpoint',()=>{
 const parking={...route[0],name:'Trailhead Car Park',category:'parking',placeID:'apple:parking'};
 expect(assessRoutePlaces({...trip,points:[route[0],route.at(-1)]},[{candidates:[parking]}]).visited).toEqual([]);
 const parked=Array.from({length:8},(_,i)=>({...route[0],timestamp:1000+i*10}));
 expect(assessRoutePlaces({...trip,points:parked},[{candidates:[parking]}]).startFinish[0].name).toBe(parking.name);
});
it('new sampling includes endpoints and stops and deduplicates indexes',()=>{
 const indexes=recognitionSampleIndexes(trip,[{pointIndex:15},{pointIndex:15}]);
 expect(indexes).toContain(0);expect(indexes).toContain(60);expect(indexes).toContain(15);
 expect(new Set(indexes).size).toBe(indexes.length);
});
it('treats an answer as final, including "nothing found", and retries only incomplete or failed lookups, a bounded number of times',()=>{
 const year=365*86400000;
 expect(lookupDue(undefined,1000)).toBe(true);
 expect(lookupDue(cachedLookup({candidates:[]},1000),1000+year)).toBe(false);
 expect(lookupDue(cachedLookup({candidates:[reserve]},1000),1000+year)).toBe(false);
 expect(lookupDue({candidates:[],lookupVersion:1,expiresAt:5},1000+year)).toBe(false); // older caches are final too
 let partial=cachedLookup({candidates:[reserve],partial:true},1000);
 expect(lookupDue(partial,1001)).toBe(false);expect(lookupDue(partial,1000+5*60000)).toBe(true);expect(partial.candidates).toEqual([reserve]);
 for(let i=1;i<LOOKUP_ATTEMPTS;i++)partial=cachedLookup({candidates:[reserve],partial:true},1000,partial);
 expect(partial).not.toHaveProperty('retryAfter');expect(lookupDue(partial,1000+year)).toBe(false);
 let failed=failedLookup({candidates:[reserve],lookedUpAt:1},1000);
 expect(failed).toMatchObject({candidates:[reserve],attempts:1});expect(lookupDue(failed,1000+5*60000)).toBe(true);
 for(let i=1;i<LOOKUP_ATTEMPTS;i++)failed=failedLookup(failed,1000);
 expect(failed).toMatchObject({candidates:[reserve],unavailable:true});expect(lookupDue(failed,1000+year)).toBe(false);
});
it('uses contextual manual timestamp suggestions without rewriting the original or edited titles',()=>{
 const meta=emptyGrouping('owner');for(const p of route)meta.places[placeKey(p)]={candidates:[reserve]};
 const input=JSON.stringify(trip),context={owner:'owner',metadata:meta};
 expect(buildJourneys([trip],context).journeys[0].title).toBe('Bass Point Walk');
 expect(JSON.stringify(trip)).toBe(input);
 for(const edited of [{...trip,title:'Our family walk'},{...trip,details:{titleEdited:true}},{...trip,corrected:true}])expect(buildJourneys([edited],context).journeys[0].title).toBe(edited.title);
 meta.titles.walk='My chosen title';meta.hiddenTags.walk=['Bass Point Reserve'];meta.manualTags.walk=['Family'];
 const j=buildJourneys([trip],context).journeys[0];expect(j.title).toBe('My chosen title');expect(j.tags).toContain('Family');expect(j.tags).not.toContain('Bass Point Reserve');
 expect(automaticTitle({...trip,recordingMode:'watch'})).toBe(true);
});
it('counts separate local days by stable identity and retains activity dates',()=>{
 const recognized={...trip,recognition:assessRoutePlaces(trip,records)};
 const visits=destinationVisits([recognized,{...recognized,id:'same-day',startedAt:1100},{...recognized,id:'next-day',startedAt:1000+86400}],'Australia/Sydney');
 expect(visits[0].visits).toBe(2);expect(visits[0].activities).toHaveLength(3);
 expect(destinationVisits([{...recognized,recognition:{primary:{...recognized.recognition.primary,placeID:undefined}}}])).toEqual([]);
});
it('matches reverse loop geometry and drift, not merely shared endpoints',()=>{
 const reversed={...trip,points:[...route].reverse().map((p,i)=>({...p,timestamp:1000+i*15,latitude:p.latitude+.00005}))};
 expect(compareRoutes(trip,reversed).similar).toBe(true);
 const different={...trip,points:route.map((p,i)=>i===0||i===60?p:{...p,latitude:p.latitude+.01})};
 expect(compareRoutes(trip,different).similar).toBe(false);
 expect(compareRoutes({...trip,points:[route[0],route.at(-1)]},trip).similar).toBe(false);
});
it('dry run is idempotent, single-account and contains no raw coordinates or mutation',()=>{
 const input={owner:'owner',activities:[trip],metadata:emptyGrouping('owner')},original=JSON.stringify(input);
 const result=previewRecognition(input);
 expect(previewRecognition(input)).toEqual(result);expect(JSON.stringify(input)).toBe(original);
 expect(JSON.stringify(result)).not.toContain('latitude');
 expect(()=>previewRecognition({...input,activities:[{...trip,ownerID:'other'}]})).toThrow('single account');
});

it('reuses stable user-saved destinations without another provider lookup',()=>{
 const result=buildJourneys([trip],{owner:'owner',metadata:emptyGrouping('owner'),places:[{...center,id:'saved-reserve',name:'My reserve',radius:150}]});
 expect(result.journeys[0].recognition.primary.placeID).toBe('saved:saved-reserve');
 expect(result.destinations[0].visits).toBe(1);
});

it('does not turn a car park labelled as a park by the provider into the primary destination',()=>{
 const candidate={...reserve,name:'Example Car Park',category:'park'};
 const result=assessRoutePlaces(trip,[{candidates:[candidate]}]);
 expect(result.primary).toBeNull();
 expect(result.candidates[0].category).toBe('parking');
 expect(result.candidates[0].providerCategory).toBe('park');
});

// A drive to a shop never covers the shop's radius the way a loop covers a park.
// The person's own saved place is recognised where the activity ended instead.
const drivePoints=Array.from({length:30},(_,i)=>({...center,latitude:center.latitude+.004*(29-i)/29,longitude:center.longitude+.0004*(29-i)/29,timestamp:1000+i*20,accuracy:6,segment:0}));
const drive={...trip,id:'drive',activity:'Driving',title:'Driving · 1 Nov 2026',points:drivePoints,startedAt:1000,endedAt:1000+29*20,state:'finished',tags:[],details:{}};
const savedBunnings={...center,id:'bunnings',name:'Bunnings',kind:'favourite',radius:200};
const savedCandidates=places=>[{candidates:places.map(p=>({...p,placeID:`saved:${p.id}`,category:'savedPlace',userSaved:true}))}];
it('recognises a saved place where a drive ended, though the route never covered it',()=>{
 const result=assessRoutePlaces(drive,savedCandidates([savedBunnings]));
 expect(result.primary.name).toBe('Bunnings');
 expect(result.primary.evidence.savedEnd).toBe(true);
 expect(result.primary.evidence.containment).toBe('user-saved geofence');
 expect(result.primary.reason).toBe('user-saved place where the activity ended');
 expect(result.visited.map(p=>p.name)).toEqual(['Bunnings']);
});
it('never titles a drive home as a destination, saved place or not',()=>{
 expect(assessRoutePlaces(drive,savedCandidates([{...savedBunnings,id:'home',name:'Home',kind:'home'}])).primary).toBeNull();
 expect(assessRoutePlaces(drive,savedCandidates([{...savedBunnings,id:'work',name:'Work',kind:'work'}])).primary).toBeNull();
});
it('picks the saved place nearest the end when two overlap, whatever the save order',()=>{
 const twin={...savedBunnings,id:'warehouse',name:'Bunnings Warehouse',latitude:center.latitude+.0006,radius:300};
 expect(assessRoutePlaces(drive,savedCandidates([savedBunnings,twin])).primary.name).toBe('Bunnings');
 expect(assessRoutePlaces(drive,savedCandidates([twin,savedBunnings])).primary.name).toBe('Bunnings');
});
it('tags the drive with the saved place it ended at',()=>{
 const result=buildJourneys([drive],{owner:'owner',metadata:emptyGrouping('owner'),places:[savedBunnings]});
 expect(result.journeys[0].recognition.primary.name).toBe('Bunnings');
 expect(result.journeys[0].tags).toContain('Bunnings');
 expect(result.destinations[0].name).toBe('Bunnings');
});
it('keeps a saved place as the destination even when its name reads like parking',()=>{
 const parking={...savedBunnings,id:'bunnings-carpark',name:'Bunnings car park'};
 const result=assessRoutePlaces(drive,savedCandidates([parking]));
 expect(result.primary.name).toBe('Bunnings car park');
 expect(result.startFinish).toEqual([]);
});
it('lets the saved place outrank a park the same drive passed',()=>{
 const park={...center,latitude:center.latitude+.002,name:'Bass Point Reserve',placeID:'apple:reserve',category:'park'};
 const result=assessRoutePlaces(drive,[...savedCandidates([savedBunnings]),{candidates:[park]}]);
 expect(result.primary.name).toBe('Bunnings');
 expect(result.nearby.map(p=>p.name)).toContain('Bass Point Reserve');
});
// A stopped car leaves the recorder with a drifting fix, and a phone can stop
// supplying fixes at all. Neither may lose a genuine arrival, and neither may
// invent one.
it('keeps a saved destination when the last fixes drift after the trip arrives',()=>{
 const drifted=[...drivePoints,
  {...center,latitude:center.latitude+.006,longitude:center.longitude+.008,timestamp:1000+30*20,accuracy:320,segment:0},
  {...center,latitude:center.latitude-.007,longitude:center.longitude-.004,timestamp:1000+31*20,accuracy:900,segment:0}];
 const result=assessRoutePlaces({...drive,points:drifted},savedCandidates([savedBunnings]));
 expect(result.primary.name).toBe('Bunnings');
 expect(result.primary.evidence.savedEnd).toBe(true);
 // Measured from the last fix worth believing, not from the drift after it.
 expect(result.primary.evidence.savedEndMetres).toBe(0);
 expect(result.primary.evidence.endpoint).toBe(true);
});
it('keeps a saved destination when the recording stops as the trip arrives',()=>{
 const arrived=drivePoints.slice(0,25);
 const result=assessRoutePlaces({...drive,points:arrived},savedCandidates([savedBunnings]));
 expect(result.primary.name).toBe('Bunnings');
 expect(result.primary.evidence.savedEnd).toBe(true);
});
it('does not claim a saved place the drive only passed on the way home',()=>{
 const onward=Array.from({length:6},(_,i)=>({...center,latitude:center.latitude+.003*(i+1),timestamp:1000+(30+i)*20,accuracy:6,segment:0}));
 const result=assessRoutePlaces({...drive,points:[...drivePoints,...onward]},savedCandidates([savedBunnings]));
 expect(result.primary).toBeNull();
 const passed=result.candidates.find(c=>c.name==='Bunnings');
 expect(passed.evidence.savedEnd).toBe(false);
 // Below the tier a saved place only reaches by ending there, so no inferred
 // place is overtaken by a fence the trip merely crossed.
 expect(passed.score).toBeLessThan(1000);
 expect(result.nearby.map(p=>p.name)).toContain('Bunnings');
});
it('does not treat one fix inside the fence as an arrival',()=>{
 const spike=[.01,.005,.004,.008,.0015].map((lat,i)=>({...center,latitude:center.latitude+lat,timestamp:1000+i*20,accuracy:6,segment:0}));
 const result=assessRoutePlaces({...drive,points:spike},savedCandidates([savedBunnings]));
 expect(result.candidates[0].evidence.savedEnd).toBe(false);
 expect(result.primary).toBeNull();
});
it('judges a trip recorded with only poor fixes on the fixes it has',()=>{
 const weak=drivePoints.map(p=>({...p,accuracy:90}));
 const result=assessRoutePlaces({...drive,points:weak},savedCandidates([savedBunnings]));
 expect(result.primary.name).toBe('Bunnings');
 expect(result.primary.evidence.savedEnd).toBe(true);
});
it('names one saved destination per trip even when two fences overlap',()=>{
 const twin={...savedBunnings,id:'warehouse',name:'Bunnings Warehouse',latitude:center.latitude+.0006,radius:300};
 const result=assessRoutePlaces(drive,savedCandidates([twin,savedBunnings]));
 expect(result.candidates.filter(c=>c.role==='destination').map(c=>c.name)).toEqual(['Bunnings']);
 const loser=result.candidates.find(c=>c.name==='Bunnings Warehouse');
 expect(loser.role).toBe('nearby');
 expect(loser.supported).toBe(false);
 expect(loser.evidence.savedEnd).toBe(false);
 expect(loser.evidence.supersededBy).toBe('Bunnings');
 expect(result.visited.map(p=>p.name)).toEqual(['Bunnings']);
 const tagged=buildJourneys([drive],{owner:'owner',metadata:emptyGrouping('owner'),places:[twin,savedBunnings]});
 expect(tagged.journeys[0].tags).toContain('Bunnings');
 expect(tagged.journeys[0].tags).not.toContain('Bunnings Warehouse');
});
it('recognises a place saved beside Home while leaving Home a personal place',()=>{
 const home={...savedBunnings,id:'home',name:'Home',kind:'home',latitude:center.latitude+.0003,radius:150};
 expect(assessRoutePlaces(drive,savedCandidates([home])).primary).toBeNull();
 const studio={...savedBunnings,id:'studio',name:'Lilyfield Studio',kind:'favourite',latitude:center.latitude+.0003};
 expect(assessRoutePlaces(drive,savedCandidates([home,studio])).primary.name).toBe('Lilyfield Studio');
});
