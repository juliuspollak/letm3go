import {describe,expect,it} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {activityMap,activityPresentation,HEART_CHART_SAMPLES,PRESENTATION_SCHEMA} from './activityPresentation.js';
import {recordedJourney} from './recorder.js';
import {segmentRides} from './segmentRides.js';

const owner='11111111-1111-4111-8111-111111111111';
const points=Array.from({length:60},(_,i)=>({latitude:-34.42+i*0.0005,longitude:150.89+i*0.0004,timestamp:1790000000+i*5,accuracy:5,altitude:20+i,speed:3,segment:i<30?0:1}));
const samples=Array.from({length:1500},(_,i)=>({timestamp:1790000000+i*2,bpm:120+(i%40)}));
const base={id:'22222222-2222-4222-8222-222222222222',activity:'MTB',title:'Morning ride',startedAt:1790000000,endedAt:1790000300,durationSeconds:300,distanceMeters:5200,state:'finished',source:'device',recordingMode:'manual',updatedAt:1790000400,points,
 details:{description:'Good dirt',notes:'Bring water',tags:['Dirt'],collection:'Weekend',coverPhotoID:'p2',trackingNotes:['Started'],classification:{predicted:'MTB',confidence:'high',evidence:['Speed']},
  namedSegments:[{id:'seg-1',name:'Rock Garden',startIndex:2,endIndex:20,startTimestamp:points[2].timestamp,endTimestamp:points[20].timestamp,distanceMeters:900,durationSeconds:90,gapSeconds:0,pointCount:19,colorIndex:1,geometry:[]}],
  heartRate:{samples,summary:{average:140,maximum:160,minimum:120,gaps:1},pausePeriods:[{start:1790000100,end:1790000120}]}},
 localPhotos:[{id:'p1',caption:'',latitude:-34.42,longitude:150.89,locationSource:'gps',privateURI:'private-photo:a/b/p1',assetID:'asset-1',captureTime:1790000010},{id:'p2',caption:'Summit',locationSource:'unlocated',privateURI:'private-photo:a/b/p2'}]};
const journey=recordedJourney(base);
const grouping={metadata:{manualTags:{[base.id]:['Mine']},hiddenTags:{[base.id]:['Old']}},destinations:[],journeys:[]};
const present=(trip=journey,options={})=>activityPresentation(trip,{ownerID:owner,places:[],vehicles:[{id:'v1',name:'Trek',category:'bicycle'}],grouping,unit:'km',...options});

