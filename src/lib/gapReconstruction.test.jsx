// Road estimates for GPS gaps. The route is the SYNTHETIC reproduction of the
// reported Low Power Mode drive; Apple Maps answers are stand-ins (roadFor), so
// this tests the app's handling, not live MapKit results.
import {renderHook,waitFor,cleanup,render,screen} from '@testing-library/react';
import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
const mock=vi.hoisted(()=>({lookup:vi.fn(),road:vi.fn()}));
vi.mock('./recorder.js',async()=>({...(await vi.importActual('./recorder.js')),recorderAvailable:()=>true,recorder:{recogniseTripPlace:mock.lookup,roadRoute:mock.road}}));
import {routeGaps,gapKey,plausibleRoute,chooseRoute,roadRecord,failedRecord,roadLookupDue,estimateExplanation,encodeLine,decodeLine,ROAD_VERSION} from './gapReconstruction.js';
import {buildJourneys,emptyGrouping,placeKey} from './journeyGrouping.js';
import {useJourneyGrouping} from './useJourneyGrouping.js';
import {recordedJourney} from './recorder.js';
import {tripDistanceText} from './distanceUnits.js';
import {activitySummary} from './activitySummary.js';
import {activityPresentation} from './activityPresentation.js';
import {mapPayload} from './appleMaps.js';
import {dailyJourneyTotals} from './homeDailyStats.js';
import HomeDailySummary from '../components/HomeDailySummary.jsx';
import {OWNER,GAPS,RECORDED_METERS,lowPowerDrive,roadFor} from '../test/fixtures/lowPowerDrive.js';

const roadsFor=(trip,options)=>Object.fromEntries(routeGaps(trip).map(g=>[gapKey(trip.id,g),roadRecord([roadFor(g,options)],g)]));
const project=(trips,roads={})=>{const m=emptyGrouping(OWNER);m.roads=roads;return buildJourneys(trips.map(recordedJourney),{owner:OWNER,metadata:m}).journeys;};
beforeEach(()=>{mock.lookup.mockReset();mock.road.mockReset();});afterEach(()=>{cleanup();});

