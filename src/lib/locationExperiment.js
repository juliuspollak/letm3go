// Developer-only location experiment (docs/background-location-architecture-review.md).
// Mode A is the shipped behaviour and the default. B and C remove the iOS background activity session, so they exist only to be
// measured on a physical iPhone. What the app PREDICTS the iOS indicator shows and what a person SAW are always shown separately:
// the app cannot read the indicator.
export const EXPERIMENT_MODES=[
 {mode:'a',label:'A · Current',detail:'The shipped behaviour: the background location session is held as it is today.'},
 {mode:'b',label:'B · No session',detail:'No background location session for Always access (a manual recording still has one). The keep-alive stays on.'},
 {mode:'c',label:'C · No session, no keep-alive',detail:'Diagnostic only. Background recording may be lost. Use it to see what the keep-alive adds.'}
];
export const OBSERVATIONS=[
 {value:'pill',label:'Blue pill visible'},
 {value:'arrow',label:'Arrow only'},
 {value:'none',label:'Nothing visible'}
];
const OBSERVED_LABEL={pill:'blue pill',arrow:'arrow only',none:'nothing visible'};
const PREDICTED_LABEL={yes:'blue pill expected',no:'no blue pill expected',untested:'untested: Apple does not document this case'};
const AGREEMENT_LABEL={agrees:'matches the prediction',disagrees:'contradicts the prediction',untested:'prediction was untested'};
const ARROW_LABEL={agrees:'arrow as predicted',disagrees:'arrow not as predicted',untested:'arrow not assessed'};
export const UNLOCK_TAPS=7,UNLOCK_WINDOW_MS=4000;

// Seven quick taps on the screen title reveal or hide the selector. State is {count,first}.
export function nextUnlockTap(state,now){
 const fresh=!state||!Number.isFinite(state.first)||now-state.first>UNLOCK_WINDOW_MS;
 const next=fresh?{count:1,first:now}:{count:state.count+1,first:state.first};
 return next.count>=UNLOCK_TAPS?{state:{count:0,first:NaN},unlock:true}:{state:next,unlock:false};
}

const clock=value=>Number.isFinite(value)&&value>0?new Date(value*1000).toLocaleString():'None';
export function experimentRows(experiment){
 if(!experiment)return [];
 const predicted=experiment.predicted||{};
 const last=(experiment.observations||[]).slice(-1)[0];
 return [
  ['Mode in effect',experiment.label||'Mode A · current behaviour'],
  ['Expires',experiment.expiresAt?`${clock(experiment.expiresAt)} · then Mode A again`:'Not set (Mode A)'],
  ['Activity session',{none:'Not held',startedThisProcess:'Held (started with the app open)',rejoinedOnly:'Held (rejoined after relaunch)'}[experiment.sessionOwnership]||experiment.sessionOwnership||'Not reported'],
  ['Keep-alive',experiment.keepAliveRunning?'Running':'Not running'],
  ['Location APIs running',experiment.runningAPIs||'Not reported'],
  ['Predicted by the app (not an observation)',`${PREDICTED_LABEL[predicted.pill]||'Not reported'}${predicted.arrow?' · arrow expected':''}`],
  ['Why it predicts that',predicted.basis||'Not reported'],
  ['Last physical observation (a person)',last?`${OBSERVED_LABEL[last.observed]||last.observed} at ${clock(last.at)} in Mode ${String(last.mode).toUpperCase()} · ${AGREEMENT_LABEL[last.agreement]||last.agreement} · ${ARROW_LABEL[last.arrowAgreement]||'arrow not assessed'}`:'None recorded'],
  ['Comparison confounders',experiment.confounders&&experiment.confounders!=='none'?experiment.confounders:'None']
 ];
}
