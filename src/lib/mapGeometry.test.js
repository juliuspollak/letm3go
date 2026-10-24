import { expect,it } from 'vitest';
import { displaySegments } from './mapGeometry.js';
it('limits dense map geometry without joining pause gaps or mutating native points',()=>{const first=Array.from({length:5000},(_,i)=>[i,1]),second=Array.from({length:5000},(_,i)=>[i,2]);const trip={routeSegments:[first,second]};const result=displaySegments(trip);expect(result.flat().length).toBeLessThanOrEqual(2004);expect(result[0][0]).toEqual(first[0]);expect(result[0].at(-1)).toEqual(first.at(-1));expect(result[1][0]).toEqual(second[0]);expect(first).toHaveLength(5000);});
