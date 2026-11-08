import {activityLabel,activityCode} from './activityNames.js';
import {activitySummary,heldEnergy} from './activitySummary.js';
import {publicationPreview,sourceLabel} from './activityPrivacy.js';
import {mapPayload} from './appleMaps.js';
import {withSegments,withTrimRange} from './mapContent.js';
import {distanceText} from './distanceUnits.js';
import {estimateExplanation} from './gapReconstruction.js';
import {heartRateOf,heartRateRuns,routeAt,timeInZones} from './heartRate.js';
import {compareRoutes} from './journeyGeometry.js';
import {canLinkTrail,trailLinkLabel} from './mtbLink.js';
import {canCreateSegments,isCommunitySegmentActivity,namedSegments,segmentColor,segmentLayers} from './namedSegments.js';
import {paceLabel,speedLabel} from './recorder.js';
import {recordedRouteSegments} from './mapGeometry.js';
import {deletionIDs} from './tripsList.js';
import {tripDiagnostics} from './tripDiagnostics.js';
import {equipmentActionLabel,equipmentForActivity,isDerivedEquipment,itemCategory,itemDetail,itemTitle,tripEquipment} from './collection.js';

// The one description of an activity the native screen renders. Every rule that
// decides what is shown (units, what may be edited, what is held back for consent)
// stays in the JavaScript that already owns it; SwiftUI draws this and nothing else
// is derived twice. Changing a field here means changing ActivityDetailsCore.swift,
// which decodes it: tests/fixtures/activity-presentation.json pins both sides.
export const PRESENTATION_SCHEMA=1;
export const HEART_CHART_SAMPLES=600;
export const ACTIVITY_TYPES=['Walking','Running','Cycling','MTB','Road cycling','Other','Driving','Kitesurfing','Hiking','Unknown'];

