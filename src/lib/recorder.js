import { activityTitle, automaticTitle } from './activityTitle.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
const native = registerPlugin('ManualRecorder');
export const recorderAvailable = () => Capacitor.getPlatform() === 'ios';
export const emptyRecorder = { active:null, trips:[], permission:'unavailable', automaticEnabled:false, automaticAvailable:false, automaticState:'idle', places:[], deletedIDs:[], backgroundEnabled:false, accuracy:null, version:'1.0', build:'web', error:'', recovery:'', storageReady:false };
export const recorder = {
 getState:()=>recorderAvailable()?native.getState():Promise.resolve(emptyRecorder),
 requestPermission:always=>native.requestPermission({always}),
 start:(activity,vehicle)=>native.start({activity,vehicle:vehicle||undefined}),
 transition:action=>native.transition({action}),
 openSettings:()=>native.openSettings(),
 setAutomatic:enabled=>native.setAutomatic({enabled}),
 savePlace:place=>native.savePlace(place),
 removePlace:id=>native.removePlace({id}),
 currentPosition:()=>native.currentPosition(),
 searchAddress:query=>native.searchAddress({query}),
 recogniseTripPlace:(id,index)=>native.recogniseTripPlace({id,index}),
 editActivity:trip=>native.editActivity(trip),
 trimActivity:params=>native.trimActivity(params),
 deleteActivity:id=>native.deleteActivity({id}),
 addHistorical:trip=>native.addHistorical(trip),
 pickPhotos:id=>native.pickPhotos({id}),
 editPhoto:params=>native.editPhoto(params),
 suggestPhotos:(id)=>native.suggestPhotos({id}),
 acceptSuggestion:params=>native.acceptSuggestion(params),
 skipSuggestion:params=>native.skipSuggestion(params),
};
export function recordedJourney(trip) {
 const date=new Date(trip.startedAt*1000);
 const details=trip.details||{};
 const photos=(trip.localPhotos||[]).map(p=>({...p,url:p.privateURI,point:p.latitude!=null&&p.longitude!=null?[p.latitude,p.longitude]:null,caption:p.caption||'A moment along the way'}));
 return {...trip,title:activityTitle(trip),titleIsAutomatic:automaticTitle(trip),location:details.startPlace&&details.endPlace?`${details.startPlace} → ${details.endPlace}`:trip.source==='simulator'?'Simulator recording':'Recorded on this iPhone',date:date.toLocaleDateString('en-CA'),distance:Math.round(trip.distanceMeters/100)/10,minutes:Math.floor(trip.durationSeconds/60),durationSeconds:trip.durationSeconds,elevation:0,description:details.description||'',notes:details.notes||'',collection:details.collection||'',classification:details.classification,corrected:details.userCorrected||false,visibility:details.visibility||'private',tags:details.tags||[],route:trip.points.map(p=>[p.latitude,p.longitude]),routeSegments:trip.points.reduce((segments,p)=>{(segments[p.segment]??=[]).push([p.latitude,p.longitude]);return segments;},[]).filter(Boolean),photos,cover:photos.find(p=>p.id===details.coverPhotoID)?.url||null};
}
export function speedLabel(meters,seconds){return seconds>0?`${(meters/seconds*3.6).toFixed(1)} km/h`:'—';}
export function paceLabel(meters,seconds){if(meters<10||seconds<=0)return '—';const pace=seconds/(meters/1000);return `${Math.floor(pace/60)}:${String(Math.floor(pace%60)).padStart(2,'0')} /km`;}