describe('activityPresentation',()=>{
 it('shows an ambiguous native stop with the evidence it lacked',()=>{
  const stop={id:'native:x:1',name:'Shops',tags:['Possible destination'],durationSeconds:900,charging:'none',verdict:'ambiguous',reasons:['stopped 15 min','no walking, visit or on-foot evidence; the phone may have stayed in the vehicle']};
  const [shown]=present({...journey,recognisedStops:[stop]}).stops;
  expect(shown.detail).toBe('15 min · no walking, visit or on-foot evidence; the phone may have stayed in the vehicle');
  expect(shown.tags).toContain('Possible destination');
  expect(present({...journey,recognisedStops:[{...stop,verdict:undefined,reasons:undefined}]}).stops[0].detail).toBe('15 min');
 });
 it('carries the identity native needs to reject stale or foreign updates',()=>{
  const p=present();
  expect(p).toMatchObject({schema:PRESENTATION_SCHEMA,ownerID:owner,activityID:base.id,updatedAt:1790000400});
 });
 it('uses the owning JavaScript rules for figures and units',()=>{
  expect(present().summary[0]).toMatchObject({id:'distance',value:'5.2 km'});
  expect(present(journey,{unit:'mi'}).summary[0].value).toBe('3.2 mi');
 });
 it('offers edits only on a local finished activity',()=>{
  expect(present().header.local).toBe(true);
  const read=present({...journey,readOnly:true});
  expect(read.header.local).toBe(false);
  expect(read.privacy).toBeNull();
  expect(present({...journey,state:'recording'}).tags).toBeNull();
 });
 it('never exposes held measurements, only the consent question',()=>{
  const trip=recordedJourney({...base,details:{...base.details,heartRate:undefined,unverifiedHeartRate:{samples,summary:{average:150}},unverifiedEnergy:{state:'final',active:300}}});
  const p=present(trip);
  expect(p.consent).toEqual({energy:true,heartRate:true});
  expect(p.heart.runs).toBeUndefined();
  expect(JSON.stringify(p.summary)).not.toContain('300');
 });
 it('thins the chart without joining gaps or losing the ends of a run',()=>{
  const {heart}=present();
  expect(heart.runs.flat().length).toBeLessThanOrEqual(HEART_CHART_SAMPLES+heart.runs.length);
  expect(heart.runs.length).toBeGreaterThan(1);
  expect(heart.runs[0][0].t).toBe(samples[0].timestamp);
  expect(heart.zones).toBeNull();
  expect(present(journey,{maximumHeartRate:190}).heart.zones.rows[0].name).toBe('Zone 5');
 });
 it('keeps the cover id and the saved visible window on the map',()=>{
  const p=present();
  expect(p.photos.coverID).toBe('p2');
  const trimmed=recordedJourney({...base,details:{...base.details,visibleRouteStart:10,visibleRouteEnd:40}});
  const map=activityMap(trimmed);
  expect(map.routes.flat().length).toBe(31);
  expect(map.pins.find(pin=>pin.kind==='start').point).toEqual([points[10].latitude,points[10].longitude]);
 });
 it('marks saved segment lines so a draft can leave out the one being edited',()=>{
  expect(present().map.styled.every(line=>line.segmentID==='seg-1')).toBe(true);
 });
 it('shows no route for an activity without one, however it was recorded',()=>{
  const historical=recordedJourney({...base,points:[],recordingMode:'historical',details:{}});
  const p=present(historical);
  expect(p.map.routes).toEqual([]);
  expect(p.trim).toBeNull();
  expect(p.header.noRouteDetail).toBe('This activity was added manually.');
 });
 it('offers route display only on a finished iPhone recording',()=>{
  expect(present().trim).toEqual({start:0,end:59,pointCount:60});
  expect(present({...journey,source:'watch'}).trim).toBeNull();
 });
 it('is the contract ActivityDetailsCore.swift decodes',()=>{
  const fixture=`${process.cwd()}/tests/fixtures/activity-presentation.json`;
  const current=JSON.stringify({...present(journey,{maximumHeartRate:190,segmentRides:segmentRides(journey,[journey])}),revision:1},null,1)+'\n';
  if(process.env.UPDATE_FIXTURES)writeFileSync(fixture,current);
  // The shape is the contract. Displayed times differ by the machine's time zone.
  const shape=value=>Array.isArray(value)?value.slice(0,1).map(shape):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,shape(value[key])])):value===null?'null':typeof value;
  expect(shape(JSON.parse(readFileSync(fixture,'utf8')))).toEqual(shape(JSON.parse(current)));
 });
});

describe('a long recording on the map',()=>{
 it('draws the whole ride within the map\'s limit, up to its last fix',()=>{
  const long=Array.from({length:7200},(_,i)=>({latitude:-34+i*0.00001,longitude:150,timestamp:1790000000+i,accuracy:5,altitude:0,speed:3,segment:0}));
  const map=activityMap(recordedJourney({...base,points:long,details:{}}));
  expect(Math.max(...map.routes.map(line=>line.length))).toBeLessThanOrEqual(5000);
  expect(map.routes.at(-1).at(-1)).toEqual([long.at(-1).latitude,long.at(-1).longitude]);
 });
});

it('renders a shared activity through the same detail schema without private controls',()=>{
 const trip={id:'shared:one',isShared:true,readOnly:true,source:'shared',state:'finished',ownerName:'Julia',title:'Walk',activity:'Walking',date:'2026-11-07',startedAt:1794010000,endedAt:1794011800,distanceMeters:2500,distance:2.5,durationSeconds:1800,points:[],route:[[ -34,151 ],[-34.01,151.01]],routeSegments:[[[ -34,151 ],[-34.01,151.01]]],photos:[],description:'Coast'};
 const p=activityPresentation(trip,{ownerID:'viewer'});
 expect(p.header).toMatchObject({readOnly:true,local:false});
 expect(p.editor).toBeNull();expect(p.privacy).toBeNull();expect(p.trim).toBeNull();expect(p.tags).toBeNull();expect(p.diagnostics).toBeNull();
 expect(p.map.routes).toHaveLength(1);
 expect(p.story.description).toBe('Coast');
});
