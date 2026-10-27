import {recordedJourney} from './recorder.js';
import {isProvisional, metres} from './journeyGrouping.js';
export function fleetActivity(row,owner){
 return {...recordedJourney({id:row.id,ownerID:row.owner_id,vehicleID:row.vehicle_id,providerVehicleID:row.provider_vehicle_id,vehicle:row.vehicle,source:'tesla',state:'finished',recordingMode:'tesla',activity:row.activity,title:row.title,startedAt:Date.parse(row.started_at)/1000,endedAt:Date.parse(row.ended_at)/1000,durationSeconds:row.duration_seconds,distanceMeters:row.distance_meters,points:row.route_points||[],details:{description:row.description,notes:row.notes,tags:row.tags,userCorrected:row.user_corrected,classification:row.classification}}),telemetryIncomplete:row.telemetry_incomplete===true,sharedToHousehold:row.owner_id!==owner};
}
function identity(t,vehicles){if(t.providerVehicleID)return `tesla:${t.providerVehicleID}`;const v=vehicles.filter(v=>t.vehicleID?v.id===t.vehicleID:v.name===t.vehicle);return v.length===1?(v[0].teslaVehicleID?`tesla:${v[0].teslaVehicleID}`:v[0].id):t.vehicleID;}
export function reconcileSources(activities,{owner,vehicles=[],links=[]}){
 const records=[...new Map(activities.filter(t=>!isProvisional(t)&&(t.ownerID===owner||!t.ownerID||t.sharedToHousehold===true)).map(t=>[t.id,t])).values()],used=new Set(),result=[],suggestions=[];
 for(const a of records){if(used.has(a.id))continue;const sources=[a];
  for(const b of records){if(a.id===b.id||used.has(b.id)||a.source===b.source||![a.source,b.source].includes('tesla'))continue;
   const av=identity(a,vehicles),bv=identity(b,vehicles);if(av&&bv&&av!==bv)continue;
   const overlap=Math.max(0,Math.min(a.endedAt,b.endedAt)-Math.max(a.startedAt,b.startedAt))/Math.max(1,Math.min(a.durationSeconds,b.durationSeconds));if(overlap<0.8)continue;
   const ap=a.points||[],bp=b.points||[];
   const endpoints=ap.length&&bp.length&&metres(ap[0],bp[0])<=200&&metres(ap.at(-1),bp.at(-1))<=200;
   const sampled=ap.filter((_,i)=>i%Math.max(1,Math.floor(ap.length/10))===0).slice(0,11);
   const similarity=sampled.length&&bp.length&&sampled.filter(p=>bp.some(q=>Math.abs(q.timestamp-p.timestamp)<=60&&metres(p,q)<=200)).length/sampled.length>=0.7;
   if(!av||!bv){if(endpoints&&similarity)suggestions.push({id:`identity:${a.id}:${b.id}`,ids:[a.id,b.id],requiresVehicle:true,phoneID:a.source==='device'?a.id:b.id,reason:'Possible matching drive. Assign the iPhone recording to its vehicle before linking.'});continue;}
   const manual=links.some(ids=>ids.includes(a.id)&&ids.includes(b.id));
   if(!manual&&(!endpoints||!similarity)){suggestions.push({id:`source:${a.id}:${b.id}`,ids:[a.id,b.id],reason:'Same vehicle and time; route coverage differs. Review before linking.'});continue;}
   used.add(b.id);sources.push(b);
  }
  used.add(a.id);
  if(sources.length===1){result.push(a);continue;}
  const preferred=[...sources].sort((x,y)=>((y.points?.at(-1)?.timestamp||0)-(y.points?.[0]?.timestamp||0))-((x.points?.at(-1)?.timestamp||0)-(x.points?.[0]?.timestamp||0))||(y.points?.length||0)-(x.points?.length||0))[0];
  const canonical=sources.find(t=>t.source==='tesla');
  result.push({...preferred,id:`linked:${canonical.id}`,ownerID:owner,vehicleID:canonical.vehicleID,providerVehicleID:canonical.providerVehicleID,isReconciled:true,source:'combined',sourceRecords:sources,title:sources.find(s=>s.corrected||(s.source==='device'&&s.titleIsAutomatic===false))?.title||preferred.title,photos:sources.flatMap(s=>s.photos||[]),tags:[...new Set(sources.flatMap(s=>s.tags||[]))],notes:sources.map(s=>s.notes||'').filter(Boolean).join('\n'),startedAt:Math.min(...sources.map(s=>s.startedAt)),endedAt:Math.max(...sources.map(s=>s.endedAt))});
 }
 return {activities:result,suggestions};
}
