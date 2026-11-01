const sameID=(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
// Overlaps are recorded once, on the Watch activity, and finished activities are never
// rewritten. Both sides are worked out here, so the duplicate can be found from either
// and a notice ends when the other activity has been deleted.
export function overlapNotes(trip,activities){
 const own=trip?.details?.overlaps||[];
 if(!activities)return own;
 const named=own.filter(item=>activities.some(other=>sameID(other.id,item.activityID)));
 const reverse=activities.flatMap(other=>sameID(other.id,trip?.id)?[]:(other.details?.overlaps||[])
  .filter(item=>sameID(item.activityID,trip?.id))
  .map(item=>({activityID:other.id,title:other.title,kind:other.recordingMode,seconds:item.seconds})));
 return [...named,...reverse];
}
