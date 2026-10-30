// Full location diagnostics deliberately reuse the journey export's plain-text
// format and clipboard helper. No recorder snapshot (which contains account
// data and routes) is ever spread into this report.
const time=at=>Number(at)>0?new Date(at*1000).toISOString():'not available';
export const LOCATION_CLIPBOARD_BYTES=512*1024;
export function formatLocationReport(report){
 if(report.error)throw new Error(report.error);
 const current=report.current||{},events=[...(report.events||[])].sort((a,b)=>a.at-b.at);
 const lines=['Letm3go full location diagnostics',`Generated: ${time(report.generatedAt)}`,`Timezone: ${report.timezone||current.timezone||'unknown'} · UTC offset seconds: ${current.utcOffsetSeconds??'unknown'}`,
  `App: ${current.version||'?'} (${current.build||'?'}) · source commit: ${current.commit||'unknown'} · iOS ${current.iOS||'?'}`,
  `History: ${events.length} retained events; oldest: ${time(report.oldestAvailableAt)}; cap: ${report.retentionDays??7} days / ${report.eventLimit??'?'} events / ${report.byteLimit??'?'} bytes`,
  `Capacity evictions: ${report.capacityEvictions??0}${report.capacityEvictions?' — older evidence has been removed; this is not a complete seven-day history.':''}`,
  `Storage warning: ${report.storageError||'none reported (recent writes may still be queued)'}`,
  '', '1. CURRENT DEVICE AND TRACKING STATE'];
 for(const [key,value] of Object.entries(current).sort(([a],[b])=>a.localeCompare(b)))lines.push(`${key}: ${value}`);
 lines.push('','2. RECENT LOCATION-STATE TRANSITIONS (last 30 retained; full log below)');
 const transitions=events.filter(e=>e.kind!=='observations'&&e.kind!=='sampling');
 for(const event of transitions.slice(-30))lines.push(`${time(event.at)} [${event.context?.component||'LocationRecorder'}/${event.kind}] ${event.message}`);
 if(!transitions.length)lines.push('No retained transitions. This does not establish that location was inactive.');
 lines.push('','3. FULL RETAINED CHRONOLOGICAL EVENT LOG');
 for(const event of events){lines.push(`${time(event.at)} [${event.context?.component||'LocationRecorder'}/${event.kind}] ${event.message}`,JSON.stringify(event.context||{}));}
 if(!events.length)lines.push('No retained events. Logging starts with this native build; earlier operation cannot be reconstructed.');
 lines.push('','4. RECENT JOURNEY SUMMARIES (most recent 30; identifiers are journey IDs)');
 for(const journey of report.journeys||[])lines.push(JSON.stringify(journey));
 if(!report.journeys?.length)lines.push('No recent journeys. The location lifecycle report remains available.');
 lines.push('','5. GPS QUALITY AND SAMPLING STATISTICS (retained observation summaries only)');
 const totals={};
 for(const event of events.filter(e=>e.kind==='observations'))for(const [key,value] of Object.entries(event.context||{})){
  if(['gpsDelivered','routeFixesSaved','sharingAttempts','sharingSuccesses','sharingFailures'].includes(key)||key.startsWith('rejected.'))totals[key]=(totals[key]||0)+(Number(value)||0);
 }
 lines.push(JSON.stringify(totals));
 lines.push('Intentional journey stops are stopCount/stoppedSeconds. Route gaps are gapCount/largestGapSeconds. Resting reduces requested accuracy; adaptive stationary standby intentionally disables precise standard updates. Neither is evidence of a lost recorded route while idle. Delivery/execution gaps must be interpreted with the event state; absence of events cannot identify suspension, crash or force-quit.');
 lines.push('','6. IMPORTANT ERRORS AND WARNINGS');
 const warnings=events.filter(e=>['error','invariant'].includes(e.kind)||/failed|failure|unavailable|not executing|silent|interrupted/.test(e.message));
 for(const event of warnings)lines.push(`${time(event.at)} [${event.kind}] ${event.message} ${JSON.stringify(event.context||{})}`);
 if(!warnings.length)lines.push('No retained warnings; this is not proof of uninterrupted execution.');
 lines.push('','7. LIMITATIONS',report.limitations||'App service requests cannot identify hardware GPS use or another process’s location indicator. No operation is inferred during missing history.');
 return lines.join('\n');
}

// Every part has its own beginning/end boundary and the same report timestamp.
// Nothing is silently dropped, including a single line longer than the budget.
export function locationReportChunks(report,maxBytes=LOCATION_CLIPBOARD_BYTES){
 const encoder=new TextEncoder(),budget=maxBytes-512;
 if(budget<128)throw new Error('Clipboard chunk budget is too small.');
 const chunks=[];let part='',bytes=0;
 for(const line of formatLocationReport(report).split('\n')){
  const text=line+'\n',size=encoder.encode(text).length;
  if(size<=budget){if(bytes+size>budget){chunks.push(part);part='';bytes=0;}part+=text;bytes+=size;}
  else for(const char of text){const size=encoder.encode(char).length;if(bytes+size>budget){chunks.push(part);part='';bytes=0;}part+=char;bytes+=size;}
 }
 if(part)chunks.push(part);
 return chunks.map((text,index)=>`=== BEGIN LETM3GO FULL LOCATION LOG | ${time(report.generatedAt)} | PART ${index+1}/${chunks.length} ===\n${text}\n=== END LETM3GO FULL LOCATION LOG | PART ${index+1}/${chunks.length} ===`);
}
