import { expect, it } from 'vitest';
import { recordedJourney, speedLabel, paceLabel } from './recorder.js';
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
