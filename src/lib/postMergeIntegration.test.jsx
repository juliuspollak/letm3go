import {cleanup,render} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const seen=vi.hoisted(()=>({journeys:null}));
vi.mock('../components/ActivityPrivacy.jsx',()=>({default:()=>null}));
vi.mock('../components/JourneyMap.jsx',()=>({default:({journeys})=>{seen.journeys=journeys;return null;}}));
import ActivityDetail from '../components/ActivityDetail.jsx';
import {recordedJourney} from './recorder.js';
import {displaySegments} from './mapGeometry.js';
import {routeSignature} from './routeDensity.js';
import {feedbackDiagnostics} from './feedback.js';
import {heartRateRuns} from './heartRate.js';
import {publicationPreview} from './activityPrivacy.js';
afterEach(cleanup);
// How the merged features meet: Watch records through route geometry, through the
// detail map, through feedback diagnostics and through publication.
const point=(latitude,timestamp,segment=0,accuracy=5)=>({latitude,longitude:151,timestamp,segment,accuracy,altitude:1,speed:2});
const watchTrip=(points,details={})=>({id:'t',activity:'Running',source:'watch',recordingMode:'watch',state:'finished',title:'Run',startedAt:1000,endedAt:2000,distanceMeters:500,accumulatedSeconds:900,points,details});

it('uses the same route geometry on the detail map as everywhere else',()=>{
 // A restored recording reused segment 0 after segment 1: grouping by ID joins the ends.
 const points=[point(-33.80,1000,0),point(-33.8001,1005,0),point(-33.70,1010,1),point(-33.7001,1015,1),point(-33.60,1020,0),point(-33.6001,1025,0)];
 const trip=recordedJourney(watchTrip(points));
 render(<ActivityDetail trip={trip} places={[]}/>);
 const drawn=seen.journeys[0].routeSegments;
 expect(drawn).toEqual(trip.routeSegments);
 expect(drawn).toHaveLength(3);
});
it('never bridges a Watch pause on the map, and leaves the recording untouched',()=>{
 const points=[point(-33.80,1000,0),point(-33.8001,1005,0),point(-33.8002,1100,2),point(-33.8003,1105,2)];
 const copy=structuredClone(points);
 const trip=recordedJourney(watchTrip(points));
 expect(trip.routeSegments).toHaveLength(2);
 expect(points).toEqual(copy);
 expect(trip.distanceMeters).toBe(500);
});
it('carries an indoor Watch workout with no route through every shared path',()=>{
 const samples=[{timestamp:1010,bpm:120},{timestamp:1015,bpm:125}];
 const trip=recordedJourney(watchTrip([],{indoor:true,heartRate:{samples,pausePeriods:[],summary:{average:122,maximum:125,minimum:120,samples:2,gaps:0}}}));
 expect(trip.routeSegments).toEqual([]);
 expect(displaySegments(trip)).toEqual([]);
 expect(heartRateRuns(samples)).toHaveLength(1);
 expect(()=>render(<ActivityDetail trip={trip} places={[]}/>)).not.toThrow();
});
it('sends no heart rate, position or overlap detail in feedback diagnostics or a publication',()=>{
 const trip=watchTrip([point(-33.8,1000)],{heartRate:{samples:[{timestamp:1000,bpm:150}]},unverifiedHeartRate:{samples:[{timestamp:1001,bpm:151}]},overlaps:[{title:'Secret'}]});
 const text=JSON.stringify(feedbackDiagnostics({state:{trips:[trip],active:trip,version:'1',build:'2'}}))+JSON.stringify(publicationPreview({...trip,details:trip.details},[]));
 expect(text).not.toMatch(/bpm|heartRate|Secret|overlaps/i);
 expect(JSON.stringify(feedbackDiagnostics({state:{trips:[trip]}}))).not.toMatch(/-33\.8/);
});

it('draws a coordinate-only route whose segments are empty',()=>{
 const route=[[-33.8,151],[-33.8001,151]];
 expect(displaySegments({route,routeSegments:[]})).toEqual([route]);
 expect(routeSignature({route,routeSegments:[]})).not.toBe(routeSignature({route:[],routeSegments:[]}));
});
it('says there is no route rather than joining fixes the display rejected',()=>{
 const point=(n,accuracy)=>({latitude:-33.8+n*.0001,longitude:151,timestamp:1000+n*5,accuracy,segment:0,speed:2,altitude:0});
 const journey=recordedJourney({id:'x',activity:'Walking',source:'device',recordingMode:'manual',state:'finished',title:'Walk',startedAt:1000,endedAt:1100,distanceMeters:0,accumulatedSeconds:100,points:[point(0,200),point(1,200),point(2,200)],details:{}});
 expect(journey.route).toEqual([]);
 expect(displaySegments(journey)).toEqual([]);
 expect(journey.points).toHaveLength(3);
});
