import { expect, it } from 'vitest';
import { recordedJourney, visibleRecorderJourneys, provisionalJourney, speedLabel, paceLabel } from './recorder.js';
it('preserves native provenance and pause gaps without fabricating route points',()=>{
 const trip=recordedJourney({id:'real',startedAt:1000,source:'device',title:'Walk',points:[{latitude:1,longitude:2,segment:0},{latitude:3,longitude:4,segment:1}],distanceMeters:1000,durationSeconds:600});
 expect(trip.source).toBe('device');
 expect(trip.trail).toBeNull();
 expect(trip.routeSegments).toEqual([[[1,2]],[[3,4]]]);
 expect(trip.cover).toBeNull();
 expect(trip.photos).toEqual([]);
 expect(trip.distance).toBe(1);
});
it('exposes a published stop and locates it for the recorder panel',()=>{
 const stopped={id:'stopped',source:'device',recordingMode:'automatic',state:'paused',startedAt:1000,endedAt:1600,distanceMeters:1200,durationSeconds:600,points:[],details:{provisional:true,continuationEndsAt:2800}};
 const journey=recordedJourney(stopped);
 expect(journey.provisional).toBe(true);
 expect(journey.continuationEndsAt).toBe(2800);
 expect(provisionalJourney({trips:[{id:'done',details:{}},stopped]})).toMatchObject({id:'stopped'});
 expect(provisionalJourney({trips:[{id:'done',details:{}}]})).toBeNull();
 expect(provisionalJourney(undefined)).toBeNull();
 expect(recordedJourney({...stopped,details:{}}).provisional).toBe(false);
 expect(recordedJourney({...stopped,details:{}}).continuationEndsAt).toBeNull();
});
it('keeps a published stop visible in History while it is excluded from grouping',()=>{
 const stopped={id:'stopped',source:'device',recordingMode:'automatic',state:'paused',startedAt:1000,endedAt:1600,distanceMeters:1200,durationSeconds:600,points:[],details:{provisional:true,continuationEndsAt:2800}};
 const state={ownerID:'owner',trips:[stopped],automaticTrip:null};
 const visible=visibleRecorderJourneys([],state,'owner');
 expect(visible).toHaveLength(1);expect(visible[0]).toMatchObject({id:'stopped',provisional:true});
 // The recorder keeps one record: a continued journey is not listed twice.
 expect(visibleRecorderJourneys(visible,state,'owner')).toHaveLength(1);
 expect(visibleRecorderJourneys([],{...state,trips:[stopped]},'other')).toEqual([]);
 const finalised={...stopped,details:{}};
 expect(visibleRecorderJourneys([],{...state,trips:[finalised]},'owner')).toEqual([]);
});
it('exposes a linked community trail on a recorded ride',()=>{
 const linked=recordedJourney({id:'ride',source:'device',activity:'MTB',state:'finished',startedAt:1000,endedAt:2200,distanceMeters:5000,durationSeconds:1200,points:[{latitude:1,longitude:2,segment:0},{latitude:3,longitude:4,segment:0}],details:{mtbTrailID:'11111111-1111-4111-8111-111111111111',mtbTrailName:'Fern Gully',mtbTrailDistanceMeters:4200}});
 expect(linked.trail).toEqual({id:'11111111-1111-4111-8111-111111111111',name:'Fern Gully',segmentID:null,distanceMeters:4200});
});
it('calculates speed and pace with safe zero-distance states',()=>{
 expect(speedLabel(1000,600)).toBe('6.0 km/h');
 expect(paceLabel(1000,600)).toBe('10:00 /km');
 expect(paceLabel(0,10)).toBe('—');
 expect(speedLabel(0,0)).toBe('—');
});

it('shows an automatic drive before arrival confirmation and replaces it with its finished projection',()=>{
 const trip={id:'drive',source:'device',recordingMode:'automatic',state:'recording',startedAt:1000,points:[],distanceMeters:1000,durationSeconds:120};
 const recording={ownerID:'OWNER',automaticTrip:trip};
 const visible=visibleRecorderJourneys([],recording,'owner');
 expect(visible).toHaveLength(1);expect(visible[0]).toMatchObject({id:'drive',state:'recording',distance:1});
 const finished=recordedJourney({...trip,state:'finished',endedAt:1120});
 expect(visibleRecorderJourneys([finished],{ownerID:'owner',automaticTrip:null},'owner')).toEqual([finished]);
 // Native and grouping snapshots may overlap briefly during arrival processing.
 expect(visibleRecorderJourneys([finished],recording,'owner')).toEqual([finished]);
 const grouped={id:'journey:earlier',segmentIDs:['earlier','drive']};
 expect(visibleRecorderJourneys([grouped],recording,'owner')).toEqual([grouped]);
 expect(visibleRecorderJourneys([],recording,'other')).toEqual([]);
});
