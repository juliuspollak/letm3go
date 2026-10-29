// Turns the native journey export into plain English for a bug report. The raw
// export is appended unchanged, so nothing is lost for engineering analysis.
const time=at=>new Date(at*1000).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
const dateTime=at=>new Date(at*1000).toLocaleString('en-AU',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
const span=s=>{const n=Math.max(0,Math.round(Number(s)||0));return n>=60?`${Math.floor(n/60)} min ${n%60} s`:`${n} s`;};
const metres=m=>{const n=Number(m)||0;return n>=1000?`${(n/1000).toFixed(2)} km`:`${Math.round(n)} m`;};
const count=(events,match)=>events.filter(match).length;

// Event-specific values worth showing in the timeline. Everything else in an
// event's context is a recorder-wide snapshot and stays in the raw export.
const DETAIL_KEYS=[
 ['wakeCause','woken by'],['notExecutingSeconds','not running (s)'],['silentSeconds','silent (s)'],
 ['silentWhileExecutingSeconds','silent while running (s)'],['gapSeconds','gap (s)'],['gapMeters','gap (m)'],
 ['batchFixes','fixes in batch'],['oldestAgeSeconds','oldest fix age (s)'],['gpsDelivered','fixes delivered'],
 ['routeFixesSaved','fixes saved'],['bufferedFixes','buffered fixes'],['confirmationDelaySeconds','confirmation delay (s)'],
 ['predicted','classified as'],['configuration','GPS configuration'],['reason','reason'],['launchState','launched in'],['finalisedBy','finalised by'],['finalisationReason','reason'],['savedFixes','saved fixes'],['code','error code'],
];
function details(event){
 const context=event.context||{};
 const parts=DETAIL_KEYS.filter(([key])=>context[key]!=null&&context[key]!=='').map(([key,label])=>`${label}: ${key.endsWith('Seconds')?Math.round(Number(context[key])):context[key]}`);
 const rejected=Object.entries(context).filter(([key,value])=>key.startsWith('rejected.')&&Number(value)>0).map(([key,value])=>`${key.slice(9)} ${value}`);
 if(rejected.length)parts.push(`rejected: ${rejected.join(', ')}`);
 if(context.appState)parts.push(`app ${context.appState}`);
 return parts.join(' · ');
}

export function journeyEvents(report){
 let previousProcess=null;
 return (report.events||[]).map(event=>{
  const process=event.context?.process||null;
  const newProcess=previousProcess!=null&&process!=null&&process!==previousProcess;
  if(process)previousProcess=process;
  return {at:event.at,time:time(event.at),kind:event.kind,message:event.message,details:details(event),newProcess};
 });
}

export function journeyFindings(report){
 if(report.error)return [report.error];
 const events=report.events||[];
 const quality=report.routeQuality||{};
 const findings=[];
 const notExecuting=events.filter(e=>/^Recorder was not executing/.test(e.message));
 if(notExecuting.length){
  const longest=Math.max(...notExecuting.map(e=>Number(e.context?.notExecutingSeconds)||0));
  const causes=[...new Set(notExecuting.map(e=>e.context?.wakeCause).filter(Boolean))];
  findings.push(`iOS stopped running the app ${notExecuting.length} time${notExecuting.length===1?'':'s'} (longest ${span(longest)})${causes.length?`; woken by ${causes.join(', ')}`:''}. GPS cannot be recorded while the app is not running.`);
 }
 if(quality.gapCount>0)findings.push(`${quality.gapCount} GPS gap${quality.gapCount===1?'':'s'} with no route (dashed on the map), totalling ${span(quality.unobservedSeconds)} and at least ${metres(quality.unobservedMeters)} straight-line. Largest gap ${span(quality.largestGapSeconds)}.`);
 else if(quality.fixCount)findings.push('No GPS gaps: the route was observed continuously.');
 // Whether iOS was asked to keep the app running in the background (build 47+).
 const sessionStates=[...new Set(events.map(e=>e.context?.backgroundSession).filter(Boolean))];
 if(sessionStates.length){
  const missing=sessionStates.filter(state=>!['held','rejoined'].includes(state));
  if(missing.includes('unsupported'))findings.push('This iOS version has no background location session (iOS 17 or later is required).');
  else findings.push(missing.length?`No background location session was held for part of this journey (${missing.join(', ')}). Open the app once so it can start one.`:'A background location session was held throughout, so iOS was asked to keep the app running.');
 }
 const restarts=count(events,e=>/restarting location updates/.test(e.message));
 const leftRunning=count(events,e=>/location updates left running/.test(e.message));
 if(restarts)findings.push(`The GPS watchdog restarted location updates ${restarts} time${restarts===1?'':'s'}.`);
 if(leftRunning)findings.push(`${leftRunning} GPS silence${leftRunning===1?' was':'s were'} detected only after iOS resumed the app, so location updates were left running.`);
 const delayed=events.filter(e=>e.message==='Delayed location batch delivered');
 if(delayed.length)findings.push(`${delayed.length} location batch${delayed.length===1?' was':'es were'} delivered late (oldest fix ${span(Math.max(...delayed.map(e=>Number(e.context?.oldestAgeSeconds)||0)))} old).`);
 const tooOld=events.reduce((n,e)=>n+(Number(e.context?.['rejected.deliveryTooOld'])||0),0);
 if(tooOld)findings.push(`${tooOld} GPS fix${tooOld===1?' was':'es were'} discarded for arriving more than 2 minutes late.`);
 const processes=new Set(events.map(e=>e.context?.process).filter(Boolean));
 if(processes.size>1)findings.push(`The app restarted during this journey (${processes.size} app processes).`);
 if(events.some(e=>/Interrupted automatic journey restored|Restored automatic journey reopened/.test(e.message)))findings.push('The journey was restored after the app restarted.');
 if(events.some(e=>e.kind==='error'))findings.push('The recorder logged errors; see the timeline.');
 const finalised=[...events].reverse().find(e=>e.context?.finalisedBy);
 if(finalised)findings.push(`Ended by ${finalised.context.finalisedBy}: ${finalised.context.finalisationReason||finalised.message}.`);
 if(!events.length)findings.push('No recorder events were saved for this journey, so the log cannot explain its gaps.');
 return findings;
}

export function journeySummary(report){
 if(report.error)return [];
 const quality=report.routeQuality||{};
 const end=report.endedAt??report.generatedAt;
 return [
  ['Activity',report.activity||'Unknown'],
  ['Started',report.startedAt?dateTime(report.startedAt):'—'],
  ['Ended',report.endedAt?dateTime(report.endedAt):'Still open'],
  ['Duration',report.startedAt&&end?span(end-report.startedAt):'—'],
  ['Recorded distance',metres(report.recordedDistanceMeters)],
  ['GPS fixes',String(quality.fixCount??'—')],
  ['GPS gaps',String(quality.gapCount??'—')],
  ['Largest gap',quality.largestGapSeconds!=null?span(quality.largestGapSeconds):'—'],
  ['Unobserved',quality.unobservedSeconds!=null?`${span(quality.unobservedSeconds)} · ≥${metres(quality.unobservedMeters)}`:'—'],
 ];
}

export function formatJourneyReport(report){
 if(report.error)return report.error;
 const lines=['Letm3go journey diagnostics',`Generated ${dateTime(report.generatedAt)}`,`App build: ${report.current?.version||'?'} (${report.current?.build||'?'}) · commit ${report.current?.commit||'unknown'} · iOS ${report.current?.iOS||'?'}`,''];
 for(const [label,value] of journeySummary(report))lines.push(`${label}: ${value}`);
 lines.push('','What happened');
 for(const finding of journeyFindings(report))lines.push(`- ${finding}`);
 const notes=report.trackingNotes||[];
 if(notes.length){lines.push('','Tracking notes');for(const note of notes)lines.push(`- ${note}`);}
 lines.push('','Timeline');
 for(const event of journeyEvents(report)){
  if(event.newProcess)lines.push('  --- app restarted (new process) ---');
  lines.push(`${event.time}  ${event.message}${event.details?`  (${event.details})`:''}`);
 }
 lines.push('','Limitations',report.limitations||'','','Raw export (for engineering)',JSON.stringify(report,null,2));
 return lines.join('\n');
}
