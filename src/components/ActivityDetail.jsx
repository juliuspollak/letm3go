import {deletionIDs} from '../lib/tripsList.js';
import {overlapNotes} from '../lib/activityOverlaps.js';
import {activityLabel} from '../lib/activityNames.js';
import {distanceText} from '../lib/distanceUnits.js';
import ActivityPrivacy from './ActivityPrivacy.jsx';
import SwipeBack from './SwipeBack.jsx';
import PrivateImage from './PrivateImage.jsx';
import { useDeferredValue, useMemo, useRef, useState, useEffect } from 'react';
import { ArrowLeft, Pencil, Trash2, MapPin } from 'lucide-react';
import JourneyMap from './JourneyMap.jsx';
import JourneyTags from './JourneyTags.jsx';
import TrailLink from './TrailLink.jsx';
import TripDiagnostics from './TripDiagnostics.jsx';
import { sourceLabel } from '../lib/activityPrivacy.js';
import { canLinkTrail } from '../lib/mtbLink.js';
import { recordedJourney, speedLabel, paceLabel } from '../lib/recorder.js';
import {EquipmentButton} from './EquipmentChip.jsx';
import { CreateSegmentButton, SegmentEditor, SegmentList } from './NamedSegments.jsx';
import { canCreateSegments, newSegmentID, segmentLayers } from '../lib/namedSegments.js';
import HeartRatePanel from './HeartRatePanel.jsx';
import { recordedRouteSegments } from '../lib/mapGeometry.js';
import { SUGGESTION_PAGE_SIZE, mergeSuggestionPages, nextSuggestionOffset } from '../lib/photoSuggestions.js';
import ActivitySummary from './ActivitySummary.jsx';
import ActivityMoments from './ActivityMoments.jsx';
import EnergyConsent from './EnergyConsent.jsx';
import ActivitySheet from './ActivitySheet.jsx';
import PhotoSuggestions from './PhotoSuggestions.jsx';
export default function ActivityDetail({ownerID,trip,activities,places,vehicles=[],onEquipment,onBack,onEdit,onPhoto,run,lastError,onUpdated,onDeleted,busy,error,onSource,onStopChange,grouping,unit='km'}){
 const [photoSelection,setPhotoSelection]=useState(null);
 const selectedPhotoID=photoSelection?.owner===ownerID&&photoSelection?.activity===trip.id?photoSelection.photoID:null;
 function showPhoto(journey,photoID){
  if(journey.id!==trip.id||!trip.photos?.some(photo=>String(photo.id)===String(photoID)))return;
  setPhotoSelection({owner:ownerID,activity:trip.id,photoID});
  onPhoto?.(journey,photoID);
 }
 const local=deletionIDs(trip).length===1;
 const overlaps=overlapNotes(trip,activities);
 const [deleting,setDeleting]=useState(false),[suggestions,setSuggestions]=useState(null),[limited,setLimited]=useState(false),[message,setMessage]=useState('');
 const [addingPhotos,setAddingPhotos]=useState(false);
 const addingPhotosRef=useRef(false);
 const findingSuggestions=useRef(false);
 const searchToken=useRef(0);
 const [suggestionPage,setSuggestionPage]=useState({hasMore:false,total:null,loading:false,nextOffset:null});
 // A batch or a delete that finishes after the person leaves must not pull the
 // activity back onto the screen, so every write checks that this detail is still
 // the mounted one before reporting a change.
 const mounted=useRef(true);
 // StrictMode runs the setup, cleanup and setup again without unmounting the
 // component. Re-arm the ref so a development session still reports updates;
 // only a real cleanup (or the final StrictMode cleanup) leaves it false.
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
 // The overlay map lives behind the WKWebView. While this screen is mounted the
 // html/body background is cleared so the native map shows through the transparent
 // map host; the details sheet paints its own opaque surface over the bottom.
 useEffect(()=>{document.documentElement.classList.add('map-overlay');return()=>document.documentElement.classList.remove('map-overlay');},[]);
 const points=useMemo(()=>Array.isArray(trip.points)?trip.points:[],[trip.points]);
 const route=Array.isArray(trip.route)?trip.route:[];
 const pointCount=points.length;
 const [trimStart,setTrimStart]=useState(trip.visibleRouteStart??0);
 const [trimEnd,setTrimEnd]=useState(trip.visibleRouteEnd??Math.max(0,pointCount-1));
 const trimValid=pointCount>=2&&trimStart<trimEnd;
 const trimChanged=trimStart!==(trip.visibleRouteStart??0)||trimEnd!==(trip.visibleRouteEnd??pointCount-1);
 // The route geometry is rebuilt only when the recording changes: rebuilding it
 // on every render re-sends the whole route to the native map and drops its
 // camera, which made the map jump while the sheet was being dragged.
 const fullPreview=useMemo(()=>({...trip,route:points.map(p=>[p.latitude,p.longitude]),routeSegments:recordedRouteSegments(points,{automatic:trip.recordingMode==='automatic',fleet:trip.recordingMode==='tesla'})}),[trip,points]);
 // Photos this activity holds, in the activity's own timezone when it saved one
 // (a photo taken abroad is described in local time there, not here).
 const timeZone=trip.timezone||trip.timeZone||undefined;
 // Named segments: a draft is the section being chosen; the map follows it.
 const segmentsAllowed=canCreateSegments(trip);
 const [segmentDraft,setSegmentDraft]=useState(null);
 const mapSelection=useDeferredValue(segmentDraft);
 const layers=useMemo(()=>segmentsAllowed||trip.details?.namedSegments?.length?segmentLayers(trip,{selection:mapSelection&&{start:mapSelection.start,end:mapSelection.end},editingID:mapSelection?.segmentID}):null,[trip,segmentsAllowed,mapSelection]);
 function createSegment(){const start=Math.max(0,Math.min(pointCount-2,trip.visibleRouteStart??0)),end=Math.max(start+1,Math.min(pointCount-1,trip.visibleRouteEnd??pointCount-1));setSegmentDraft({segmentID:newSegmentID(),name:'',start,end,existing:false});}
 async function saveSegment({name,start,end}){const result=await perform('saveNamedSegment',{id:trip.id,segmentID:segmentDraft.segmentID,name,start,end});if(result){setSegmentDraft(null);setMessage(`Segment “${name}” saved. The recording is unchanged.`);}}
 const renameSegment=async(segment,name)=>!!await perform('saveNamedSegment',{id:trip.id,segmentID:segment.id,name,start:segment.startIndex,end:segment.endIndex});
 const deleteSegment=async segment=>!!await perform('deleteNamedSegment',{id:trip.id,segmentID:segment.id});
 const pointTime=i=>new Date(points[i]?.timestamp*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit',second:'2-digit'});
 // Remaining time in the published stop's continuation window, in whole minutes.
 const continuationMinutes=Number.isFinite(trip.continuationEndsAt)?Math.max(1,Math.round((trip.continuationEndsAt-Date.now()/1000)/60)):null;
 async function applyTrim(){
  if(!trimValid)return;
  const result=await perform('setRouteDisplay',{id:trip.id,start:trimStart,end:trimEnd});
  if(result)setMessage('Visible map route saved. All original GPS points are preserved.');
 }
 async function perform(method,...args){
  const result=await run(method,...args);
  if(result?.trips&&mounted.current){
   const updated=result.trips.find(t=>t.id===trip.id);
   if(updated)onUpdated?.(recordedJourney(updated));
  }
  return result;
 }
 // The native side pages suggestions so a large library is not silently cut off.
 // The first page keeps the original call shape; later pages carry the offset.
 async function findSuggestions({append=false,offset:forced=null}={}){
  // One fresh search at a time. A second tap must not replace the page the first
  // request is still fetching; appends (Load more and the empty-page walk) are
  // allowed while the fresh search owns the flag.
  const fresh=!append;
  if(fresh){
   if(findingSuggestions.current)return;
   findingSuggestions.current=true;
   searchToken.current+=1;
  }
  const token=searchToken.current;
  try{
   // Native returns the cursor for the next page. Falling back to the number of rows
   // held only happens with an older native build, and it can lag behind the page
   // window when a thumbnail fails, so `nextOffset` is preferred whenever it exists.
   const offset=forced!=null?forced:append?(suggestionPage.nextOffset??nextSuggestionOffset(suggestions||[])):0;
   // A fresh search starts a new list: a stale "shown of total" must not outlive it.
   if(append)setSuggestionPage(page=>({...page,loading:true}));
   else setSuggestionPage({hasMore:false,total:null,loading:false,nextOffset:null});
   const result=offset===0?await run('suggestPhotos',trip.id):await run('suggestPhotos',trip.id,{offset,limit:SUGGESTION_PAGE_SIZE});
   if(!mounted.current||token!==searchToken.current)return;
   if(!result){
    setSuggestionPage(page=>({...page,loading:false}));
    setMessage(lastError?.()||'Photo suggestions could not be read from your library.');
    return;
   }
   const page=Array.isArray(result.suggestions)?result.suggestions:[];
   setSuggestions(current=>append?mergeSuggestionPages(current||[],page):page);
   const hasMore=Boolean(result.hasMore);
   const next=Number.isFinite(result.nextOffset)?result.nextOffset:null;
   setSuggestionPage({hasMore,total:Number.isFinite(result.total)?result.total:null,loading:false,nextOffset:next});
   setLimited(Boolean(result.limited));
   setMessage(result.limited?'Showing locally available photos within your limited library access.':'Showing locally available photos captured during this activity.');
   // A page can render empty (thumbnails that never decoded, or a page whose rows
   // are all filtered out). Step forward instead of leaving the list looking done,
   // including the first page: a library whose first rows are all unreadable should
   // still show the candidates that follow.
   if(hasMore&&!page.length&&next!=null&&next>offset)await findSuggestions({append:true,offset:next});
  }finally{if(fresh)findingSuggestions.current=false;}
 }
 // Cancel closes the sheet and invalidates a page still in flight. Without the
 // token bump a late Load more result would reopen the sheet after the person left.
 function closeSuggestions(){
  searchToken.current+=1;
  setSuggestions(null);
 }
 // One photo per call: the native side resolves the full snapshot, so a partial
 // batch can be reported honestly and retried without duplicating successes.
 // The native rejection reason is passed through verbatim (an account switch, the
 // per-activity cap or a photo that is still in iCloud must be distinguishable).
 async function importSuggestion(assetID){
  const result=await perform('acceptSuggestion',{id:trip.id,assetID});
  if(result)return {ok:true};
  return {ok:false,message:lastError?.()||'The photo was not added. It may have been removed from your library.'};
 }
 async function skipSuggestion(assetID,skipped){
  const result=await run('skipSuggestion',{id:trip.id,assetID,skipped});
  if(!result&&mounted.current)setMessage(lastError?.()||'That photo could not be marked as skipped.');
  return Boolean(result);
 }
 // The picker imports every chosen photo as one native call. Its per-asset result
 // is reported here: a partial success says how many were kept, names what failed
 // and leaves the activity otherwise untouched. The picker opens only while a
 // photo slot is free, and its selection limit is the remaining capacity.
 async function addPhotos(){
  // The disabled attribute only lands after React commits this event; the ref
  // closes the double-tap gap so two pickers can never be presented at once.
  if(addingPhotos||addingPhotosRef.current)return;
  addingPhotosRef.current=true;
  setAddingPhotos(true);
  try{
   const before=Array.isArray(trip.photos)?trip.photos.length:0;
   const result=await perform('pickPhotos',trip.id);
   if(!mounted.current)return;
   if(!result){setMessage(lastError?.()||'Photos could not be added.');return;}
   const summary=result.photoResults||{};
   const updated=Array.isArray(result.trips)?result.trips.find(item=>item.id===trip.id):null;
   const after=Array.isArray(updated?.localPhotos)?updated.localPhotos.length:before;
   const added=Number.isFinite(summary.added)?summary.added:Math.max(0,after-before);
   const duplicates=Number.isFinite(summary.duplicates)?summary.duplicates:0;
   const failures=Array.isArray(summary.failed)?summary.failed.filter(Boolean):[];
   const parts=[];
   if(added)parts.push(`${added} photo${added===1?'':'s'} added`);
   if(duplicates)parts.push(`${duplicates} photo${duplicates===1?'':'s'} already with this activity`);
   if(failures.length)parts.push(`${failures.length} could not be added: ${failures.join(' ')}`);
   if(parts.length){const text=parts.join(' · ');setMessage(/[.!?]$/.test(text)?text:`${text}.`);}
  }finally{
   addingPhotosRef.current=false;
   if(mounted.current)setAddingPhotos(false);
  }
 }
 // One persistent map for the screen. It is never re-created when the sheet moves,
 // so a detent drag only changes how much of the map the sheet covers.
 const mapJourneys=useMemo(()=>[pointCount>=2?fullPreview:trip],[pointCount,fullPreview,trip]);
 const trimRange=useMemo(()=>local&&pointCount>=2&&!segmentDraft?{start:trimStart,end:trimEnd,points}:null,[local,pointCount,segmentDraft,trimStart,trimEnd,points]);
 const mapCanvas=route.length
  ?<JourneyMap journeys={mapJourneys} trimRange={trimRange} segmentLayers={layers} onPhoto={showPhoto} selectedPhotoID={selectedPhotoID} large overlay/>
  :<div className="first-recording"><MapPin/><h2>No GPS route</h2><p>{trip.recordingMode==='historical'?'This activity was added manually.':'No accurate GPS points were captured.'}</p></div>;
 return <SwipeBack onBack={onBack}><div className="detail detail-sheet-page page-enter">
  <div className="detail-map-layer">{mapCanvas}</div>
  <ActivitySheet>
   <button className="back text-button" onClick={onBack}><ArrowLeft size={18}/> Back to activities</button>
   <div className="page-heading activity-detail-heading"><div><div className="activity-title-line"><h1>{trip.title}</h1>{local&&<button type="button" className="icon-button activity-title-edit" aria-label="Edit activity" onClick={onEdit} disabled={busy}><Pencil size={17}/></button>}{local&&<ActivityPrivacy trip={trip} places={places||[]}/>}</div><div className="activity-detail-subtitle-row"><p className="activity-detail-subtitle muted">{activityLabel(trip.activity)}{trip.source==='watch'?' · Apple Watch':''} · {trip.date}</p>{trip.state!=='recording'&&onEquipment&&<EquipmentButton trip={trip} items={vehicles} onOpen={onEquipment} disabled={busy}/>}</div><p className="muted"><MapPin size={14}/>{trip.location}</p></div></div>
   <ActivitySummary trip={trip} unit={unit}/>
   <EnergyConsent trip={trip} busy={busy} onResolve={accept=>perform('resolveEnergy',trip.id,accept)}/>
   <ActivityMoments trip={trip} local={local} busy={busy} adding={addingPhotos} onPhoto={showPhoto} onAddPhotos={addPhotos} onFindPhotos={findSuggestions}/>
   {trip.telemetryIncomplete&&<p className="notice">Route incomplete · Missing telemetry has not been reconstructed.</p>}
   {trip.sourceRecords&&<section className="notice"><h3>Recordings of this drive</h3><p>Both sources are preserved. Photos and notes stay with their originals.</p>{trip.sourceRecords.map(s=><button key={s.id} className="secondary" onClick={()=>onSource?.(s)}>View {s.source==='tesla'?'Tesla':'iPhone'} recording</button>)}</section>}
   {trip.state==='recording'&&<p role="status" className="notice">Automatic recording in progress. This activity updates as GPS arrives and continues in the same journey if movement resumes near a stop.</p>}
   {trip.provisional&&<p role="status" className="notice">Stopped and saved to History{continuationMinutes?`; ${continuationMinutes} minute${continuationMinutes===1?'':'s'} remain for the same activity near here`:''}. A different activity (walking after parking, or driving after a walk) is saved as its own journey.</p>}
   {segmentsAllowed&&(segmentDraft?<SegmentEditor key={segmentDraft.segmentID} trip={trip} draft={segmentDraft} unit={unit} busy={busy} onChange={range=>setSegmentDraft(d=>({...d,...range}))} onCancel={()=>setSegmentDraft(null)} onSave={saveSegment}/>:<CreateSegmentButton onClick={createSegment} disabled={busy}/>)}
   {!segmentDraft&&<SegmentList trip={trip} unit={unit} busy={busy} onEdit={segment=>setSegmentDraft({segmentID:segment.id,name:segment.name,start:segment.startIndex,end:segment.endIndex,existing:true})} onRename={renameSegment} onDelete={deleteSegment}/>}
   {canLinkTrail(trip)&&<TrailLink trip={trip} perform={perform} busy={busy}/>}
   {!segmentDraft&&trip.source==='device'&&trip.state==='finished'&&pointCount>=2&&<section className="notice route-trim">
    <h2>Route shown on map</h2>
    <p className="muted small-copy">Choose which part of this recording appears on the map. Original GPS points are kept. The map above updates as you drag.</p>
    <div className="route-range route-dual-slider">
     <div className="route-range-track" aria-hidden="true"><span style={{left:`${100*trimStart/(pointCount-1)}%`,right:`${100*(pointCount-1-trimEnd)/(pointCount-1)}%`}}/></div>
     <input aria-label="Visible route start" type="range" min="0" max={pointCount-1} value={trimStart} onChange={e=>setTrimStart(Math.min(Number(e.target.value),trimEnd-1))}/>
     <input aria-label="Visible route finish" type="range" min="0" max={pointCount-1} value={trimEnd} onChange={e=>setTrimEnd(Math.max(Number(e.target.value),trimStart+1))}/>
    </div>
    <div className="route-range-times"><span>Start · {pointTime(trimStart)}</span><span>Finish · {pointTime(trimEnd)}</span></div>
    <div className="detail-actions"><button type="button" className="secondary" onClick={()=>{setTrimStart(0);setTrimEnd(pointCount-1);}}>Show full route</button><button type="button" className="primary" disabled={busy||!trimValid||!trimChanged} onClick={applyTrim}>Save visible route</button></div>
   </section>}
   {message&&!suggestions&&<p role="status" className="muted small-copy">{message}</p>}
   <TripDiagnostics trip={trip}/>
   {grouping&&trip.state!=='recording'&&<JourneyTags onActivity={onSource} trip={trip} grouping={grouping} run={run}/>}<div className="record-metrics"><div><strong>{distanceText(trip.distance,unit)}</strong><span>Estimated distance</span></div><div><strong>{trip.source?`${Math.floor(trip.durationSeconds/60)}m ${Math.floor(trip.durationSeconds%60)}s`:`${trip.minutes} min`}</strong><span>Active duration</span></div><div><strong>{trip.source?speedLabel(trip.distanceMeters,trip.durationSeconds):'—'}</strong><span>Average speed</span></div></div>
   <HeartRatePanel trip={trip} owner={ownerID} unit={unit} busy={busy} onResolve={accept=>perform('resolveHeartRate',trip.id,accept)}/>
   {trip.details?.indoor&&<p className="muted small-copy">Indoor activity · no route was recorded.</p>}
   {overlaps.length>0&&<div className="notice" role="status"><strong>Recorded at the same time as</strong>{overlaps.map(item=><p key={item.activityID}>{item.title} · {Math.round(item.seconds/60)} min together{item.kind==='automatic'?' · detected automatically':item.kind==='watch'?' · recorded on Apple Watch':''}. Both are kept; delete the one you don’t want.</p>)}</div>}
   <div className="activity-facts"><p><strong>{trip.source==='tesla'?'Tesla vehicle telemetry · driver not identified':trip.isReconciled?'Linked source recordings':sourceLabel(trip)}</strong> · {trip.source==='simulator'?'Simulator GPS':trip.recordingMode==='automatic'?'Estimated / lower-resolution route':trip.recordingMode==='historical'?'No recorded geometry':trip.source==='tesla'?'Vehicle telemetry':'Accuracy-filtered GPS'}</p>{trip.vehicle&&<p>Vehicle: {trip.vehicle}</p>}{trip.collection&&<p>Collection: {trip.collection}</p>}{local&&<p>Average pace: {paceLabel(trip.distanceMeters,trip.durationSeconds)} · {pointCount} GPS samples · Local only</p>}{trip.classification&&<p>Prediction: {trip.classification.predicted} · {trip.classification.confidence} confidence {trip.corrected?'· Your correction is preserved':''}</p>}{trip.classification?.evidence?.map(e=><small key={e}>{e}</small>)}</div>
   {trip.recognisedStops?.length>0&&<section className="journey-timeline"><h2>Stops along the way</h2>{trip.recognisedStops.map(stop=><div className="journey-stop" key={stop.id}><strong>{stop.name}</strong>{onStopChange&&!trip.readOnly&&<button type="button" className="text-button" onClick={()=>onStopChange({type:'stop',id:stop.id,name:stop.name,tags:stop.tags,ignored:true})}>Not a stop</button>}<p>{Math.round(stop.durationSeconds/60)} min{stop.charging==='possible'?' · Possible charging':stop.charging==='confirmed'?' · Charging confirmed by vehicle':''}</p>{stop.nearbyName&&<p className="small-copy">Nearby: {stop.nearbyName}</p>}</div>)}</section>}
   <div className="detail-story"><div><p className="eyebrow">YOUR STORY</p><p>{trip.description||'Add a description to remember the little details.'}</p>{trip.notes&&<p>{trip.notes}</p>}<div className="tags">{trip.tags.map(t=><span key={t}>{t}</span>)}</div></div></div>
   {local&&trip.photos.length>0&&<div className="photo-management">{trip.photos.map(photo=><form key={photo.id} onSubmit={async e=>{e.preventDefault();await perform('editPhoto',{id:trip.id,photoID:photo.id,caption:new FormData(e.currentTarget).get('caption')});}}><PrivateImage src={photo.url} alt=""/><label>Photo caption<input name="caption" defaultValue={photo.caption} maxLength={500}/></label><span className="local-badge">{photo.locationSource} · Private</span><div className="detail-actions"><button className="secondary" disabled={busy}>Save caption</button><button type="button" className="secondary" disabled={busy} onClick={()=>perform('editPhoto',{id:trip.id,photoID:photo.id,cover:true})}>Use as cover</button><button type="button" className="text-button" disabled={busy} onClick={()=>perform('editPhoto',{id:trip.id,photoID:photo.id,remove:true})}>Remove photo</button></div></form>)}</div>}
   {suggestions&&<PhotoSuggestions key={`${ownerID||''}:${trip.id}`} suggestions={suggestions} existing={trip.photos} busy={busy} limited={limited} message={message} timeZone={timeZone} hasMore={suggestionPage.hasMore} total={suggestionPage.total} loadingMore={suggestionPage.loading} onLoadMore={()=>findSuggestions({append:true})} onImport={importSuggestion} onSkip={skipSuggestion} onClose={closeSuggestions}/>}
   {error&&<p role="alert" className="error">{error}</p>}{local&&<><button className="text-button delete-activity" onClick={()=>setDeleting(true)}><Trash2 size={16}/> Delete activity</button>{deleting&&<div className="notice"><h3>Permanently delete this activity?</h3><p>Its local route, photo copies and activity record will be removed. A deletion tombstone prevents a delayed save restoring it. Original photos in your library stay intact.</p><div className="detail-actions"><button className="secondary" onClick={()=>setDeleting(false)}>Cancel</button><button className="primary" disabled={busy} onClick={async()=>{if(await run('deleteActivity',trip.id))onDeleted();}}>Delete permanently</button></div></div>}</>}
  </ActivitySheet>
 </div></SwipeBack>;
}
