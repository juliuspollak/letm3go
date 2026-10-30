import {useEffect} from 'react';
import {ChevronRight} from 'lucide-react';
import {recorder} from '../lib/recorder.js';
import {HEALTH_LABELS,healthIssues,healthRows,warningIssue} from '../lib/recordingHealth.js';

function IssueAction({issue,run,disabled,onUse}){
 return issue.action?<button type="button" className="primary" disabled={disabled} onClick={()=>{onUse?.();run(...issue.action.run);}}>{issue.action.label}</button>:null;
}
export function RecordingHealthChip({health,onOpen}){
 if(!health)return null;
 return <section className="recording-health" aria-label="Automatic recording status"><button type="button" className={`recording-health-chip is-${health.status}`} aria-label={`Recording status: ${HEALTH_LABELS[health.status]}. Show details`} onClick={onOpen}><span aria-hidden="true"/>{HEALTH_LABELS[health.status]}<ChevronRight size={15} aria-hidden="true"/></button></section>;
}
// The one warning in the app. It sits above every tab, so a serious problem is
// seen wherever the app opens; it never appears over a manual recording.
export function RecordingWarning({health,run,warning,tab,recording}){
 const issue=warningIssue(health,{tab,recording,dismissed:warning.dismissed});
 const code=issue?.code||'',logShown=warning.logShown;
 useEffect(()=>{if(code)logShown(code);},[code,logShown]);
 if(!issue)return null;
 return <div className={`recording-warning is-${health.status}`} role="status"><strong>{issue.title}</strong>{issue.message.split('\n\n').map(text=><p key={text}>{text}</p>)}<div className="recording-warning-actions"><IssueAction issue={issue} run={run} onUse={()=>{if(issue.action.run[0]==='openSettings')void recorder.noteRecordingWarning('openSettings',issue.code);}}/><button type="button" className="secondary" onClick={()=>{warning.dismiss(issue.code);void recorder.noteRecordingWarning('dismissed',issue.code);}}>Not Now</button></div></div>;
}
export function RecordingHealthDetail({health,run,busy,error}){
 if(!health)return <><p className="eyebrow">AUTOMATIC RECORDING</p><h2>Recording health</h2><p className="muted small-copy">Not reported by this app version.</p></>;
 const issues=healthIssues(health);
 return <><p className="eyebrow">AUTOMATIC RECORDING</p><h2>Recording health</h2>
  <p className={`recording-health-chip is-${health.status} is-static`}><span aria-hidden="true"/>{HEALTH_LABELS[health.status]}</p>
  <p className="muted small-copy">Read from iOS just now. Ready means these settings allow automatic recording and its wake-ups have been requested. It does not mean a journey is being recorded, and iOS decides when wake-ups arrive.</p>
  <dl className="diagnostics">{healthRows(health).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
  {issues.map(issue=><div className="recording-health-issue" key={issue.code}><strong>{issue.title}</strong>{issue.message.split('\n\n').map(text=><p key={text}>{text}</p>)}<IssueAction issue={issue} run={run} disabled={busy}/></div>)}
  {error&&<p role="alert" className="error">{error}</p>}</>;
}
