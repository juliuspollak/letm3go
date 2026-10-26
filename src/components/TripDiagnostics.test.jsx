import {expect,it} from 'vitest';
import {tripDiagnostics} from '../lib/tripDiagnostics.js';
it('identifies late GPS activation and gaps without inventing route points',()=>{
 const trip={startedAt:100,endedAt:290,distanceMeters:500,points:[
 {latitude:-34.5,longitude:150.8,timestamp:145,accuracy:12},
 {latitude:-34.501,longitude:150.81,timestamp:148,accuracy:9},
 {latitude:-34.502,longitude:150.82,timestamp:280,accuracy:14}]};
 const report=tripDiagnostics(trip);
 expect(report.points).toBe(3);
 expect(report.lag).toBe(45);
 expect(report.longestGap).toBe(132);
 expect(report.warnings).toContain('Recording began before accurate GPS was available');
 expect(report.warnings).toContain('Long gap between GPS samples');
});
it('reports a very short unknown detection for manual review',()=>{
 const report=tripDiagnostics({startedAt:100,endedAt:155,activity:'Unknown',distanceMeters:0,points:[]});
 expect(report.warnings).toContain('Short low-distance detection; review classification');
});
