import ActivityPrivacy from './ActivityPrivacy.jsx';
import SwipeBack from './SwipeBack.jsx';
import PrivateImage from './PrivateImage.jsx';
import { useState } from 'react';
import { ArrowLeft, Pencil, Trash2, ImagePlus, MapPin, Camera } from 'lucide-react';
import JourneyMap from './JourneyMap.jsx';
import { sourceLabel } from '../lib/activityPrivacy.js';
import { recordedJourney, speedLabel, paceLabel } from '../lib/recorder.js';
export default function ActivityDetail({trip,places,onBack,onEdit,onPhoto,run,onUpdated,onDeleted,busy,error,onSource,onStopChange}){
 const local=trip.source==='device'||trip.source==='simulator';
 const [deleting,setDeleting]=useState(false),[suggestions,setSuggestions]=useState(null),[showSkipped,setShowSkipped]=useState(false),[message,setMessage]=useState('');
 const pointCount=trip.points?.length||0;
 const [trimStart,setTrimStart]=useState(trip.visibleRouteStart??0);
 const [trimEnd,setTrimEnd]=useState(trip.visibleRouteEnd??Math.max(0,pointCount-1));
 const trimValid=pointCount>=2&&trimStart<trimEnd;
 const trimChanged=trimStart!==(trip.visibleRouteStart??0)||trimEnd!==(trip.visibleRouteEnd??pointCount-1);
 const trimPoints=trimValid?trip.points.slice(trimStart,trimEnd+1):trip.points;
 const trimPreview={...trip,route:trimPoints.map(p=>[p.latitude,p.longitude]),routeSegments:trimPoints.reduce((segments,p)=>{(segments[p.segment]??=[]).push([p.latitude,p.longitude]);return segments;},[]).filter(Boolean)};
 const pointTime=i=>new Date(trip.points[i]?.timestamp*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit',second:'2-digit'});
 const adjust=(side,seconds)=>{
  const current=side==='start'?trimStart:trimEnd;
  const target=(trip.points[current]?.timestamp||0)+seconds;
  let index=current;
  if(seconds<0)while(index>0&&trip.points[index-1].timestamp>=target)index--;
  else while(index<pointCount-1&&trip.points[index+1].timestamp<=target)index++;
  if(side==='start')setTrimStart(Math.min(index,trimEnd-1));
  else setTrimEnd(Math.max(index,trimStart+1));
 };
 async function applyTrim(){
  if(!trimValid)return;
  const result=await perform('setRouteDisplay',{id:trip.id,start:trimStart,end:trimEnd});
  if(result)setMessage('Visible map route saved. All original GPS points are preserved.');
 }

 async function perform(method,...args){const result=await run(method,...args);if(result?.trips){const updated=result.trips.find(t=>t.id===trip.id);if(updated)onUpdated(recordedJourney(updated));}return result;}
 async function findSuggestions(){const result=await run('suggestPhotos',trip.id);if(result){setSuggestions(result.suggestions);setMessage(result.limited?'Showing locally available photos within your limited library access.':'Showing locally available photos captured during this activity.');}}
 return <SwipeBack onBack={onBack}><div className="detail page-enter"><button className="back text-button" onClick={onBack}><ArrowLeft size={18}/> Back to activities</button><div className="page-heading activity-detail-heading"><div><div className="activity-title-line"><h1>{trip.title}</h1>{local&&<button type="button" className="icon-button activity-title-edit" aria-label="Edit activity" onClick={onEdit} disabled={busy}><Pencil size={17}/></button>}{local&&<ActivityPrivacy trip={trip} places={places||[]}/>}</div><p className="activity-detail-subtitle muted">{trip.activity} · {trip.date}</p><p className="muted"><MapPin size={14}/>{trip.location}</p></div></div>
 {trip.telemetryIncomplete&&<p className="notice">Route incomplete · Missing telemetry has not been reconstructed.</p>}
 {trip.sourceRecords&&<section className="notice"><h3>Recordings of this drive</h3><p>Both sources are preserved. Photos and notes stay with their originals.</p>{trip.sourceRecords.map(s=><button key={s.id} className="secondary" onClick={()=>onSource?.(s)}>View {s.source==='tesla'?'Tesla':'iPhone'} recording</button>)}</section>}
 {trip.route.length?<JourneyMap journeys={[trimPreview]} onPhoto={onPhoto} large/>:<div className="first-recording"><MapPin/><h2>No GPS route</h2><p>{trip.recordingMode==='historical'?'This activity was added manually.':'No accurate GPS points were captured.'}</p></div>}
 {trip.source==='device'&&trip.state==='finished'&&pointCount>=2&&<section className="notice route-trim">
  <h2>Route shown on map</h2>
  <p className="muted small-copy">Choose which part of this recording appears on the map. Original GPS points are kept. The map above updates as you drag.</p>
  <div className="route-range">
   <div className="route-range-track" aria-hidden="true"><span style={{left:`${100*trimStart/(pointCount-1)}%`,right:`${100*(pointCount-1-trimEnd)/(pointCount-1)}%`}}/></div>
   <label>Start · {pointTime(trimStart)}<input aria-label="Visible route start" type="range" min="0" max={trimEnd-1} value={trimStart} onChange={e=>setTrimStart(Number(e.target.value))}/></label>
   <label>Finish · {pointTime(trimEnd)}<input aria-label="Visible route finish" type="range" min={trimStart+1} max={pointCount-1} value={trimEnd} onChange={e=>setTrimEnd(Number(e.target.value))}/></label>
  </div>
  <div className="detail-actions"><button type="button" className="secondary" onClick={()=>adjust('start',-5)}>Start −5s</button><button type="button" className="secondary" onClick={()=>adjust('start',5)}>Start +5s</button><button type="button" className="secondary" onClick={()=>adjust('end',-5)}>End −5s</button><button type="button" className="secondary" onClick={()=>adjust('end',5)}>End +5s</button></div>
  <div className="detail-actions"><button type="button" className="secondary" onClick={()=>{setTrimStart(0);setTrimEnd(pointCount-1);}}>Show full route</button><button type="button" className="primary" disabled={busy||!trimValid||!trimChanged} onClick={applyTrim}>Save visible route</button></div>
 </section>}
 <div className="record-metrics"><div><strong>{trip.distance} km</strong><span>Estimated distance</span></div><div><strong>{trip.source?`${Math.floor(trip.durationSeconds/60)}m ${Math.floor(trip.durationSeconds%60)}s`:`${trip.minutes} min`}</strong><span>Active duration</span></div><div><strong>{trip.source?speedLabel(trip.distanceMeters,trip.durationSeconds):'—'}</strong><span>Average speed</span></div></div>
 <div className="activity-facts"><p><strong>{trip.source==='tesla'?'Tesla vehicle telemetry · driver not identified':trip.isReconciled?'Linked source recordings':sourceLabel(trip)}</strong> · {trip.source==='simulator'?'Simulator GPS':trip.recordingMode==='automatic'?'Estimated / lower-resolution route':trip.recordingMode==='historical'?'No recorded geometry':trip.source==='tesla'?'Vehicle telemetry · GPS accuracy not supplied':'Accuracy-filtered GPS'}</p>{trip.vehicle&&<p>Vehicle: {trip.vehicle}</p>}{trip.collection&&<p>Collection: {trip.collection}</p>}{local&&<p>Average pace: {paceLabel(trip.distanceMeters,trip.durationSeconds)} · {trip.points.length} GPS samples · Local only</p>}{trip.classification&&<p>Prediction: {trip.classification.predicted} · {trip.classification.confidence} confidence {trip.corrected?'· Your correction is preserved':''}</p>}{trip.classification?.evidence?.map(e=><small key={e}>{e}</small>)}</div>
 {trip.recognisedStops?.length>0&&<section className="journey-timeline"><h2>Stops along the way</h2>{trip.recognisedStops.map(stop=><div className="journey-stop" key={stop.id}><strong>{stop.name}</strong>{onStopChange&&!trip.readOnly&&<button type="button" className="text-button" onClick={()=>onStopChange({type:'stop',id:stop.id,name:stop.name,tags:stop.tags,ignored:true})}>Not a stop</button>}<p>{Math.round(stop.durationSeconds/60)} min{stop.charging==='possible'?' · Possible charging':stop.charging==='confirmed'?' · Charging confirmed by vehicle':''}</p>{stop.nearbyName&&<p className="small-copy">Nearby: {stop.nearbyName}</p>}</div>)}</section>}
 <div className="detail-story"><div><p className="eyebrow">YOUR STORY</p><p>{trip.description||'Add a description to remember the little details.'}</p>{trip.notes&&<p>{trip.notes}</p>}<div className="tags">{trip.tags.map(t=><span key={t}>{t}</span>)}</div></div><div><p className="eyebrow">MOMENTS ALONG THE WAY · {trip.photos.length}</p><div className="photo-strip">{trip.photos.map(photo=><button key={photo.id} onClick={()=>onPhoto(trip,photo.id)}><PrivateImage src={photo.url} alt={photo.caption}/></button>)}</div>{local&&<><button className="secondary" disabled={busy} onClick={()=>perform('pickPhotos',trip.id)}><ImagePlus size={17}/> Add photos</button><button className="text-button" disabled={busy} onClick={findSuggestions}><Camera size={16}/> Find journey photos</button><p className="muted small-copy">Only selected photos are copied locally. No automatic uploads. Dashed map bubbles indicate timestamp-inferred locations.</p></>}</div></div>
 {local&&trip.photos.length>0&&<div className="photo-management">{trip.photos.map(photo=><form key={photo.id} onSubmit={async e=>{e.preventDefault();await perform('editPhoto',{id:trip.id,photoID:photo.id,caption:new FormData(e.currentTarget).get('caption')});}}><PrivateImage src={photo.url} alt=""/><label>Photo caption<input name="caption" defaultValue={photo.caption} maxLength={500}/></label><span className="local-badge">{photo.locationSource} · Private</span><div className="detail-actions"><button className="secondary" disabled={busy}>Save caption</button><button type="button" className="secondary" disabled={busy} onClick={()=>perform('editPhoto',{id:trip.id,photoID:photo.id,cover:true})}>Use as cover</button><button type="button" className="text-button" disabled={busy} onClick={()=>perform('editPhoto',{id:trip.id,photoID:photo.id,remove:true})}>Remove photo</button></div></form>)}</div>}
 {suggestions&&<section className="photo-suggestions"><h2>Photo suggestions</h2><p className="muted small-copy">{message} Add explicitly to keep a photo with this activity.</p><label className="checkbox-label"><input type="checkbox" checked={showSkipped} onChange={e=>setShowSkipped(e.target.checked)}/> Revisit skipped photos</label>{!suggestions.length&&<p>No locally available photos in this activity’s time range.</p>}<div className="suggestion-grid">{suggestions.filter(p=>!p.skipped||showSkipped).map(p=><div key={p.assetID}><PrivateImage src={p.thumbnail} alt="Suggested journey photograph"/><button className="secondary" disabled={busy} onClick={async()=>{if(await perform('acceptSuggestion',{id:trip.id,assetID:p.assetID}))setSuggestions(suggestions.filter(x=>x.assetID!==p.assetID));}}>Add</button><button className="text-button" disabled={busy} onClick={async()=>{if(await run('skipSuggestion',{id:trip.id,assetID:p.assetID}))setSuggestions(suggestions.map(x=>x.assetID===p.assetID?{...x,skipped:true}:x));}}>Skip</button></div>)}</div></section>}
 {error&&<p role="alert" className="error">{error}</p>}{local&&<><button className="text-button delete-activity" onClick={()=>setDeleting(true)}><Trash2 size={16}/> Delete activity</button>{deleting&&<div className="notice"><h3>Permanently delete this activity?</h3><p>Its local route, photo copies and activity record will be removed. A deletion tombstone prevents a delayed save restoring it. Original photos in your library stay intact.</p><div className="detail-actions"><button className="secondary" onClick={()=>setDeleting(false)}>Cancel</button><button className="primary" disabled={busy} onClick={async()=>{if(await run('deleteActivity',trip.id))onDeleted();}}>Delete permanently</button></div></div>}</>}
 </div></SwipeBack>;
}
