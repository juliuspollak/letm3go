import { describe, expect, it } from 'vitest';
import { formatJourneyReport, journeyEvents, journeyFindings, journeySummary } from './journeyReport.js';

// Shaped like the build 46 drive: a 276 s silence the app slept through.
const report={
 schemaVersion:1,generatedAt:1761685000,journeyID:'trip',startedAt:1761680098,endedAt:1761680800,activity:'Driving',state:'finished',
 recordedDistanceMeters:859.095,
 routeQuality:{fixCount:34,gapCount:1,largestGapSeconds:276.475,unobservedSeconds:276.475,unobservedMeters:493.807},
 trackingNotes:['GPS resumed after 276s without saved route samples; 493m straight-line gap excluded from distance'],
 events:[
  {at:1761680155,kind:'detection',message:'Automatic departure confirmed',context:{process:'a',appState:'background',bufferedFixes:'11',confirmationDelaySeconds:'57.2',desiredAccuracyMeters:'-1'}},
  {at:1761680464,kind:'lifecycle',message:'Recorder was not executing for 276s',context:{process:'a',appState:'background',notExecutingSeconds:'276',wakeCause:'location'}},
  {at:1761680464,kind:'recovery',message:'Automatic GPS silent for 276s, of which the recorder was not executing for 216s; location updates left running',context:{process:'a',silentSeconds:'276'}},
  {at:1761680465,kind:'delivery',message:'Delayed location batch delivered',context:{process:'a',batchFixes:'4',oldestAgeSeconds:'190'}},
  {at:1761680500,kind:'observations',message:'Recorder observation summary',context:{process:'b',gpsDelivered:'9','rejected.deliveryTooOld':'3'}},
  {at:1761680800,kind:'finalisation',message:'Automatic journey finalised',context:{process:'b',finalisedBy:'arrivalTimer',finalisationReason:'Journey ended after the continuation window'}},
 ],
 current:{version:'1.0',build:'47',iOS:'27.0.1',commit:'abc123def456'},
 limitations:'No coordinates.',
};

describe('journey report',()=>{
 it('explains suspension, gaps, late fixes and how the journey ended in plain English',()=>{
  const findings=journeyFindings(report).join('\n');
  expect(findings).toContain('iOS stopped running the app 1 time (longest 4 min 36 s); woken by location');
  expect(findings).toContain('1 GPS gap with no route (dashed on the map), totalling 4 min 36 s and at least 494 m straight-line');
  expect(findings).toContain('detected only after iOS resumed the app');
  expect(findings).toContain('delivered late (oldest fix 3 min 10 s old)');
  expect(findings).toContain('3 GPS fixes were discarded for arriving more than 2 minutes late');
  expect(findings).toContain('The app restarted during this journey (2 app processes)');
  expect(findings).toContain('Ended by arrivalTimer: Journey ended after the continuation window.');
 });
 it('summarises the journey with readable units',()=>{
  const summary=Object.fromEntries(journeySummary(report));
  expect(summary['Recorded distance']).toBe('859 m');
  expect(summary['GPS fixes']).toBe('34');
  expect(summary['Largest gap']).toBe('4 min 36 s');
  expect(summary.Duration).toBe('11 min 42 s');
 });
 it('shows only event-specific details in the timeline and marks a new app process',()=>{
  const events=journeyEvents(report);
  expect(events[0].details).toBe('buffered fixes: 11 · confirmation delay (s): 57 · app background');
  expect(events[0].details).not.toContain('desiredAccuracy');
  expect(events[4].newProcess).toBe(true);
  expect(events[4].details).toContain('rejected: deliveryTooOld 3');
 });
 it('copies a readable report that still carries the unchanged raw export',()=>{
  const text=formatJourneyReport(report);
  expect(text).toMatch(/^Letm3go journey diagnostics/);
  expect(text).toContain('App build: 1.0 (47) · commit abc123def456 · iOS 27.0.1');
  expect(text).toContain('What happened\n- iOS stopped running the app');
  expect(text).toContain('--- app restarted (new process) ---');
  expect(text).toContain('Raw export (for engineering)');
  expect(JSON.parse(text.slice(text.indexOf('Raw export (for engineering)\n')+29))).toEqual(report);
 });
 it('says whether a background location session was held during the journey',()=>{
  const held=report.events.map(event=>({...event,context:{...event.context,backgroundSession:'held'}}));
  expect(journeyFindings({...report,events:held})).toContain('A background location session was held throughout, so iOS was asked to keep the app running.');
  const lost=held.map((event,index)=>index===1?{...event,context:{...event.context,backgroundSession:'awaitingForeground'}}:event);
  expect(journeyFindings({...report,events:lost}).join(' ')).toContain('No background location session was held for part of this journey (awaitingForeground)');
  expect(journeyFindings(report).join(' ')).not.toContain('background location session');
 });
 it('reports a failed export as its error and says when no events were saved',()=>{
  expect(formatJourneyReport({error:'This journey could not be exported on this build.'})).toBe('This journey could not be exported on this build.');
  expect(journeyFindings({...report,events:[]})).toContain('No recorder events were saved for this journey, so the log cannot explain its gaps.');
 });
});
