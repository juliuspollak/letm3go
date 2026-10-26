import {useMemo} from 'react';
import {tripDiagnostics} from '../lib/tripDiagnostics.js';
const format=n=>n==null?'Not recorded':n>=60?`${Math.round(n/60)} min`:`${Math.round(n)} sec`;
export default function TripDiagnostics({trip}){
 const d=useMemo(()=>tripDiagnostics(trip),[trip]);
 return <details className="trip-diagnostics"><summary>Recording diagnostics</summary>
 <p className="muted small-copy">The measurements below are from GPS samples actually saved with this activity. They cannot reconstruct missing travel.</p>
 <div className="trip-diagnostic-grid"><span>GPS fixes <strong>{d.points}</strong></span><span>Median accuracy <strong>{d.medianAccuracy==null?'—':`${Math.round(d.medianAccuracy)} m`}</strong></span><span>First fix delay <strong>{format(d.lag)}</strong></span><span>Largest GPS gap <strong>{format(d.longestGap)}</strong></span><span>End fix delay <strong>{format(d.endLag)}</strong></span></div>
 {d.warnings.length>0&&<div className="notice"><strong>Possible recording issues</strong><ul>{d.warnings.map(w=><li key={w}>{w}</li>)}</ul></div>}
 {d.events.length>0&&<ol className="trip-tracking-notes">{d.events.map((item,i)=><li key={i}>{typeof item==='string'?item:item.message||JSON.stringify(item)}</li>)}</ol>}
 <p className="muted small-copy">A trip may be incomplete if iOS wakes the app after departure. No app can recover coordinates that iOS never provided.</p>
 </details>;
}