const clockDuration=seconds=>{const s=Math.max(0,Math.round(seconds||0)),h=Math.floor(s/3600),m=Math.floor(s/60)%60;return h?`${h} h ${m} min`:m?`${m} min ${s%60} s`:`${s%60} s`;};
const segmentLength=(meters,unit)=>unit==='km'&&meters<1000?`${Math.round(meters)} m`:distanceText(meters/1000,unit);
const clockTime=point=>point?new Date(point.timestamp*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit',second:'2-digit'}):'—';
const diagnosticTime=n=>n==null?'Not recorded':n>=60?`${Math.round(n/60)} min`:`${Math.round(n)} sec`;
const minutes=seconds=>seconds<60?`${Math.round(seconds)} s`:`${Math.round(seconds/60)} min`;

export function activityMapJourney(trip){
 if(trip.isShared&&trip.readOnly===true)return trip;
 const points=Array.isArray(trip.points)?trip.points:[];
 return points.length>=2?{...trip,route:points.map(p=>[p.latitude,p.longitude]),routeSegments:recordedRouteSegments(points,{automatic:trip.recordingMode==='automatic',fleet:trip.recordingMode==='tesla'})}:trip;
}

export function activityMap(trip,{selectedPhotoID=null,nearby=null}={}){
 const points=Array.isArray(trip.points)?trip.points:[];
 if(!(Array.isArray(trip.route)?trip.route:[]).length)return {routes:[],pins:[],gaps:[]};
 const own=canCreateSegments(trip)||trip.details?.namedSegments?.length?segmentLayers(trip):null;
 const layers=own||nearby?.pins?.length?{styled:[...(own?.styled||[]),...(nearby?.styled||[])],pins:[...(own?.pins||[]),...(nearby?.pins||[])],muted:false}:null;
 const payload=withSegments(mapPayload([activityMapJourney(trip)],null,null,[],[],{selectedPhotoID}),layers);
 const local=deletionIDs(trip).length===1;
 return local&&points.length>=2?withTrimRange(payload,{start:trip.visibleRouteStart??0,end:trip.visibleRouteEnd??points.length-1,points}):payload;
}

function notices(trip){
 const list=[];
 if(trip.telemetryIncomplete)list.push({id:'telemetry',tone:'warning',text:'Route incomplete · Missing telemetry has not been reconstructed.'});
 if(trip.state==='recording')list.push({id:'recording',tone:'live',text:'Automatic recording in progress. This activity updates as GPS arrives and continues in the same journey if movement resumes near a stop.'});
 if(trip.provisional){
  const left=Number.isFinite(trip.continuationEndsAt)?Math.max(1,Math.round((trip.continuationEndsAt-Date.now()/1000)/60)):null;
  list.push({id:'provisional',tone:'info',text:`Stopped and saved to History${left?`; ${left} minute${left===1?'':'s'} remain for the same activity near here`:''}. A different activity (walking after parking, or driving after a walk) is saved as its own journey.`});
 }
 if(trip.details?.indoor)list.push({id:'indoor',tone:'info',text:'Indoor activity · no route was recorded.'});
 // Also the map legend: estimated road routes are never presented as recorded GPS.
 if(trip.distanceEstimate)list.push({id:'estimated-distance',tone:'info',text:estimateExplanation(trip.distanceEstimate)});
 return list;
}

function factLines(trip,local,pointCount){
 const lines=[`${trip.source==='tesla'?'Tesla vehicle telemetry · driver not identified':trip.isReconciled?'Linked source recordings':sourceLabel(trip)} · ${trip.source==='simulator'?'Simulator GPS':trip.recordingMode==='automatic'?'Estimated / lower-resolution route':trip.recordingMode==='historical'?'No recorded geometry':trip.source==='tesla'?'Vehicle telemetry':'Accuracy-filtered GPS'}`];
 if(trip.vehicle)lines.push(`Vehicle: ${trip.vehicle}`);
 if(trip.collection)lines.push(`Collection: ${trip.collection}`);
 if(local)lines.push(`Average pace: ${paceLabel(trip.distanceMeters,trip.durationSeconds)} · ${pointCount} GPS samples · Local only`);
 if(trip.classification)lines.push(`Prediction: ${trip.classification.predicted} · ${trip.classification.confidence} confidence ${trip.corrected?'· Your correction is preserved':''}`.trim());
 return lines;
}

function heartSection(trip,{unit,maximumHeartRate}){
 const held=Boolean(trip.details?.unverifiedHeartRate);
 const record=held?null:heartRateOf(trip);
 if(!record)return {held,noneNote:!held&&trip.source==='watch'&&trip.details?.indoor?'No heart rate was recorded for this activity.':null};
 const {samples,pausePeriods,summary}=record;
 const start=trip.startedAt??samples[0].timestamp,end=Math.max(trip.endedAt??samples.at(-1).timestamp,start+1);
 const stride=Math.max(1,Math.ceil(samples.length/HEART_CHART_SAMPLES));
 // Thinned for drawing only. Every run keeps its ends, so a gap stays a gap.
 const runs=heartRateRuns(samples,pausePeriods).map(run=>run.filter((_,index)=>index%stride===0||index===run.length-1).map(sample=>{
  const place=routeAt(trip.points,sample.timestamp);
  return {t:sample.timestamp,bpm:Math.round(sample.bpm),place:[place?distanceText(place.distanceMeters/1000,unit):null,place?.speed!=null?`${(place.speed*3.6).toFixed(1)} km/h`:null].filter(Boolean).join(' · ')};
 }));
 const zones=maximumHeartRate?timeInZones(samples,pausePeriods,maximumHeartRate):null;
 return {held:false,noneNote:null,average:`${Math.round(summary.average)} BPM`,maximum:`${Math.round(summary.maximum)} BPM`,maximumValue:Math.round(summary.maximum),start,end,runs,pauses:pausePeriods.map(p=>[p.start,p.end]),
  gapsNote:summary.gaps>0?`${summary.gaps===1?'One stretch':`${summary.gaps} stretches`} had no readings and ${summary.gaps===1?'is':'are'} left empty.`:null,
  chartLabel:`Heart rate over time, ${Math.round(summary.minimum)} to ${Math.round(summary.maximum)} BPM`,
  savedMaximum:maximumHeartRate||null,
  zones:zones?{rows:zones.zones.slice().reverse().map(zone=>({id:String(zone.id),name:zone.name,range:zone.toBpm?`${zone.fromBpm}–${zone.toBpm-1}`:`${zone.fromBpm}+`,time:minutes(zone.seconds),share:zone.share})),note:`Zones are 10% bands of the maximum you entered (${maximumHeartRate} BPM). ${zones.belowSeconds>0?`${minutes(zones.belowSeconds)} below Zone 1. `:''}Gaps and pauses count for no zone.`}:null};
}

function equipmentSection(trip,vehicles){
 const refs=tripEquipment(trip,vehicles);
 const compatible=equipmentForActivity(vehicles,trip.activity);
 const derived=isDerivedEquipment(trip)||trip.isGroupedJourney;
 const extras=refs.map(ref=>ref.item).filter(item=>item&&!compatible.some(option=>String(option.id)===String(item.id)));
 const action=refs.length?null:equipmentActionLabel(trip.activity);
 return {label:refs.length?refs.map(ref=>ref.name).join(' + '):null,action:!refs.length&&action&&compatible.length?action:null,editable:!derived&&trip.state!=='recording',multi:trip.activity==='Kitesurfing',
  selected:refs.map(ref=>String(ref.id)),
  emptyNote:trip.activity==='Kitesurfing'?'Add your kite or board to choose it here.':'Add this kind of equipment to your Collection to choose it here.',
  options:[...extras,...compatible].map(item=>({id:String(item.id),title:itemTitle(item),detail:[itemDetail(item),itemCategory(item).label].filter(Boolean).join(' · '),archived:item.archived===true}))};
}

function tagSection(trip,grouping,onActivityAvailable){
 if(!grouping||trip.state==='recording')return null;
 const anchor=trip.segmentIDs?.[0]||trip.id;
 const custom=grouping.metadata?.manualTags?.[anchor]||[];
 const hidden=grouping.metadata?.hiddenTags?.[anchor]||[];
 const destination=grouping.destinations?.find(d=>d.placeID===trip.recognition?.primary?.placeID);
 const auto=(trip.tags||[]).filter(t=>!custom.some(c=>c.toLowerCase()===t.toLowerCase()));
 const end=(trip.segments?.at(-1)||trip).points?.at(-1);
 return {anchor,auto,custom,hidden,readOnly:trip.readOnly===true,canRemember:Number.isFinite(end?.latitude)&&Number.isFinite(end?.longitude),limit:20,
  destination:destination?{name:destination.name,summary:`Visited ${destination.visits} ${destination.visits===1?'time':'times'}`,activities:destination.activities.map(activity=>{
   const related=grouping.journeys?.find(j=>j.id===activity.id),comparison=related&&related.id!==trip.id?compareRoutes(trip,related):null;
   return {id:String(activity.id),title:`${activity.title} · ${new Date(activity.startedAt*1000).toLocaleDateString('en-AU')}`,openable:Boolean(related&&onActivityAvailable),comparison:comparison?comparison.similar?'Similar GPS route':comparison.partial?'Partial route overlap':'Same destination; different or unverified route':null};
  })}:null};
}

// One line per GPS gap: whether it has a road line, and if not, why.
const ROAD_LOOKUP={done:'done when the activity was saved',pending:'pending (not finished yet)',history:'not run: saved before road estimates (history is never looked up)'};
const GAP_OUTCOME={capacityExceeded:'road estimate store was full',notLookedUp:'not looked up',retrying:'lookup failed, retry pending',failed:'lookup failed every attempt',implausible:'Apple Maps routes did not fit the time and distance',none:'Apple Maps found no driving route'};
function roadReport(estimate){
 return [`Road estimate lookup: ${ROAD_LOOKUP[estimate.lookup]||'unknown'}`,...(estimate.gaps||[]).map((g,i)=>`Gap ${i+1}: ${Math.round(g.seconds)}s, ${g.straightMeters}m straight-line -> ${g.source==='road'?`road ${g.roadMeters}m`:`${GAP_OUTCOME[g.status]||g.status}${g.failures?` (${g.failures} failures)`:''}; straight line used, no road drawn`}`)];
}
function diagnostics(trip,segmentReport=[]){
 const d=tripDiagnostics(trip);
 const report=['Letm3go recording report',`Activity: ${trip.title||trip.activity||'Activity'}`,`Type: ${activityLabel(trip.activity||'Unknown')}`,`Started: ${Number.isFinite(trip.startedAt)?new Date(trip.startedAt*1000).toISOString():'Unknown'}`,`Ended: ${Number.isFinite(trip.endedAt)?new Date(trip.endedAt*1000).toISOString():'Unknown'}`,`Recorded distance (m): ${Number(trip.recordedDistanceMeters??trip.distanceMeters??0).toFixed(0)}`,...(trip.distanceEstimate?[`Estimated distance (m): ${trip.distanceEstimate.estimatedMeters} (${trip.distanceEstimate.roadGaps} of ${trip.distanceEstimate.gapCount} GPS gaps along roads, the rest straight-line)`,...roadReport(trip.distanceEstimate)]:[]),`GPS fixes: ${d.points}`,`Median accuracy (m): ${d.medianAccuracy??'Unknown'}`,`First fix lag (s): ${d.lag??'Unknown'}`,`Largest GPS gap (s): ${d.longestGap}`,`End GPS lag (s): ${d.endLag??'Unknown'}`,`Warnings: ${d.warnings.join('; ')||'None'}`,'Recorder events:',...d.events,...segmentReport].join('\n');
 return {stats:[{label:'GPS fixes',value:String(d.points)},{label:'Median accuracy',value:d.medianAccuracy==null?'—':`${Math.round(d.medianAccuracy)} m`},{label:'First fix delay',value:diagnosticTime(d.lag)},{label:'Largest GPS gap',value:diagnosticTime(d.longestGap)},{label:'End fix delay',value:diagnosticTime(d.endLag)}],
  warnings:d.warnings,events:d.events.map(item=>typeof item==='string'?item:item.message||JSON.stringify(item)),report};
}

function privacySection(trip,places){
 const preview=publicationPreview(trip,places,[]);
 return {title:preview.title,description:preview.description||'',segments:preview.points.reduce((segments,p)=>{(segments[p.segment]??=[]).push([p.latitude,p.longitude]);return segments;},[]).filter(Boolean)};
}

export function activityPresentation(trip,{ownerID,segmentRides=[],segmentReport=[],nearbySegments=null,editSegmentID=null,places=[],vehicles=[],grouping=null,unit='km',maximumHeartRate=null,selectedPhotoID=null,canOpenActivities=true}={}){
 // The same native detail schema and Apple Maps, restricted to published fields.
 // No diagnostics, editor, grouping, tag, equipment or photo-import controls
 // are ever sent for another person's shared recording.
 if(trip.isShared===true&&trip.readOnly===true){
  const photos=Array.isArray(trip.photos)?trip.photos:[];
  return {schema:PRESENTATION_SCHEMA,ownerID:String(ownerID||''),activityID:String(trip.id),updatedAt:null,unit,
   header:{title:trip.title,recordedTitle:trip.title,activity:activityCode(trip.activity),activityLabel:activityLabel(trip.activity),
    subtitle:`${activityLabel(trip.activity)} · Shared by ${trip.ownerName||'a friend'}`,location:'',state:'finished',source:'shared',
    local:false,readOnly:true,startedAt:trip.startedAt??null,timeZone:null,noRouteDetail:'No route was included in this shared activity.'},
   summary:[{id:'distance',label:'Distance',value:distanceText(trip.distance,unit)},
    {id:'duration',label:'Duration',value:clockDuration(trip.durationSeconds)},
    {id:'date',label:'Date',value:trip.date||'—'}],
   metrics:[{label:'Distance',value:distanceText(trip.distance,unit)},{label:'Duration',value:clockDuration(trip.durationSeconds)}],
   notices:[{id:'shared',tone:'info',text:`Shared by ${trip.ownerName||'a friend'} · Read-only activity`}],
   consent:{energy:false,heartRate:false},sources:[],
   photos:{coverID:null,local:false,items:photos.map(photo=>({id:String(photo.id),caption:photo.caption||'',locationSource:photo.locationSource||'unlocated',captureTime:null,assetID:null}))},
   heart:{held:false,noneNote:null},segments:{allowed:false,ridden:[],editID:null,items:[]},trail:null,trim:null,diagnostics:null,tags:null,
   facts:{lines:[],evidence:[]},stops:[],
   story:{description:trip.description||'',notes:'',tags:[]},editor:null,equipment:null,privacy:null,
   map:activityMap(trip,{selectedPhotoID})};
 }

 const points=Array.isArray(trip.points)?trip.points:[];
 const pointCount=points.length;
 const local=deletionIDs(trip).length===1;
 const photos=Array.isArray(trip.photos)?trip.photos:[];
 const coverID=photos.find(photo=>photo.id===(trip.coverPhotoID??trip.details?.coverPhotoID))?.id||null;
 const segmentsAllowed=canCreateSegments(trip);
 return {schema:PRESENTATION_SCHEMA,ownerID:String(ownerID||''),activityID:String(trip.id),updatedAt:Number.isFinite(trip.updatedAt)?trip.updatedAt:null,unit,
  header:{title:trip.title,recordedTitle:trip.recordedTitle??trip.title,activity:activityCode(trip.activity),activityLabel:activityLabel(trip.activity),
   subtitle:`${activityLabel(trip.activity)}${trip.source==='watch'?' · Apple Watch':''} · ${trip.date}`,location:trip.location||'',state:trip.state||'finished',source:trip.source||null,local,readOnly:trip.readOnly===true,startedAt:trip.startedAt??null,timeZone:trip.timezone||trip.timeZone||null,noRouteDetail:trip.recordingMode==='historical'?'This activity was added manually.':'No accurate GPS points were captured.'},
  summary:activitySummary(trip,{unit}).map(({id,label,value,detail})=>({id,label,value,detail:detail||null})),
  metrics:[{label:'Estimated distance',value:`${trip.distanceEstimate?'~':''}${distanceText(trip.distance,unit)}`},{label:'Active duration',value:trip.source?`${Math.floor(trip.durationSeconds/60)}m ${Math.floor(trip.durationSeconds%60)}s`:`${trip.minutes} min`},{label:'Average speed',value:trip.source?`${trip.distanceEstimate?'~':''}${speedLabel(trip.distanceMeters,trip.durationSeconds)}`:'—'}],
  notices:notices(trip),
  consent:{energy:Boolean(heldEnergy(trip)),heartRate:Boolean(trip.details?.unverifiedHeartRate)},
  sources:(trip.sourceRecords||[]).map(s=>({id:String(s.id),label:`View ${s.source==='tesla'?'Tesla':'iPhone'} recording`})),
  photos:{coverID,local,items:photos.map(photo=>({id:String(photo.id),caption:photo.caption||'',locationSource:photo.locationSource||'unlocated',captureTime:photo.captureTime??null,assetID:photo.assetID??null}))},
  heart:heartSection(trip,{unit,maximumHeartRate}),
  segments:{allowed:segmentsAllowed,ridden:segmentRides,editID:editSegmentID,items:namedSegments(trip).map(segment=>({id:segment.id,name:segment.name,color:segmentColor(segment.colorIndex),startIndex:segment.startIndex,endIndex:segment.endIndex,summary:`${segmentLength(segment.distanceMeters,unit)} · ${clockDuration(segment.durationSeconds)}`,detail:`${clockTime(points[segment.startIndex])} – ${clockTime(points[segment.endIndex])} · ${segment.pointCount} GPS points · ${isCommunitySegmentActivity(trip.activity)?'Community segment submission':'Private section'}`}))},
  trail:canLinkTrail(trip)?{linkedID:trip.trail?.id??null,linkedLabel:trip.trail?trailLinkLabel(trip.trail):null}:null,
  trim:!segmentsBlockedTrim(trip,pointCount)?{start:trip.visibleRouteStart??0,end:trip.visibleRouteEnd??pointCount-1,pointCount}:null,
  diagnostics:diagnostics(trip,segmentReport),
  tags:tagSection(trip,grouping,canOpenActivities),
  facts:{lines:factLines(trip,local,pointCount),evidence:trip.classification?.evidence||[]},
  stops:(trip.recognisedStops||[]).map(stop=>({id:String(stop.id),name:stop.name,tags:stop.tags||[],detail:`${Math.round(stop.durationSeconds/60)} min${stop.charging==='possible'?' · Possible charging':stop.charging==='confirmed'?' · Charging confirmed by vehicle':''}${stop.verdict==='ambiguous'&&typeof stop.reasons?.[1]==='string'?` · ${stop.reasons[1]}`:''}`,nearby:stop.nearbyName||null,canIgnore:!trip.readOnly})),
  story:{description:trip.description||'',notes:trip.notes||'',tags:trip.tags||[]},
  editor:{title:trip.title,activity:activityCode(trip.activity||'Walking'),description:trip.description||'',notes:trip.notes||'',tags:(trip.tags||[]).join(', '),collection:trip.collection||'',vehicleID:trip.vehicleID?String(trip.vehicleID):null,vehicle:trip.vehicle||null,
   types:ACTIVITY_TYPES.map(value=>({value,label:activityLabel(value)})),equipment:vehicles.filter(v=>!v.archived).map(v=>({id:String(v.id),title:itemTitle(v)}))},
  equipment:equipmentSection(trip,vehicles),
  privacy:local?privacySection(trip,places):null,
  map:activityMap(trip,{selectedPhotoID,nearby:nearbySegments})};
}
function segmentsBlockedTrim(trip,pointCount){return !(trip.source==='device'&&trip.state==='finished'&&pointCount>=2);}