describe('the reported drive',()=>{
 it('finds the nine GPS gaps the report lists, totalling 45,019 m straight-line',()=>{
  const trip=lowPowerDrive(),gaps=routeGaps(trip);
  expect(trip.points).toHaveLength(137);
  expect(gaps.map(g=>[Math.round(g.seconds),Math.round(g.straightMeters)])).toEqual(GAPS);
  expect(Math.round(gaps.reduce((n,g)=>n+g.straightMeters,0))).toBe(45019);
 });
 it('shows the road estimate, not 3.19 km, everywhere the distance appears',()=>{
  const trip=lowPowerDrive(),before=JSON.stringify(trip);
  const [journey]=project([trip],roadsFor(trip));
  const road=routeGaps(trip).reduce((n,g)=>n+Math.round(g.straightMeters*1.25),0);
  expect(journey.distanceMeters).toBe(RECORDED_METERS+road);
  expect(journey.distanceMeters).toBeGreaterThan(59000);
  expect(journey.recordedDistanceMeters).toBe(RECORDED_METERS);
  expect(journey.distanceEstimate).toMatchObject({confidence:'road',gapCount:9,roadGaps:9,straightMeters:0});
  expect(tripDistanceText(journey,'km')).toBe('~59 km');
  expect(tripDistanceText({...journey,distanceEstimate:undefined},'km')).toBe('59 km');
  // Original recording untouched: no fix invented, moved or removed.
  expect(JSON.stringify(trip)).toBe(before);
  expect(journey.points).toEqual(trip.points);
  // Journey details summary, map legend and report.
  expect(activitySummary(journey)[0]).toMatchObject({label:'Estimated distance',value:'~59 km',detail:'3.2 km recorded'});
  const view=activityPresentation(journey,{ownerID:OWNER,places:[],grouping:null});
  const notice=view.notices.find(n=>n.id==='estimated-distance');
  expect(notice.text).toMatch(/^~59 km estimated distance: 3\.2 km recorded by GPS \+ 56 km estimated along roads for 9 GPS gaps/);
  expect(notice.text).toContain('orange dashed is an estimated road route, not a recording');
  // Map: nine orange road lines, each joined exactly to the recorded fixes.
  expect(view.map.estimated).toHaveLength(9);
  routeGaps(trip).forEach((g,i)=>{const line=view.map.estimated[i];expect(line[0][0]).toBeCloseTo(g.from.latitude,4);expect(line[0][1]).toBeCloseTo(g.from.longitude,4);expect(line.at(-1)[0]).toBeCloseTo(g.to.latitude,4);expect(line.at(-1)[1]).toBeCloseTo(g.to.longitude,4);});
  expect(view.map.gaps).toEqual([]);
  expect(view.map.routes.length).toBeGreaterThanOrEqual(10);
  // Home: the day's total carries the estimate and says so.
  const day=new Date(trip.startedAt*1000).toLocaleDateString('en-CA');
  const totals=dailyJourneyTotals([journey],day,day);
  expect(totals).toMatchObject({estimated:true});
  expect(Math.round(totals.distanceMeters)).toBe(journey.distanceMeters);
  render(<HomeDailySummary date={day} today={day} journeys={[journey]} unit="km" onDateChange={()=>{}} onOpen={()=>{}}/>);
  expect(screen.getByText(/includes estimated GPS gaps/)).toBeTruthy();
  expect(document.body.textContent).toContain('~59');
 });
 it('falls back to the straight line, marked lower confidence, until a road route is known',()=>{
  const [journey]=project([lowPowerDrive()]);
  expect(journey.distanceMeters).toBe(RECORDED_METERS+45019);
  expect(journey.distanceEstimate).toMatchObject({confidence:'straight',roadGaps:0});
  expect(tripDistanceText(journey,'km')).toBe('~48 km');
  expect(estimateExplanation(journey.distanceEstimate)).toContain('as a straight line for 9 gaps (lower confidence: no road route yet)');
  expect(mapPayload([journey]).estimated).toEqual([]);
 });
 it('a grouped journey adds its recordings\' estimates and keeps the recorded total',()=>{
  const a=lowPowerDrive(),b=lowPowerDrive({id:'later',startedAt:a.endedAt+60});
  b.points=b.points.map(p=>({...p,latitude:p.latitude+(a.points.at(-1).latitude-b.points[0].latitude),longitude:p.longitude+(a.points.at(-1).longitude-b.points[0].longitude)}));
  const m=emptyGrouping(OWNER);m.roads={...roadsFor(a),...roadsFor(b)};m.links=[JSON.stringify([a.id,b.id])];
  const journey=buildJourneys([a,b].map(recordedJourney),{owner:OWNER,metadata:m}).journeys.find(j=>j.isGroupedJourney);
  expect(journey.recordedDistanceMeters).toBe(2*RECORDED_METERS);
  expect(journey.distanceMeters).toBe(project([a],roadsFor(a))[0].distanceMeters+project([b],roadsFor(b))[0].distanceMeters);
  expect(journey.distanceEstimate.gapCount).toBe(18);
  expect(journey.segments.every(s=>s.distanceEstimate&&s.recordedDistanceMeters===RECORDED_METERS)).toBe(true);
 });
});

describe('what is and is not a gap',()=>{
 it('continuous GPS has no estimate and no ~',()=>{
  const trip=lowPowerDrive();trip.points=trip.points.map(p=>({...p,segment:0}));
  const [journey]=project([trip]);
  expect(journey.distanceEstimate).toBeUndefined();
  expect(journey.distanceMeters).toBe(RECORDED_METERS);
  expect(tripDistanceText(journey,'km')).toBe('3.2 km');
 });
 it('a deliberate stop the journey continued from is not a gap',()=>{
  const trip=lowPowerDrive(),[first]=routeGaps(trip);
  trip.details.stops=[{start:first.from.timestamp,end:first.to.timestamp,verdict:'ambiguous'}];
  expect(routeGaps(trip)).toHaveLength(8);
 });
 it('only drives get road routes, and short or trimmed-away gaps are ignored',()=>{
  expect(routeGaps({...lowPowerDrive(),activity:'Walking'})).toEqual([]);
  expect(routeGaps({...lowPowerDrive(),state:'recording'})).toEqual([]);
  expect(routeGaps({...lowPowerDrive(),recordingMode:'manual'})).toEqual([]); // a manual pause is deliberate
  const trip=lowPowerDrive();trip.visibleRouteEnd=13;expect(routeGaps(trip)).toEqual([]);
  const near=lowPowerDrive(),[g]=routeGaps(near);near.points[g.index]={...near.points[g.index],latitude:g.from.latitude,longitude:g.from.longitude+0.001};
  expect(routeGaps(near)).toHaveLength(8);
 });
});

