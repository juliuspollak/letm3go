import {useEffect} from 'react';
import {ChevronRight} from 'lucide-react';
import {recorder} from '../lib/recorder.js';
import {HEALTH_LABELS,healthIssues,healthRows} from '../lib/recordingHealth.js';

function IssueAction({issue,run,disabled,onUse}){
 return issue.action?<button type="button" className="primary" disabled={disabled} onClick={()=>{onUse?.();run(...issue.action.run);}}>{issue.action.label}</button>:null;
}
export function RecordingHealthHome({health,run,warning,onOpen}){
 const issue=healthIssues(health)[0],show=Boolean(issue&&warning.dismissed!==issue.code);
 const code=show?issue.code:'',logShown=warning.logShown;
 useEffect(()=>{if(code)logShown(code);},[code,logShown]);
 if(!health)return null;
 return <section className="recording-health" aria-label="Automatic recording status">
  <button type="button" className={`recording-health-chip is-${health.status}`} aria-label={`Recording status: ${HEALTH_LABELS[health.status]}. Show details`} onClick={onOpen}><span aria-hidden="true"/>{HEALTH_LABELS[health.status]}<ChevronRight size={15} aria-hidden="true"/></button>
  {show&&<div className={`recording-warning is-${health.status}`} role="status"><strong>{issue.title}</strong>{issue.message.split('\n\n').map(text=><p key={text}>{text}</p>)}<div className="recording-warning-actions"><IssueAction issue={issue} run={run} onUse={()=>{if(issue.action.run[0]==='openSettings')void recorder.noteRecordingWarning('openSettings',issue.code);}}/><button type="button" className="secondary" onClick={()=>{warning.dismiss(issue.code);void recorder.noteRecordingWarning('dismissed',issue.code);}}>Not Now</button></div></div>}
 </section>;
}
export function RecordingHealthDetail({health,run,busy,error}){
 if(!health)return <><p className="eyebrow">AUTOMATIC RECORDING</p><h2>Recording health</h2><p className="muted small-copy">Not reported by this app version.</p></>;
 const issues=healthIssues(health);
 return <><p className="eyebrow">AUTOMATIC RECORDING</p><h2>Recording health</h2>
  <p className={`recording-health-chip is-${health.status} is-static`}><span aria-hidden="true"/>{HEALTH_LABELS[health.status]}</p>
  <p className="muted small-copy">Read from iOS just now. Ready means these settings allow automatic recording; it does not mean a journey is being recorded.</p>
  <dl className="diagnostics">{healthRows(health).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
  {issues.map(issue=><div className="recording-health-issue" key={issue.code}><strong>{issue.title}</strong>{issue.message.split('\n\n').map(text=><p key={text}>{text}</p>)}<IssueAction issue={issue} run={run} disabled={busy}/></div>)}
  {error&&<p role="alert" className="error">{error}</p>}</>;
}
