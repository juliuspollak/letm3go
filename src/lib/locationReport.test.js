import {expect,it} from 'vitest';
import {formatLocationReport,locationReportChunks} from './locationReport.js';
const base={generatedAt:1793320000,timezone:'Australia/Sydney',current:{version:'1',build:'50',commit:'source',locationMode:'resting',placeType:'home',backgroundSession:'held'},events:[],journeys:[],retentionDays:7,eventLimit:6000,byteLimit:8388608,capacityEvictions:0};
it('exports current Home state without needing an active or recent journey',()=>{
 const text=locationReportChunks(base)[0];
 expect(text).toContain('BEGIN LETM3GO FULL LOCATION LOG');expect(text).toContain('END LETM3GO FULL LOCATION LOG');
 expect(text).toContain('placeType: home');expect(text).toContain('No recent journeys');expect(text).toContain('source commit: source');expect(text).toContain('Timezone: Australia/Sydney');
});
it('keeps overnight chronology, transitions, errors, statistics and subsequent journey summaries',()=>{
 const report={...base,current:{...base.current,placeType:'inferred'},events:[{at:300,kind:'error',message:'Core Location error',context:{code:'0'}},{at:100,kind:'place',message:'Settled at inferred place',context:{component:'PlaceAwareness'}},{at:200,kind:'observations',message:'Summary',context:{gpsDelivered:'3','rejected.accuracy':'2',routeFixesSaved:'1'}}],journeys:[{journeyID:'journey-1',startedAt:250,fixCount:1,gapCount:0}]};
 const text=formatLocationReport(report);
 const full=text.split('3. FULL RETAINED CHRONOLOGICAL EVENT LOG')[1].split('4. RECENT')[0];
 expect(full.indexOf('Settled at inferred place')).toBeLessThan(full.indexOf('Core Location error'));
 expect(text).toContain('"gpsDelivered":3');expect(text).toContain('"rejected.accuracy":2');expect(text).toContain('journey-1');expect(text).toContain('6. IMPORTANT ERRORS');
});
it('chunks the complete UTF-8 output without losing or silently truncating events',()=>{
 const report={...base,capacityEvictions:2,events:Array.from({length:70},(_,i)=>({at:100+i,kind:'service',message:`Event ${i} · 移動 🧭`,context:{reason:'settled',locationMode:'resting'}}))};
 const chunks=locationReportChunks(report,2048);
 expect(chunks.length).toBeGreaterThan(1);
 const text=chunks.map((part,index)=>{expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(2048);expect(part).toContain(`PART ${index+1}/${chunks.length}`);return part.slice(part.indexOf('\n')+1,part.lastIndexOf('\n=== END'));}).join('');
 expect(text).toBe(formatLocationReport(report)+'\n');expect(text).toContain('older evidence has been removed');
});
it('preserves an individual oversized Unicode field across explicit numbered parts',()=>{
 const report={...base,current:{reason:'🧭'.repeat(2000)}};
 const parts=locationReportChunks(report,2048);
 const text=parts.map(part=>part.slice(part.indexOf('\n')+1,part.lastIndexOf('\n=== END'))).join('');
 expect(text).toBe(formatLocationReport(report)+'\n');
 for(const part of parts)expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(2048);
});
