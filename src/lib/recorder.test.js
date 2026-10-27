import { expect, it } from 'vitest';
import { recordedJourney, visibleRecorderJourneys, speedLabel, paceLabel } from './recorder.js';
it('preserves native provenance and pause gaps without fabricating route points',()=>{
 const trip=recordedJourney({id:'real',startedAt:1000,source:'device',title:'Walk',points:[{latitude:1,longitude:2,segment:0},{latitude:3,longitude:4,segment:1}],distanceMeters:1000,durationSeconds:600});
 expect(trip.source).toBe('device');
 expect(trip.routeSegments).toEqual([[[1,2]],[[3,4]]]);
 expect(trip.cover).toBeNull();
 expect(trip.photos).toEqual([]);
 expect(trip.distance).toBe(1);
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
