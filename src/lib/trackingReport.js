import {adaptiveFindings} from './adaptiveDiagnostics.js';
export function trackingFindings(report){
 const events=(report.events||[]).filter(event=>event.at>=report.start&&event.at<=report.end);
 const findings=[];
 if(!events.length)findings.push('No persisted recorder events fall inside this time window. This does not establish whether iOS suspended, terminated, or never woke the app.');
 if(report.oldestAvailableAt>report.start)findings.push('The selected window starts before the oldest retained event. Earlier evidence is unavailable.');
 if(report.storageError)findings.push(report.storageError);
 const motion=events.filter(e=>e.kind==='motion');
 if(events.length&&!motion.length)findings.push('No motion classification deliveries were logged in this window.');
 const received=events.reduce((n,e)=>n+Number(e.kind==='observations'?e.context?.gpsDelivered||0:0),0);
 if(events.length)findings.push(`Observation summaries in this window contain ${received} delivered GPS fixes.`);
 for(const [key,label] of [['accuracy','outside route accuracy limits'],['deliveryTooOld','delivered too late'],['beforeTrackingBoundary','before the active tracking boundary'],['standbyNoDepartureEvidence','without enough departure evidence']]){
  const count=events.reduce((n,e)=>n+Number(e.context?.[`rejected.${key}`]||0),0);
  if(count)findings.push(`${count} GPS fixes were rejected ${label}.`);
 }
 const confirmations=events.filter(e=>e.kind==='detection');
 if(confirmations.length)findings.push(`${confirmations.length} automatic departures were confirmed.`);
 if(events.some(e=>e.kind==='error'))findings.push('Recorder errors were logged. Their timestamps and error codes are included in the report.');
 findings.push(...adaptiveFindings(report));
 return findings;
}
export function formatTrackingReport(report){return JSON.stringify({...report,findings:trackingFindings(report)},null,2);}
