import {useState} from 'react';
import {formatTrackingReport,trackingFindings} from '../lib/trackingReport.js';
const localInput=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
export default function TrackingReport({recording}){
 const {state,run,busy}=recording;
 const [start,setStart]=useState(()=>localInput(new Date(Date.now()-3600000)));
 const [end,setEnd]=useState(()=>localInput(new Date()));
 const [activity,setActivity]=useState('Driving');
 const [report,setReport]=useState(null),[message,setMessage]=useState(''),[pending,setPending]=useState(false);
 const available=Boolean(state.recorderDiagnostics);
 async function prepare(event){
  event.preventDefault();setMessage('');setReport(null);
  const first=new Date(start).getTime()/1000,last=new Date(end).getTime()/1000;
  if(!Number.isFinite(first)||!Number.isFinite(last)||first>=last||first<Date.now()/1000-7*86400||last>Date.now()/1000+60){setMessage('Choose a start before the end, within the last seven days.');return;}
  setPending(true);
  try{const result=await run('trackingReport',{start:first,end:last,expectedActivity:activity,markMissing:true});if(result&&typeof result==='object')setReport(result);else setMessage('Could not prepare the report. Check the recorder error below and try again.');}
  finally{setPending(false);}
 }
 return <section className="tracking-report"><h3>Report a missed activity</h3><p className="muted small-copy">Choose when you expected a recording. The recorder keeps up to seven days or 2,000 diagnostic events, whichever fills first, even when no trip is created. Reports contain timestamps and recorder status, without coordinates, routes, account identifiers, or credentials. Nothing is uploaded automatically.</p>
 {!available&&<p role="status">Persistent recorder reports require the updated iPhone app.</p>}
 {state.recorderDiagnostics?.error&&<p role="alert" className="error">{state.recorderDiagnostics.error}</p>}
 <form onSubmit={prepare}><label>Expected activity<select value={activity} onChange={e=>setActivity(e.target.value)}>{['Driving','Walking','Running','Cycling','Unknown'].map(value=><option key={value}>{value}</option>)}</select></label><label>Activity started<input type="datetime-local" required value={start} onChange={e=>setStart(e.target.value)}/></label><label>Activity ended<input type="datetime-local" required value={end} onChange={e=>setEnd(e.target.value)}/></label><p className="muted small-copy">Times use this device’s local time zone.</p><button type="submit" className="secondary full" disabled={!available||busy||pending}>{pending?'Preparing report…':'Prepare missed activity report'}</button></form>
 {message&&<p role="status">{message}</p>}
 {report&&<><h3>Evidence for this time window</h3><ul>{trackingFindings(report).map(finding=><li key={finding}>{finding}</li>)}</ul><p className="muted small-copy">Copy this report into your bug report, along with when you actually started moving. A gap in the log cannot identify its cause by itself.</p><button type="button" className="secondary full" onClick={async()=>{try{await navigator.clipboard.writeText(formatTrackingReport(report));setMessage('Tracking report copied.');}catch{setMessage('Copy is unavailable. Select and copy the report text below.');}}}>Copy tracking report</button><details><summary>Report text and event timeline</summary><textarea aria-label="Tracking report text" readOnly rows={14} value={formatTrackingReport(report)}/></details></>}
 </section>;
}
