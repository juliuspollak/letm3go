// Tracking & Permissions rows and tracking-report findings for the adaptive
// location engine (internal, feature-flagged). Times and counts only: no
// coordinates, identifiers or credentials.
export const ADAPTIVE_STATE_LABELS={
 off:'Off',
 activeJourney:'Recording a journey',
 departureProbe:'Checking for a departure',
 settling:'Settling · standard standby',
 stationaryStandby:'Settled · stationary standby',
 recovery:'Recovering · standard standby for a while'
};
export function duration(seconds){
 if(!Number.isFinite(seconds)||seconds<0)return 'Not reported';
 if(seconds<60)return `${Math.round(seconds)} s`;
 const minutes=Math.round(seconds/60);
 if(minutes<60)return `${minutes} min`;
 const hours=Math.floor(minutes/60);
 return minutes%60?`${hours} h ${minutes%60} min`:`${hours} h`;
}
export function adaptiveRows(state){
 const adaptive=state?.adaptive;
 if(!adaptive)return [];
 const usage=state.trackingUsage||{};
 const latency=adaptive.lastDepartureLatency||{};
 const sharing=state.nativeFamilySharing||{};
 const lowPower=adaptive.engine==='lowPower';
 const times=adaptive.timeInStateSeconds||{};
 return [
  ['Adaptive engine',adaptive.enabled?(adaptive.supported?'On (testing)':'On · needs iOS 17; established engine in use'):'Off · established engine'],
  ['Location state',`${ADAPTIVE_STATE_LABELS[adaptive.state]||adaptive.state} · ${duration(adaptive.secondsInState)}`],
  ['Standby engine',lowPower?'Low-power: continuous location stopped':'Established: continuous standby location'],
  // What is actually held, and any contradiction with what the policy wants.
  ['Services held',[adaptive.continuousRunning?'continuous location':null,adaptive.liveUpdatesRunning?'low-power updates':null].filter(Boolean).join(' + ')||'none'],
  ['Service contradictions',adaptive.invariantViolations?.length?adaptive.invariantViolations.join(', '):adaptive.invariantViolationCount?`none now (${adaptive.invariantViolationCount} logged)`:'None'],
  ['Core Location low-power updates',adaptive.liveUpdatesRunning?(adaptive.coreLocationStationary?'Running · phone reported stationary':'Running'):'Not running'],
  ['Current place exit region',adaptive.placeRegionMonitored?'Monitored':'Not monitored'],
  ['Time stationary (this session)',duration(times.stationaryStandby??0)],
  ['Low-power updates total',`${duration(adaptive.liveUpdatesSeconds)} · ${adaptive.liveUpdatesActivations??0} starts`],
  ['Continuous GPS total',`${duration(usage.continuousSeconds)} · ${usage.continuousStarts??0} activations`],
  ['Low-power wake-ups',`${adaptive.standbyWakes??0}${adaptive.probeLoopsBlocked?` · ${adaptive.probeLoopsBlocked} repeated wake-ups held back`:''}`],
  ['Low-power service failures',`${adaptive.liveUpdatesFailures??0}${Number.isFinite(adaptive.recoveryUntil)?' · recovering':''}`],
  ['Last departure',latency.evidenceToFirstFixSeconds!=null?`${latency.engine==='lowPower'?'Low-power':'Established'} · ${latency.cause} · first GPS ${latency.evidenceToFirstFixSeconds} s, confirmed ${latency.evidenceToConfirmationSeconds} s after the evidence`:'No measured departure yet'],
  ['Household location upload',sharing.armed?`${sharing.status||'waiting'}${Number.isFinite(sharing.lastUploadOkAt)&&sharing.lastUploadOkAt>0?` · last accepted ${new Date(sharing.lastUploadOkAt*1000).toLocaleTimeString()}`:''}`:'Not armed']
 ];
}

// From a tracking report's events: how long was spent in each state, how often
// continuous GPS started, how often low-power standby woke, and departures.
export function adaptiveFindings(report){
 const events=(report.events||[]).filter(event=>event.at>=report.start&&event.at<=report.end);
 const transitions=events.filter(event=>event.kind==='adaptive'&&event.context?.to);
 const findings=[];
 if(!transitions.length&&!events.some(event=>event.context?.adaptiveState))return findings;
 const totals={};
 const ordered=[...(report.events||[])].filter(event=>event.kind==='adaptive'&&event.context?.to).sort((a,b)=>a.at-b.at);
 for(let i=0;i<ordered.length;i++){
  const from=Math.max(report.start,ordered[i].at),to=Math.min(report.end,ordered[i+1]?.at??report.end);
  if(to>from)totals[ordered[i].context.to]=(totals[ordered[i].context.to]||0)+(to-from);
 }
 const summary=Object.entries(totals).sort((a,b)=>b[1]-a[1]).map(([state,seconds])=>`${ADAPTIVE_STATE_LABELS[state]||state}: ${duration(seconds)}`);
 if(summary.length)findings.push(`Location states in this window (from logged transitions; the app may have been suspended in between): ${summary.join('; ')}.`);
 const lowPowerStarts=events.filter(event=>event.message==='Low-power standby: continuous location stopped; Core Location will report movement'||event.message?.startsWith('Settled: low-power standby')).length;
 const gpsStarts=events.filter(event=>event.kind==='decision'&&/GPS|departure probe|Recording automatic journey|Departure standby/.test(event.message||'')&&!/stopped/i.test(event.message||'')).length;
 const wakes=events.filter(event=>event.message?.startsWith('Low-power standby woke')).length;
 const failures=events.filter(event=>event.message==='Low-power location updates ended unexpectedly').length;
 findings.push(`${lowPowerStarts} entries into low-power standby, ${wakes} low-power wake-ups and ${gpsStarts} location service decisions were logged.`);
 if(failures)findings.push(`${failures} low-power location failures were logged; the recorder falls back to the established standby after repeated failures.`);
 const latencies=events.filter(event=>event.message==='Departure latency');
 for(const event of latencies)findings.push(`Departure (${event.context.engine==='lowPower'?'low-power':'established'} engine, ${event.context.cause}): first GPS ${event.context.evidenceToFirstFixSeconds} s and confirmation ${event.context.evidenceToConfirmationSeconds} s after the movement evidence.`);
 return findings;
}
