import {useMemo,useState} from 'react';
import {tripDiagnostics} from '../lib/tripDiagnostics.js';
const format=n=>n==null?'Not recorded':n>=60?`${Math.round(n/60)} min`:`${Math.round(n)} sec`;
export default function TripDiagnostics({trip}){
 const d=useMemo(()=>tripDiagnostics(trip),[trip]);
 const [copyStatus,setCopyStatus]=useState('');
 const report=[`Letm3go recording report`, `Activity: ${trip.title||trip.activity||'Activity'}`,`Type: ${trip.activity||'Unknown'}`,`Started: ${Number.isFinite(trip.startedAt)?new Date(trip.startedAt*1000).toISOString():'Unknown'}`,`Ended: ${Number.isFinite(trip.endedAt)?new Date(trip.endedAt*1000).toISOString():'Unknown'}`,`Recorded distance (m): ${Number(trip.distanceMeters||0).toFixed(0)}`,`GPS fixes: ${d.points}`,`Median accuracy (m): ${d.medianAccuracy??'Unknown'}`,`First fix lag (s): ${d.lag??'Unknown'}`,`Largest GPS gap (s): ${d.longestGap}`,`End GPS lag (s): ${d.endLag??'Unknown'}`,`Warnings: ${d.warnings.join('; ')||'None'}`,`Recorder events:`,...d.events].join('\n');
 return <details className="trip-diagnostics"><summary>Recording diagnostics</summary>
 <p className="muted small-copy">The measurements below are from GPS samples actually saved with this activity. They cannot reconstruct missing travel.</p>
 <div className="trip-diagnostic-grid"><span>GPS fixes <strong>{d.points}</strong></span><span>Median accuracy <strong>{d.medianAccuracy==null?'—':`${Math.round(d.medianAccuracy)} m`}</strong></span><span>First fix delay <strong>{format(d.lag)}</strong></span><span>Largest GPS gap <strong>{format(d.longestGap)}</strong></span><span>End fix delay <strong>{format(d.endLag)}</strong></span></div>
 {d.warnings.length>0&&<div className="notice"><strong>Possible recording issues</strong><ul>{d.warnings.map(w=><li key={w}>{w}</li>)}</ul></div>}
 {d.events.length>0&&<ol className="trip-tracking-notes">{d.events.map((item,i)=><li key={i}>{typeof item==='string'?item:item.message||JSON.stringify(item)}</li>)}</ol>}
 <button type="button" className="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(report);setCopyStatus('Recording report copied.');}catch{setCopyStatus('Copy unavailable. You can screenshot these diagnostics.');}}}>Copy recording report</button>{copyStatus&&<p role="status" className="muted small-copy">{copyStatus}</p>}
 <p className="muted small-copy">A trip may be incomplete if iOS wakes the app after departure. No app can recover coordinates that iOS never provided.</p>
 </details>;
}
