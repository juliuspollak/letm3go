import {expect,it} from 'vitest';
import {recognisedStopVenue} from './stopVenueRecognition.js';
import {buildJourneys,emptyGrouping,placeKey,nativeStops} from './journeyGrouping.js';
import {recognitionSampleIndexes} from './journeyRecognition.js';
import {recordedJourney} from './recorder.js';

const owner='owner';
const p=(latitude,longitude,timestamp,segment=0)=>({latitude,longitude,timestamp,segment,accuracy:5,altitude:0,speed:0});
const home=p(-34.545,150.865,10000);
const shops=p(-34.55,150.87,10600);
const mall={name:'Warilla Grove',category:'shoppingCentre',latitude:shops.latitude+.0003,longitude:shops.longitude,placeID:'apple:mall'};
const tenant={name:'Petbarn',category:'store',latitude:shops.latitude,longitude:shops.longitude,placeID:'apple:petbarn'};
const homePlace={id:'home',name:'Home',kind:'home',latitude:home.latitude,longitude:home.longitude,radius:150};
const stop={start:10600,end:11291,verdict:'ambiguous',confidence:'low',reasons:['stopped 11 min']};

function example(){
 return recordedJourney({id:'warilla-trip',ownerID:owner,source:'device',state:'finished',
  recordingMode:'automatic',activity:'Driving',title:'Home → Home · stopped 11 min',
  startedAt:10000,endedAt:12000,durationSeconds:1309,distanceMeters:3246,
  points:[home,shops,p(shops.latitude,shops.longitude,11291,1),p(home.latitude,home.longitude,12000,1)],
  details:{stops:[stop],tags:[]}});
}

it('recognises an unambiguous shopping centre at a native 11-minute stop, not a closer tenant',()=>{
 const meta=emptyGrouping(owner);
 meta.places[placeKey(shops)]={stopLookup:true,source:'apple-geocoder-mapkit',locality:'Warilla',
  candidates:[tenant,mall]};
 const trip=example(),before=JSON.stringify(trip);
 const result=buildJourneys([trip],{owner,metadata:meta,places:[homePlace]});
 const journey=result.journeys[0],native=journey.recognisedStops.filter(s=>s.id.startsWith('native:'));
 expect(native).toHaveLength(1);
 expect(native[0]).toMatchObject({name:'Warilla Grove',nearbyName:'Warilla Grove',durationSeconds:691});
 expect(journey.tags).toContain('Warilla Grove');
 expect(journey.tags).not.toContain('Home');
 expect(journey.title).toBe('Home → Warilla Grove → Home');
 expect(JSON.stringify(trip)).toBe(before);
 expect(journey.points).toEqual(trip.points);
 expect(journey.distanceMeters).toBe(3246);
 const selected=recognitionSampleIndexes(trip,nativeStops(trip,{owner,metadata:meta,places:[homePlace],vehicles:[],telemetry:[]}));
 expect(selected).toContain(1);
});

it('never promotes a random business, an unsearched cache or a short stop to a shopping centre',()=>{
 const record={stopLookup:true,candidates:[tenant,mall]};
 expect(recognisedStopVenue(record,shops,691)?.name).toBe('Warilla Grove');
 expect(recognisedStopVenue({...record,stopLookup:false},shops,691)).toBeNull();
 expect(recognisedStopVenue({stopLookup:true,candidates:[tenant]},shops,691)).toBeNull();
 expect(recognisedStopVenue(record,shops,120)).toBeNull();
 expect(recognisedStopVenue(record,home,691)).toBeNull();
 expect(recognisedStopVenue({stopLookup:true,candidates:[mall,{...mall,name:'Second Mall',latitude:mall.latitude+.0001}]},shops,691)).toBeNull();
});

it('keeps existing manual titles, hidden tags and renamed stops authoritative',()=>{
 const meta=emptyGrouping(owner);
 meta.places[placeKey(shops)]={stopLookup:true,candidates:[mall]};
 meta.titles['warilla-trip']='My shopping drive';
 meta.hiddenTags['warilla-trip']=['Warilla Grove'];
 const trip=example();
 let journey=buildJourneys([trip],{owner,metadata:meta,places:[homePlace]}).journeys[0];
 expect(journey.title).toBe('My shopping drive');
 expect(journey.tags).not.toContain('Warilla Grove');
 const id=`native:${trip.id}:${stop.start}`;
 meta.stopEdits[id]={name:'My preferred shop',tags:[]};
 journey=buildJourneys([trip],{owner,metadata:meta,places:[homePlace]}).journeys[0];
 expect(journey.recognisedStops[0].name).toBe('My preferred shop');
 expect(journey.title).toBe('My shopping drive');
});

it('does not reinterpret a traffic pause or a trip with no native stop evidence',()=>{
 const meta=emptyGrouping(owner);
 meta.places[placeKey(shops)]={stopLookup:true,candidates:[mall]};
 const trip=example();
 trip.details.stops=[{...stop,verdict:'temporaryPause'}];
 const journey=buildJourneys([trip],{owner,metadata:meta,places:[homePlace]}).journeys[0];
 expect(journey.recognisedStops).toEqual([]);
 expect(journey.tags).not.toContain('Warilla Grove');
 expect(journey.title).toBe(trip.title);
});