describe('road route plausibility',()=>{
 const gap={seconds:288,straightMeters:8731,from:{latitude:-34.4,longitude:150.88,timestamp:0},to:{latitude:-34.47,longitude:150.85,timestamp:288}};
 const route=(distanceMeters,expectedSeconds)=>({distanceMeters,expectedSeconds,points:[[-34.41,150.88],[-34.46,150.85]]});
 it('rejects routes shorter than the straight line, detours, impossible speeds and too-slow routes',()=>{
  expect(plausibleRoute(route(10500,300),gap)).toBe(true);
  expect(plausibleRoute(route(7000,300),gap)).toBe(false);   // shorter than straight
  expect(plausibleRoute(route(30000,300),gap)).toBe(false);  // implausible detour
  expect(plausibleRoute(route(16000,300),{...gap,seconds:200})).toBe(false); // 80 m/s
  expect(plausibleRoute(route(10500,950),gap)).toBe(true);   // Apple's cautious plan (live: 948 s for 12.2 km)
  expect(plausibleRoute(route(10500,3000),gap)).toBe(false); // a different, far slower road
  expect(plausibleRoute({...route(10500,300),points:[]},gap)).toBe(false);
 });
 it('chooses the plausible alternative whose travel time fits the gap',()=>{
  expect(chooseRoute([route(12000,500),route(10500,290),route(30000,280)],gap).distanceMeters).toBe(10500);
  expect(roadRecord([route(30000,280)],gap)).toMatchObject({status:'implausible',version:ROAD_VERSION});
  expect(roadRecord([],gap)).toMatchObject({status:'none'});
 });
 it('caches a compact line that starts and ends at the recorded fixes',()=>{
  const record=roadRecord([route(10500,290)],gap),line=decodeLine(record.line);
  expect(typeof record.line).toBe('string');
  expect(line[0]).toEqual([-34.4,150.88]);expect(line.at(-1)).toEqual([-34.47,150.85]);
  expect(decodeLine(encodeLine([[-34.123456,150.987654],[0,0],[51.5,-0.12]]))).toEqual([[-34.12346,150.98765],[0,0],[51.5,-0.12]]);
 });
 it('refreshes only when due: success is kept, failures retry, "no road" is rechecked later',()=>{
  const now=Date.now(),ok=roadRecord([route(10500,290)],gap,now);
  expect(roadLookupDue(ok,now+86400000)).toBe(false);
  expect(roadLookupDue({...ok,version:ROAD_VERSION+1},now)).toBe(true);
  const failed=failedRecord(ok,now);
  expect(failed).toMatchObject({status:'route',line:ok.line});expect(roadLookupDue(failed,now+60000)).toBe(false);expect(roadLookupDue(failed,now+11*60000)).toBe(true);
  expect(roadLookupDue(roadRecord([],gap,now),now+15*86400000)).toBe(true);
  let unroutable;for(let i=0;i<6;i++)unroutable=failedRecord(unroutable,now);
  expect(unroutable).toMatchObject({status:'none',failures:6});expect(roadLookupDue(unroutable,now+86400000)).toBe(false);
  let repeated=ok;for(let i=0;i<12;i++)repeated=failedRecord(repeated,now);
  expect(repeated.retryAfter-now).toBe(86400000);expect(failedRecord(failedRecord(undefined,now),now).retryAfter-now).toBe(20*60000);
 });
});

