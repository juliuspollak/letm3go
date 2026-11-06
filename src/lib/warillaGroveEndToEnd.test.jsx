// End-to-end replay of the 6 November 2026 Home → Warilla Grove → Home drive.
// The route is SYNTHETIC (see fixtures/warillaGroveTrip.js). Provider records
// are LIVE Apple MapKit responses captured once and replayed here; this test
// is not itself a live MapKit check. No destination name is preset anywhere:
// Warilla Grove has to come from the provider records.
import {renderHook,waitFor,cleanup,render,screen} from '@testing-library/react';
import {it,expect,vi,beforeEach,afterEach,describe} from 'vitest';
const mock=vi.hoisted(()=>({lookup:vi.fn()}));
vi.mock('./recorder.js',async()=>({...(await vi.importActual('./recorder.js')),recorderAvailable:()=>true,recorder:{recogniseTripPlace:mock.lookup}}));
import {useJourneyGrouping} from './useJourneyGrouping.js';
import {buildJourneys,emptyGrouping,placeKey,nativeStops,changeGrouping} from './journeyGrouping.js';
import {recognisedStopVenue,suggestedStopVenues,STOP_LOOKUP_VERSION} from './stopVenueRecognition.js';
import {recordedJourney} from './recorder.js';
import {quality} from './recordingQuality.js';
import {metres} from './journeyGeometry.js';
import {activityPresentation} from './activityPresentation.js';
import JourneyTags from '../components/JourneyTags.jsx';
import live from '../test/fixtures/warillaGroveMapKit.json';
import {OWNER,HOME_PLACE,PARKED,CENTRE_POI,STOP_START,STOP_END,warillaGroveRecording} from '../test/fixtures/warillaGroveTrip.js';

const STOP_INDEX=161;
const savedPlace={locality:'Home',nearbyName:'',possibleCharging:false,source:'saved-place'};
// Emulates ActivityServices.recogniseTripPlace: a native index into the recorded
// points, a saved-place short circuit, then the captured provider record.
function nativeLookup(trip,{stop,route}){
 return async(id,index,point,explore)=>{
  expect(id).toBe(trip.id);
  const p=point||trip.points[index];
  if(metres(p,HOME_PLACE)<=HOME_PLACE.radius)return {...savedPlace};
  if(placeKey(p)===placeKey(PARKED))return structuredClone(explore?stop:route);
  return structuredClone(route);
 };
}
// One save for the whole cycle: lookups are batched (useJourneyGrouping).
async function enrich(trip,responses,serialized=JSON.stringify({...emptyGrouping(OWNER),enrichFrom:0}),calls=1){
 mock.lookup.mockImplementation(nativeLookup(trip,responses));
 const savePreferences=vi.fn().mockResolvedValue();
 renderHook(()=>useJourneyGrouping({owner:OWNER,activities:[recordedJourney(trip)],places:[HOME_PLACE],vehicles:[],serialized,savePreferences}));
 await waitFor(()=>expect(savePreferences).toHaveBeenCalledTimes(calls),{timeout:9000});
 return JSON.parse(savePreferences.mock.calls.at(-1)[0].journeyGrouping);
}
const project=(trip,metadata,places=[HOME_PLACE])=>buildJourneys([recordedJourney(trip)],{owner:OWNER,metadata,places}).journeys[0];
const patchedMeta=()=>{const m=emptyGrouping(OWNER);m.places[placeKey(PARKED)]={...live.stopPatched,stopLookup:STOP_LOOKUP_VERSION};return m;};
beforeEach(()=>{mock.lookup.mockReset();});afterEach(()=>{cleanup();});

describe('recording evidence',()=>{
 it('the native stop is the 691 s car-park stop, at its real point index, with no fabricated fixes',()=>{
  const trip=warillaGroveRecording();
  expect(trip.points).toHaveLength(287);
  expect(trip.points.filter(p=>p.timestamp>STOP_START&&p.timestamp<STOP_END)).toEqual([]);
  const stops=nativeStops(recordedJourney(trip),{owner:OWNER,metadata:emptyGrouping(OWNER),places:[HOME_PLACE]});
  expect(stops).toHaveLength(1);
  expect(stops[0]).toMatchObject({pointIndex:STOP_INDEX,startedAt:STOP_START,endedAt:STOP_END,durationSeconds:691,verdict:'ambiguous'});
  expect(stops[0].pointIndex).not.toBe(0);expect(stops[0].pointIndex).not.toBe(286);
  expect(placeKey(trip.points[STOP_INDEX])).toBe(placeKey(PARKED));
 });
 it('reports the 691 s interval as stopped time, not a GPS gap',()=>{
  const q=quality(recordedJourney(warillaGroveRecording()));
  expect(q).toMatchObject({points:287,stops:1,stoppedSeconds:691,broken:0,median:3.39});
  expect(q.gap).toBeLessThan(5);
  expect(q.warnings).toEqual([]);
 });
});

