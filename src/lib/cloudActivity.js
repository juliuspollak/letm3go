// Existing activity rows -> the existing recorder activity shape. Shared by
// explicit recovery and selective viewing; no parallel activity data model.
import {recordedJourney} from './recorder.js';
import {restoreClassification} from './stopBackup.js';
export function rawActivityFromCloudRow(row){
 const start=Date.parse(row.started_at)/1000,end=Date.parse(row.ended_at)/1000,view=row.view_metadata||{},restored=restoreClassification(row.classification,Date.parse(row.started_at)/1000,Date.parse(row.ended_at)/1000);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)throw new Error('Saved activity timestamps could not be read.');
 const equipment=(row.equipment||[]).filter(ref=>typeof ref?.id==='string'&&ref.id).slice(0,8).map(ref=>({id:ref.id.slice(0,100),name:String(ref.name||'').slice(0,100)}));
 return {id:row.id,ownerID:row.owner_id,activity:row.activity,title:row.title,vehicle:row.vehicle||null,vehicleID:row.vehicle_id||equipment[0]?.id||null,providerVehicleID:row.provider_vehicle_id||null,equipment,
  updatedAt:restored.sourceUpdatedAt,source:row.recording_mode==='watch'?'watch':row.recording_mode==='tesla'?'tesla':'device',recordingMode:row.recording_mode,state:'finished',startedAt:start,endedAt:end,durationSeconds:row.duration_seconds,accumulatedSeconds:row.duration_seconds,resumedAt:null,segment:0,distanceMeters:row.distance_meters,
  points:row.route_points||[],details:{...view,...restored,description:row.description||'',notes:row.notes||'',tags:row.tags||[],collection:row.collection||'',userCorrected:row.user_corrected===true,visibility:row.visibility||'private'}};
}
export function activityFromCloudRow(row,{detail=false}={}){
 const raw=rawActivityFromCloudRow({...row,route_points:detail?row.route_points:[]});raw.source=row.recording_mode==='tesla'?'tesla':'cloud';
 const projected=recordedJourney(raw),view=row.view_metadata||{};
 return {...projected,...(!detail?{visibleRouteStart:view.visibleRouteStart??0,visibleRouteEnd:view.visibleRouteEnd??Math.max(0,(row.point_count||0)-1)}:{}),
  photos:detail?(row.photos||[]).map(photo=>({...photo,url:`cloud-photo:${row.owner_id}/${row.id}/${photo.id}`,point:photo.latitude!=null&&photo.longitude!=null?[photo.latitude,photo.longitude]:null})):[],
  geometryLoaded:detail,cloudRevision:row.revision,startPoint:row.firstPoint||row.route_points?.[0],endPoint:row.lastPoint||row.route_points?.at(-1),location:view.startPlace&&view.endPlace?`${view.startPlace} → ${view.endPlace}`:'Saved activity'};
}