describe('automatic and historical reconstruction',()=>{
 // Places are cached so only road lookups run; a short trip keeps the test quick.
 function threeGapDrive(id='three',startedAt){const t=lowPowerDrive({id,...(startedAt?{startedAt}:{})});const keep=t.points.filter(p=>p.segment<=3);return {...t,points:keep,endedAt:keep.at(-1).timestamp};}
 function cachedPlaces(trips){const m=emptyGrouping(OWNER),now=Date.now();for(const t of trips)for(const p of t.points)m.places[placeKey(p)]={source:'apple-geocoder-mapkit',candidates:[{name:'x'}],lookupVersion:2,expiresAt:now+86400000};return m;}
 function run(trips,meta){const savePreferences=vi.fn().mockResolvedValue();renderHook(()=>useJourneyGrouping({owner:OWNER,activities:trips.map(recordedJourney),places:[],vehicles:[],serialized:JSON.stringify(meta),savePreferences}));return savePreferences;}
 const last=save=>JSON.parse(save.mock.calls.at(-1)[0].journeyGrouping);
 it('reconstructs each gap of new and old recordings once, newest first, and does not ask again',async()=>{
  const recent=threeGapDrive(),old=threeGapDrive('old',1700000000);
  mock.road.mockImplementation(async from=>{const g=[...routeGaps(recent),...routeGaps(old)].find(x=>x.from===from||x.from.timestamp===from.timestamp);return {routes:[roadFor(g)]};});
  const save=run([old,recent],cachedPlaces([old,recent]));
  await waitFor(()=>expect(save).toHaveBeenCalledTimes(6),{timeout:15000});
  expect(mock.road.mock.calls[0][0].timestamp).toBe(routeGaps(recent)[0].from.timestamp);
  const meta=last(save);
  expect(Object.values(meta.roads).every(r=>r.status==='route')).toBe(true);
  expect(Object.keys(meta.roads)).toHaveLength(6);
  cleanup();mock.road.mockClear();
  run([old,recent],meta);await new Promise(r=>setTimeout(r,400));
  expect(mock.road).not.toHaveBeenCalled();
  expect(project([old],meta.roads)[0].distanceEstimate.confidence).toBe('road');
 },20000);
 it('offline: keeps what it had, schedules a retry and shows the straight-line estimate meanwhile',async()=>{
  const trip=threeGapDrive();mock.road.mockRejectedValue(new Error('Road routes are unavailable: NSURLErrorDomain:-1009'));
  const save=run([trip],cachedPlaces([trip]));
  await waitFor(()=>expect(save).toHaveBeenCalledTimes(3),{timeout:15000});
  const meta=last(save);
  expect(Object.values(meta.roads).every(r=>r.retryAfter>Date.now()&&r.failures===1&&!r.status)).toBe(true);
  expect(project([trip],meta.roads)[0].distanceEstimate.confidence).toBe('straight');
 },20000);
 it('no road found: falls back to the straight line without retrying every cycle',async()=>{
  const trip=threeGapDrive();mock.road.mockResolvedValue({routes:[]});
  const save=run([trip],cachedPlaces([trip]));
  await waitFor(()=>expect(save).toHaveBeenCalledTimes(3),{timeout:15000});
  const meta=last(save);
  expect(Object.values(meta.roads).every(r=>r.status==='none'&&!roadLookupDue(r))).toBe(true);
 },20000);
 it('discards a road result that arrives after the account changed',async()=>{
  const trip=threeGapDrive();let finish;mock.road.mockImplementation(()=>new Promise(r=>{finish=r;}));
  const savePreferences=vi.fn().mockResolvedValue();
  const {rerender}=renderHook(p=>useJourneyGrouping(p),{initialProps:{owner:OWNER,activities:[recordedJourney(trip)],places:[],vehicles:[],serialized:JSON.stringify(cachedPlaces([trip])),savePreferences}});
  await waitFor(()=>expect(mock.road).toHaveBeenCalledTimes(1),{timeout:5000});
  rerender({owner:'other',activities:[],places:[],vehicles:[],serialized:JSON.stringify(emptyGrouping('other')),savePreferences});
  finish({routes:[roadFor(routeGaps(trip)[0])]});await new Promise(r=>setTimeout(r,200));
  expect(savePreferences).not.toHaveBeenCalled();
 },10000);
});