describe('automatic pipeline',()=>{
 it('REPRODUCES the defect with the merged provider: no venue, Home round trip kept',async()=>{
  const trip=warillaGroveRecording();
  const meta=await enrich(trip,{stop:live.stopMerged,route:live.routeMerged});
  const journey=project(trip,meta);
  expect(journey.title).toBe('Home → Home · stopped 11 min');
  expect(journey.tags.some(t=>/warilla grove/i.test(t))).toBe(false);
  expect(journey.recognisedStops[0].stopVenue).toBeUndefined();
 },15000);

 it('recognises Warilla Grove automatically from the patched provider records',async()=>{
  const trip=warillaGroveRecording(),before=JSON.stringify(trip);
  const meta=await enrich(trip,{stop:live.stopPatched,route:live.routePatched});
  // Stop first, by native index with no coordinate, as a stop-specific search;
  // both Home endpoints share one key and one saved-place lookup.
  expect(mock.lookup.mock.calls).toEqual([[trip.id,STOP_INDEX,null,true],[trip.id,0,null,false],[trip.id,143,null,false]]);
  expect(meta.places[placeKey(PARKED)]).toMatchObject({stopLookup:STOP_LOOKUP_VERSION,partial:false,areasOfInterest:['Warilla Grove']});
  const journey=project(trip,meta),stop=journey.recognisedStops[0];
  expect(journey.title).toBe('Home → Warilla Grove → Home');
  expect(journey.tags).toContain('Warilla Grove');
  expect(journey.tags).not.toContain('Home');
  expect(journey.tags).not.toContain('HomeCo. Warilla Grove');
  expect(stop).toMatchObject({name:'Warilla Grove',durationSeconds:691,pointIndex:STOP_INDEX});
  expect(stop.stopVenue).toMatchObject({name:'Warilla Grove',placeID:'apple:I9E547877098A843',basis:'areaOfInterest'});
  expect(stop.stopVenue.distanceMeters).toBeGreaterThan(90);
  expect(journey.distanceMeters).toBe(3246);
  expect(journey.points).toEqual(trip.points);
  expect(JSON.stringify(trip)).toBe(before);
  expect(journey.searchIndex).toContain('warilla grove');
  // Detail screen and tags section agree with the title.
  const view=activityPresentation(journey,{ownerID:OWNER,places:[HOME_PLACE],grouping:{metadata:meta,destinations:[],journeys:[journey]}});
  expect(view.stops[0]).toMatchObject({name:'Warilla Grove',nearby:'Warilla Grove'});
  render(<JourneyTags trip={journey} grouping={{metadata:meta,act:vi.fn(),busy:false,destinations:[],journeys:[journey]}}/>);
  expect(screen.getByRole('button',{name:'Hide tag Warilla Grove'})).toBeTruthy();
 },15000);

 it('an activity looked up by an earlier build is historical: its answers stand and nothing is re-queried',async()=>{
  const trip=warillaGroveRecording(),old={...emptyGrouping(OWNER),enrichFrom:0},now=Date.now();
  for(const [key,record] of [[placeKey(PARKED),{...live.stopMerged,stopLookup:true}],[placeKey(trip.points[0]),savedPlace],[placeKey(trip.points[143]),live.routeMerged]])
   old.places[key]={...record,lookupVersion:2,lookedUpAt:now,expiresAt:now-1};
  const meta=await enrich(trip,{stop:live.stopPatched,route:live.routePatched},JSON.stringify(old),1);
  expect(mock.lookup).not.toHaveBeenCalled();
  expect(meta.enriched).toEqual({[trip.id]:expect.any(Number)});
  // The earlier answer had no centre; the person can still add one by hand.
  expect(project(trip,meta).title).toBe('Home → Home · stopped 11 min');
 },15000);

 it('does not retry a failed stop upgrade before its retry time',async()=>{
  const trip=warillaGroveRecording(),old={...emptyGrouping(OWNER),enrichFrom:0},now=Date.now();
  for(const [key,record] of [[placeKey(PARKED),{...live.stopMerged,stopLookup:true,retryAfter:now+300000}],[placeKey(trip.points[0]),savedPlace],[placeKey(trip.points[143]),live.routeMerged]])
   old.places[key]={lookupVersion:2,expiresAt:now+86400000,...record};
  mock.lookup.mockImplementation(nativeLookup(trip,{stop:live.stopPatched,route:live.routePatched}));
  renderHook(()=>useJourneyGrouping({owner:OWNER,activities:[recordedJourney(trip)],places:[HOME_PLACE],vehicles:[],serialized:JSON.stringify(old),savePreferences:vi.fn()}));
  await new Promise(r=>setTimeout(r,300));
  expect(mock.lookup).not.toHaveBeenCalled();
 });
 it('offline at save time: the stop is retried later and the activity is done only once it is answered',async()=>{
  const trip=warillaGroveRecording(),old={...emptyGrouping(OWNER),enrichFrom:0},now=Date.now();
  for(const [key,record] of [[placeKey(trip.points[0]),savedPlace],[placeKey(trip.points[143]),live.routeMerged]])old.places[key]={...record,lookupVersion:2,lookedUpAt:now};
  mock.lookup.mockRejectedValue(new Error('Place recognition is unavailable offline. It will retry later.'));
  const savePreferences=vi.fn().mockResolvedValue();
  renderHook(()=>useJourneyGrouping({owner:OWNER,activities:[recordedJourney(trip)],places:[HOME_PLACE],vehicles:[],serialized:JSON.stringify(old),savePreferences}));
  await waitFor(()=>expect(savePreferences).toHaveBeenCalled(),{timeout:5000});
  const saved=JSON.parse(savePreferences.mock.calls[0][0].journeyGrouping);
  expect(mock.lookup).toHaveBeenCalledTimes(1);
  expect(saved.places[placeKey(PARKED)]).toMatchObject({attempts:1,retryAfter:expect.any(Number)});
  expect(saved.places[placeKey(trip.points[143])]).toEqual(old.places[placeKey(trip.points[143])]);
  expect(saved.enriched).toEqual({});
 },10000);
});

