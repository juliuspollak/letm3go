import {activityFromCloudRow} from './cloudActivity.js';

// The activities one view works from: this phone's own recordings first, then the
// cloud copies of everything else. The phone writes its activity ids in upper case
// (Swift's UUID.uuidString) while Supabase returns them in lower case, so ids are
// compared without regard to case; otherwise every activity on this phone would be
// listed twice, once from each side.
export function mergeGroupingActivities({localActivities,rows,ids,detailed,deleted=new Set()}){
 // Activities the owner deleted stay hidden at once, even while the cloud copy is
 // still waiting to be removed or a cached page still lists it.
 const local=new Map(localActivities.map(trip=>[trip.id.toLowerCase(),trip]));
 const seen=new Set();
 return ids.flatMap(id=>{
  const key=id.toLowerCase();
  if(seen.has(key)||deleted.has(key))return [];
  seen.add(key);
  if(local.has(key))return [local.get(key)];
  const row=rows?.[id]||rows?.[key];
  if(!row)return [];
  return [activityFromCloudRow(row,{detail:detailed.has(id)&&Array.isArray(row.route_points)})];
 });
}
