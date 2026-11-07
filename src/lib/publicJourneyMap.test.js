import {expect,it} from 'vitest';
import {publicJourneyMap} from './publicJourneyMap.js';
it('preserves redacted gaps and positions only authorised snapshot photos',()=>{
 const result=publicJourneyMap({points:[{latitude:-34,longitude:151,segment:0},{latitude:-34.1,longitude:151,segment:0},{latitude:-34.5,longitude:151,segment:3}],photos:[{id:'ok',caption:'Beach',latitude:-34.1,longitude:151},{id:'no-position',caption:'Home'},{id:'invalid',latitude:999,longitude:151}]});
 expect(result.routeSegments).toEqual([[[-34,151],[-34.1,151]],[[-34.5,151]]]);
 expect(result.photos).toEqual([{id:'ok',caption:'Beach',point:[-34.1,151]}]);
});
it('does not fabricate points from malformed shared data',()=>{
 expect(publicJourneyMap(null)).toBeNull();
 const result=publicJourneyMap({points:[{latitude:0,longitude:0,segment:0},{latitude:-34,longitude:151,segment:1},{latitude:200,longitude:151,segment:1},{latitude:-34.5,longitude:151,segment:1}],photos:[]});
 expect(result.routeSegments).toEqual([[[-34,151]],[[-34.5,151]]]);
});