describe('corrections and confidence',()=>{
 const trip=()=>warillaGroveRecording(),stopID=`native:warilla-2026-11-06:${STOP_START}`;
 const act=(meta,action)=>changeGrouping(meta,action,{activities:[trip()],owner:OWNER});
 it('a stop renamed to Chemist replaces the inferred venue',()=>{
  const j=project(trip(),act(patchedMeta(),{type:'stop',id:stopID,name:'Chemist'}));
  expect(j.title).toBe('Home → Chemist → Home');
  expect(j.tags).toContain('Chemist');expect(j.tags).not.toContain('Warilla Grove');
 });
 it('a hidden or skipped Warilla Grove tag is not regenerated in the title',()=>{
  const j=project(trip(),act(patchedMeta(),{type:'hideTag',anchor:'warilla-2026-11-06',tag:'Warilla Grove'}));
  expect(j.tags).not.toContain('Warilla Grove');
  expect(j.title).toBe('Home → Home · stopped 11 min');
 });
 it('a manual title stays unchanged',()=>{
  expect(project(trip(),act(patchedMeta(),{type:'rename',anchor:'warilla-2026-11-06',title:'Groceries'})).title).toBe('Groceries');
 });
 it('a saved Warilla Grove place takes precedence and still names the round trip',()=>{
  const saved={id:'wg',name:'Warilla Grove',kind:'favourite',...CENTRE_POI,radius:200};
  const meta=emptyGrouping(OWNER);meta.places[placeKey(PARKED)]={...savedPlace,locality:'Warilla Grove',stopLookup:STOP_LOOKUP_VERSION};
  const j=project(trip(),meta,[HOME_PLACE,saved]);
  expect(j.recognisedStops[0]).toMatchObject({name:'Warilla Grove',kind:'favourite'});
  expect(j.recognisedStops[0].stopVenue).toBeUndefined();
  expect(j.title).toBe('Home → Warilla Grove → Home');
 });
 it('a short stop, a traffic pause or a partial response asserts nothing',()=>{
  const record=live.stopPatched;
  expect(recognisedStopVenue({...record,stopLookup:2},PARKED,7*60)).toBeNull();
  expect(recognisedStopVenue({...record,stopLookup:2,partial:true},PARKED,691)).toBeNull();
  const paused=trip();paused.details.stops[0].verdict='temporaryPause';
  const j=project(paused,patchedMeta());
  expect(j.recognisedStops).toEqual([]);expect(j.tags).not.toContain('Warilla Grove');
 });
 it('a different nearby centre blocks automatic selection; duplicates and tenants do not',()=>{
  const record={...live.stopPatched,stopLookup:2};
  const rival={name:'Shellharbour Square',category:'shoppingCentre',latitude:PARKED.latitude+.0008,longitude:PARKED.longitude,placeID:'apple:rival'};
  expect(recognisedStopVenue({...record,candidates:[...record.candidates,rival]},PARKED,691)).toBeNull();
  const wg=record.candidates.find(c=>c.name==='Warilla Grove');
  expect(recognisedStopVenue({...record,candidates:[...record.candidates,{...wg,placeID:'apple:dup',latitude:wg.latitude+.0001}]},PARKED,691)?.name).toBe('Warilla Grove');
 });
 it('without the area of interest, the 108 m POI distance alone is not accepted',()=>{
  const record={...live.stopPatched,stopLookup:2,areasOfInterest:[]};
  expect(recognisedStopVenue(record,PARKED,691)).toBeNull();
  expect(recognisedStopVenue(record,CENTRE_POI,691)?.basis).toBe('distance');
 });
 it('when evidence is insufficient, Warilla Grove is offered for confirmation, not its tenant',()=>{
  expect(suggestedStopVenues({...live.stopPatched,areasOfInterest:[]},PARKED,691).map(v=>v.name)).toEqual(['Warilla Grove']);
 });
});
