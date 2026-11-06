import SendReportFeedback from './SendReportFeedback.jsx';
import { formatJourneyReport, journeyEvents, journeyFindings, journeySummary } from '../lib/journeyReport.js';

export default function JourneyReport({report,onClose}){
 if(report.error)return <section className="journey-report"><p role="alert" className="error">{report.error}</p></section>;
 const text=formatJourneyReport(report);
 const events=journeyEvents(report);
 const notes=report.trackingNotes||[];
 return <section className="journey-report" aria-label="Journey diagnostic report">
  <div className="journey-report-head"><h3>Journey diagnostic report</h3>{onClose&&<button type="button" className="text-button" onClick={onClose}>Close</button>}</div>
  <SendReportFeedback kind="journey" title={`Journey diagnostics · ${report.activity||'activity'} · ${report.startedAt?new Date(report.startedAt*1000).toLocaleDateString('en-AU'):''}`} getReport={async()=>({text})}/>
  <dl className="diagnostics journey-report-summary">{journeySummary(report).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  <h4>What happened</h4>
  <ul className="journey-report-findings">{journeyFindings(report).map(finding=><li key={finding}>{finding}</li>)}</ul>
  {notes.length>0&&<details><summary>Tracking notes ({notes.length})</summary><ul className="journey-report-notes">{notes.map((note,index)=><li key={index}>{note}</li>)}</ul></details>}
  <details><summary>Timeline ({events.length} events)</summary><ol className="journey-report-timeline">{events.map((event,index)=><li key={index} className={event.kind==='error'||/not executing|silent/.test(event.message)?'warning':undefined}>
   {event.newProcess&&<span className="journey-report-restart">App restarted</span>}
   <time>{event.time}</time> <span>{event.message}</span>{event.details&&<small>{event.details}</small>}
  </li>)}</ol></details>
 </section>;
}
