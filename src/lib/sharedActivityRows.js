// Shared journeys are lightweight, permission-scoped list rows. GPS and photographs
// are NEVER loaded for the Activities list. Full snapshots are fetched on open.
export function sharedActivityRow(item,ownerName='Friend'){
 const start=Date.parse(item?.started_at||'');
 if(!item?.activity_id||!Number.isFinite(start))return null;
 const seconds=start/1000;
 const duration=Math.max(0,Number(item.duration_seconds)||0);
 const distanceMeters=Math.max(0,Number(item.distance_km)||0)*1000;
 return {
  id:'shared:'+item.activity_id,sharedActivityID:item.activity_id,sharedOwnerID:item.owner_id,
  isShared:true,readOnly:true,source:'shared',state:'finished',title:item.title||item.activity||'Shared activity',
  activity:item.activity||'Other',ownerName,startedAt:seconds,
  endedAt:item.ended_at?Date.parse(item.ended_at)/1000:seconds+duration,
  date:new Date(start).toLocaleDateString('en-CA'),
  durationSeconds:duration,distanceMeters,distance:distanceMeters/1000,
  tags:[],notes:'',location:'',collection:'',photos:[],route:[],routeSegments:[],points:[]
 };
}
export function filterActivityScope(owned,shared,includeShared){
 return includeShared?[...owned,...shared]:owned;
}
