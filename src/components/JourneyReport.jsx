import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { formatJourneyReport, journeyEvents, journeyFindings, journeySummary } from '../lib/journeyReport.js';

// Some WebViews refuse the async clipboard API; a selected off-screen textarea
// still copies with the legacy command.
async function copyText(text){
 try{await navigator.clipboard.writeText(text);return true;}
 catch{
  const area=document.createElement('textarea');
  area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';
  document.body.appendChild(area);area.select();
  let copied;try{copied=document.execCommand('copy');}catch{copied=false;}
  area.remove();return copied;
 }
}

export default function JourneyReport({report,onClose}){
 const [status,setStatus]=useState('');
 if(report.error)return <section className="journey-report"><p role="alert" className="error">{report.error}</p></section>;
 const text=formatJourneyReport(report);
 const events=journeyEvents(report);
 const notes=report.trackingNotes||[];
 async function copy(){setStatus(await copyText(text)?'copied':'failed');}
 return <section className="journey-report" aria-label="Journey diagnostic report">
  <div className="journey-report-head"><h3>Journey diagnostic report</h3>{onClose&&<button type="button" className="text-button" onClick={onClose}>Close</button>}</div>
  <button type="button" className="primary full" onClick={copy}>{status==='copied'?<><Check size={16}/> Copied to clipboard</>:<><Copy size={16}/> Copy report</>}</button>
  {status==='failed'&&<p role="alert" className="error">Copy is unavailable. Open “Full report text” below and copy it manually.</p>}
  {status==='copied'&&<p role="status" className="muted small-copy">Paste it into your bug report. It contains no coordinates, routes, names or credentials.</p>}
  <dl className="diagnostics journey-report-summary">{journeySummary(report).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  <h4>What happened</h4>
  <ul className="journey-report-findings">{journeyFindings(report).map(finding=><li key={finding}>{finding}</li>)}</ul>
  {notes.length>0&&<details><summary>Tracking notes ({notes.length})</summary><ul className="journey-report-notes">{notes.map((note,index)=><li key={index}>{note}</li>)}</ul></details>}
  <details><summary>Timeline ({events.length} events)</summary><ol className="journey-report-timeline">{events.map((event,index)=><li key={index} className={event.kind==='error'||/not executing|silent/.test(event.message)?'warning':undefined}>
   {event.newProcess&&<span className="journey-report-restart">App restarted</span>}
   <time>{event.time}</time> <span>{event.message}</span>{event.details&&<small>{event.details}</small>}
  </li>)}</ol></details>
  <details><summary>Full report text</summary><textarea aria-label="Journey diagnostic report text" readOnly rows={14} value={text}/></details>
 </section>;
}
