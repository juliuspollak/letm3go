import { activityTitle, automaticTitle } from './activityTitle.js';
import { trailLinkPayload, trailSummary } from './mtbLink.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
const native = registerPlugin('ManualRecorder');
export const recorderAvailable = () => Capacitor.getPlatform() === 'ios';
export const emptyRecorder = { active:null, trips:[], permission:'unavailable', automaticEnabled:false, automaticAvailable:false, automaticState:'idle', automaticSettledTripID:null, places:[], deletedIDs:[], backgroundEnabled:false, accuracy:null, version:'1.0', build:'web', error:'', recovery:'', storageReady:false };
export const recorder = {
 trackingReport:params=>native.trackingReport(params),
  exportJourneyDiagnostics:journeyID=>native.exportJourneyDiagnostics({journeyID}),

 getState:()=>recorderAvailable()?native.getState():Promise.resolve(emptyRecorder),
 configureLiveSharing:params=>recorderAvailable()?native.configureLiveSharing(params):Promise.resolve(),
 restoreActivity:activity=>native.restoreActivity({activity}),
 restorePhoto:params=>native.restorePhoto(params),
 requestPermission:always=>native.requestPermission({always}),
 // `trail` is optional and only used when starting a mountain-bike ride from a
 // community trail, so the link survives offline and is saved with the activity.
 start:(activity,vehicle,vehicleID,trail)=>native.start({activity,vehicle:vehicle||undefined,vehicleID:vehicleID||undefined,...trailLinkPayload(trail)}),
 transition:action=>native.transition({action}),
 openSettings:()=>native.openSettings(),
 setAutomatic:enabled=>native.setAutomatic({enabled}),
 savePlace:place=>native.savePlace(place),
 removePlace:id=>native.removePlace({id}),
 currentPosition:()=>native.currentPosition(),
 searchAddress:query=>native.searchAddress({query}),
 recogniseTripPlace:(id,index,point,explore=false)=>native.recogniseTripPlace({id,index,cloud:!!point,latitude:point?.latitude,longitude:point?.longitude,explore}),
 editActivity:trip=>native.editActivity(trip),
 assignEquipment:params=>native.assignEquipment(params),
 // A trail link is stored on the local activity, so it works offline and never
 // alters community trail data. Passing no trail reference removes the link.
 assignTrail:params=>native.assignTrail(params),
 trimActivity:params=>native.trimActivity(params),
 setRouteDisplay:params=>native.setRouteDisplay(params),
 deleteActivity:id=>native.deleteActivity({id}),
 addHistorical:trip=>native.addHistorical(trip),
 pickPhotos:id=>native.pickPhotos({id}),
 editPhoto:params=>native.editPhoto(params),
 suggestPhotos:(id)=>native.suggestPhotos({id}),
 acceptSuggestion:params=>native.acceptSuggestion(params),
 skipSuggestion:params=>native.skipSuggestion(params),
};
// The stored trail link is exposed as a small object so UI never reads raw
// native detail keys and a missing link is always `null`, never `undefined`.
export function recordedJourney(trip) {
 const date=new Date(trip.startedAt*1000);
 const details=trip.details||{};
 const start=Math.max(0,Math.min(trip.points.length-2,details.visibleRouteStart??0));
 const end=Math.max(start+1,Math.min(trip.points.length-1,details.visibleRouteEnd??(trip.points.length-1)));
 const visiblePoints=trip.points.slice(start,end+1);
 const photos=(trip.localPhotos||[]).map(p=>({...p,url:p.privateURI,point:p.latitude!=null&&p.longitude!=null?[p.latitude,p.longitude]:null,caption:p.caption||'A moment along the way'}));
 return {...trip,visibleRouteStart:start,visibleRouteEnd:end,provisional:details.provisional===true,trail:trailSummary(trip),continuationEndsAt:Number.isFinite(details.continuationEndsAt)?details.continuationEndsAt:null,title:activityTitle(trip),titleIsAutomatic:automaticTitle(trip),location:details.startPlace&&details.endPlace?`${details.startPlace} → ${details.endPlace}`:trip.source==='simulator'?'Simulator recording':'Recorded on this iPhone',date:date.toLocaleDateString('en-CA'),distance:Math.round(trip.distanceMeters/100)/10,minutes:Math.floor(trip.durationSeconds/60),durationSeconds:trip.durationSeconds,elevation:0,description:details.description||'',notes:details.notes||'',collection:details.collection||'',classification:details.classification,corrected:details.userCorrected||false,visibility:details.visibility||'private',tags:details.tags||[],route:visiblePoints.map(p=>[p.latitude,p.longitude]),routeSegments:visiblePoints.reduce((segments,p)=>{(segments[p.segment]??=[]).push([p.latitude,p.longitude]);return segments;},[]).filter(Boolean),photos,cover:photos.find(p=>p.id===details.coverPhotoID)?.url||null};
}
// Arrival confirmation can outlast the drive. Present its saved GPS immediately,
// without adding unfinished activities to grouping, cloud sync or sharing inputs.
// A stopped journey is published immediately; the recorder keeps it open so the
// next movement updates the same record instead of creating a duplicate.
export const provisionalJourney = state => (state?.trips||[]).find(trip=>trip.details?.provisional===true)||null;
// Native pushes a change notification so History, the recorder panel and trip
// details refresh without waiting for the next poll or an app restart.
export const onJourneysChanged = handler => recorderAvailable()&&typeof native.addListener==='function'
 ? native.addListener('journeysChanged',handler)
 : Promise.resolve(null);
export function visibleRecorderJourneys(journeys,state,ownerID){
 const known=journeys||[];
 const owned=ownerID&&state.ownerID?.toLowerCase()===ownerID.toLowerCase();
 // A confirmed stop is published to History immediately and is excluded from
 // grouping until the recorder finalises it. Present it here so it is never
 // invisible while the continuation window is open.
 const stopped=owned?(state.trips||[]).filter(t=>t.source==='device'&&t.details?.provisional===true):[];
 const recording=owned&&state.automaticTrip&&state.automaticTrip.source==='device'?[state.automaticTrip]:[];
 return [...stopped,...recording]
  .filter(trip=>!known.some(j=>j.id===trip.id||j.segmentIDs?.includes(trip.id)))
  .map(recordedJourney)
  .concat(known);
}
export function speedLabel(meters,seconds){return seconds>0?`${(meters/seconds*3.6).toFixed(1)} km/h`:'—';}
export function paceLabel(meters,seconds){if(meters<10||seconds<=0)return '—';const pace=seconds/(meters/1000);return `${Math.floor(pace/60)}:${String(Math.floor(pace%60)).padStart(2,'0')} /km`;}
