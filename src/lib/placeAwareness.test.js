import {expect,it} from 'vitest';
import {placeText} from './placeAwareness.js';
import {formatJourneyReport,journeyFindings,journeySummary} from './journeyReport.js';

it('describes the current place without coordinates',()=>{
 expect(placeText({state:'saved',kind:'home',radiusMeters:50,minutes:42,settled:true,lastDecision:''})).toBe('Home (saved) · about 50 m · 42 min · settled');
 expect(placeText({state:'arrival',kind:'none',radiusMeters:230,minutes:12,settled:true,lastDecision:'Local walking within the arrival area: 581 m over 2328 s, never beyond the area'}))
  .toContain('Where the last journey stopped · about 230 m');
 expect(placeText({state:'none',radiusMeters:0,minutes:0,settled:false,lastDecision:'Walk left the saved area'})).toBe('No current place · last: Walk left the saved area');
 expect(placeText(undefined)).toBe('Not reported by installed native build');
});

it('reports a deliberate stop separately from GPS gaps',()=>{
 const report={activity:'Walking',startedAt:1000,endedAt:3000,generatedAt:3000,recordedDistanceMeters:2400,events:[],
  routeQuality:{fixCount:400,gapCount:0,largestGapSeconds:12,unobservedSeconds:0,unobservedMeters:0,stopCount:1,stoppedSeconds:507}};
 const findings=journeyFindings(report);
 expect(findings).toContain('Stopped 1 time for 8 min 27 s in total, then continued. Stops are not GPS gaps.');
 expect(findings).toContain('No GPS gaps: the route was observed continuously.');
 expect(journeySummary(report)).toContainEqual(['Stopped','1 stop · 8 min 27 s']);
 expect(formatJourneyReport(report)).not.toMatch(/GPS gap(s)? with no route/);
});

it('keeps reading exports from builds without stop fields',()=>{
 const report={activity:'Driving',startedAt:0,endedAt:600,generatedAt:600,events:[],routeQuality:{fixCount:50,gapCount:1,largestGapSeconds:276,unobservedSeconds:276,unobservedMeters:900}};
 expect(journeySummary(report)).toContainEqual(['Stopped','—']);
 expect(journeyFindings(report).some(f=>f.startsWith('1 GPS gap'))).toBe(true);
});

it('does not show a deliberate stop as a GPS coverage gap on the Diagnostics screen',async()=>{
 const {quality}=await import('./recordingQuality.js');
 const walk=(from,to,start,segment)=>Array.from({length:to-from+1},(_,i)=>({latitude:-33+(from+i)*6.5/111320,longitude:151,timestamp:start+i*5,accuracy:8,segment}));
 const points=[...walk(0,60,0,0),...walk(62,82,807,1)];
 const trip={startedAt:0,endedAt:907,points,details:{stops:[{start:300,end:807}]}};
 const q=quality(trip);
 expect(q).toMatchObject({stops:1,stoppedSeconds:507,broken:0,gap:5});
 expect(q.warnings).not.toContain('GPS coverage gaps');
 const before=quality({...trip,details:{}});
 expect(before).toMatchObject({stops:0,broken:1,gap:507});
 expect(before.warnings).toContain('GPS coverage gaps');
});
