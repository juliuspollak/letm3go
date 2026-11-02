import {activitySummary} from '../lib/activitySummary.js';

// The at-a-glance readout. It shows exactly the values the recording holds, in a
// fixed, predictable order, so a drive with no heart rate simply has fewer
// blocks instead of a row of dashes.
export default function ActivitySummary({trip,unit='km'}){
 const entries=activitySummary(trip,{unit});
 if(!entries.length)return null;
 return <dl className="activity-summary" aria-label="Activity summary">
  {entries.map(entry=><div key={entry.id} className="activity-summary-item" data-readout={entry.id}>
   <dt>{entry.label}</dt>
   <dd>{entry.value}</dd>
   {entry.detail&&<p className="activity-summary-detail">{entry.detail}</p>}
  </div>)}
 </dl>;
}
