import {expect,it} from 'vitest';
import {trackingFindings,formatTrackingReport} from './trackingReport.js';
it('does not label missing evidence as a proven force quit or suspension',()=>{
 const report={start:100,end:200,oldestAvailableAt:90,events:[{at:90,kind:'motion',context:{motionTypes:'Driving'}}]};
 expect(trackingFindings(report)).toEqual([expect.stringContaining('does not establish whether iOS')]);
 expect(JSON.parse(formatTrackingReport(report)).events).toEqual(report.events);
});
it('identifies unavailable retention and actual save errors separately',()=>{
 const findings=trackingFindings({start:100,end:200,oldestAvailableAt:150,storageError:'History write failed',events:[{at:160,kind:'error',context:{code:'28'}}]});
 expect(findings).toContain('The selected window starts before the oldest retained event. Earlier evidence is unavailable.');
 expect(findings).toContain('History write failed');
 expect(findings).toContain('Recorder errors were logged. Their timestamps and error codes are included in the report.');
});
