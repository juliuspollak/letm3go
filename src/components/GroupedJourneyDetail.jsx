import {activityLabel,activityCode} from '../lib/activityNames.js';
import {distanceText} from '../lib/distanceUnits.js';
import {useState} from 'react';
import {ArrowLeft,Pencil,ImagePlus,Camera} from 'lucide-react';
import PrivateImage from './PrivateImage.jsx';
import JourneyMap from './JourneyMap.jsx';
import JourneyTags from './JourneyTags.jsx';
import ActivityPrivacy from './ActivityPrivacy.jsx';
import ActivityDetail from './ActivityDetail.jsx';
import SwipeBack from './SwipeBack.jsx';
export default function GroupedJourneyDetail({ownerID,trip,grouping,onBack,activities,places,recording,onEdit,onPhoto,unit='km'}){
 const [segmentID,setSegmentID]=useState(null),[editing,setEditing]=useState(false),[name,setName]=useState(trip.title),[editingStop,setEditingStop]=useState(null);
 const photoSegments=trip.segments.filter(s=>s.source==='device'||s.source==='simulator');
 const [photoSegmentID,setPhotoSegmentID]=useState(photoSegments[0]?.id||'');
 const [photoMessage,setPhotoMessage]=useState('');
 const selectedPhotoSegment=photoSegments.find(s=>s.id===photoSegmentID)||photoSegments[0];
 async function addPhotos(){
  if(!selectedPhotoSegment)return;
  setPhotoMessage('');
  const result=await recording.run('pickPhotos',selectedPhotoSegment.id);
  if(result)setPhotoMessage('Photos added to this journey. If they do not appear yet, reopen the journey.');
 }

 const child=activities.find(s=>s.id===segmentID);
 if(child)return <ActivityDetail ownerID={ownerID} unit={unit} trip={child} onStopChange={grouping.act} places={places} onBack={()=>setSegmentID(null)} onEdit={()=>onEdit(child)} onPhoto={onPhoto} run={recording.run} onUpdated={()=>{}} onDeleted={()=>setSegmentID(null)} busy={recording.busy} error={recording.error}/>;
 return <SwipeBack onBack={onBack}><div className="detail page-enter"><button className="text-button back" onClick={onBack}><ArrowLeft size={18}/> Back to journeys</button><div className="activity-title-line"><h1>{trip.title}</h1>{!trip.readOnly&&<button className="icon-button" aria-label="Rename journey" onClick={()=>{setName(trip.title);setEditing(true);}}><Pencil size={17}/></button>}</div>
 {editing&&<form className="journey-rename" onSubmit={async e=>{e.preventDefault();if(await grouping.act({type:'rename',anchor:trip.segmentIDs[0],title:name}))setEditing(false);}}><label>Journey name<input value={name} maxLength={150} onChange={e=>setName(e.target.value)} required/></label><button className="primary" disabled={grouping.busy}>Save name</button></form>}
 <div className="activity-facts"><label>Journey activity <select aria-label="Change grouped journey activity" value={activityCode(trip.activity)} disabled={trip.readOnly||grouping.busy} onChange={event=>grouping.act({type:'classify',anchor:trip.segmentIDs[0],activity:event.target.value})}>{['Driving','Walking','Running','Cycling','MTB','Road cycling','Hiking','Kitesurfing','Other','Unknown'].map(type=><option key={type} value={type}>{activityLabel(type)}</option>)}</select></label></div><p className="muted small-copy">{trip.segments.length} activities · {trip.stops.length} stops · Grouping is private; sharing of each original activity is controlled separately below.</p><JourneyMap journeys={trip.segments} large onPhoto={onPhoto} embeddedEnabled={false}/><div className="record-metrics"><div><strong>{distanceText(trip.distance,unit)}</strong><span>Recorded distance</span></div><div><strong>{trip.minutes} min</strong><span>Activity time</span></div><div><strong>{Math.floor(trip.elapsedSeconds/60)} min</strong><span>Including stops</span></div></div>
 <JourneyTags trip={trip} grouping={grouping} run={recording.run}/><section className="journey-photos">
 <div className="section-heading"><h2>Journey photos</h2><span className="muted small-copy">{trip.photos?.length||0} photos</span></div>
 <div className="photo-strip">{trip.segments.flatMap(s=>(s.photos||[]).map(photo=>({photo,segment:s}))).map(({photo,segment})=><button type="button" key={`${segment.id}:${photo.id}`} onClick={()=>onPhoto?.(segment,photo.id)} aria-label={`View photo from ${segment.title}`}><PrivateImage src={photo.url} alt={photo.caption||'Journey photo'}/></button>)}</div>
 {!trip.readOnly&&selectedPhotoSegment&&<div className="journey-photo-actions">
  {photoSegments.length>1&&<label>Attach photos to <select aria-label="Choose journey recording for photos" value={selectedPhotoSegment.id} onChange={e=>setPhotoSegmentID(e.target.value)}>{photoSegments.map(s=><option key={s.id} value={s.id}>{s.title} · {new Date(s.startedAt*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}</option>)}</select></label>}
  <div className="detail-actions"><button type="button" className="secondary" disabled={recording.busy} onClick={addPhotos}><ImagePlus size={17}/> Add photos</button><button type="button" className="text-button" disabled={recording.busy} onClick={()=>setSegmentID(selectedPhotoSegment.id)}><Camera size={16}/> Find journey photos</button></div>
  <p className="muted small-copy">Photos are stored privately with the selected original recording, and shown together in this journey.</p>
  {photoMessage&&<p role="status" className="notice">{photoMessage}</p>}{recording.error&&<p role="alert" className="error">{recording.error}</p>}
 </div>}
 {!selectedPhotoSegment&&<p className="muted small-copy">Photos can be added to iPhone-recorded segments. Vehicle-imported journeys do not support local photo attachment yet.</p>}
 </section>
 <section className="journey-timeline"><h2>Segments & stops</h2>{trip.segments.map((s,i)=><div key={s.id} className="journey-timeline-item"><button type="button" className="journey-segment-link" onClick={()=>setSegmentID(s.id)}><strong>{s.title}</strong><small>{activityLabel(s.activity)} · {distanceText(s.distance,unit)} · {s.minutes} min · View original recording</small></button>{!trip.readOnly&&(s.source==='device'||s.source==='simulator')&&<div className="detail-actions"><button type="button" className="text-button" onClick={()=>onEdit(s)}><Pencil size={15}/> Edit activity</button><ActivityPrivacy trip={s} places={places||[]}/></div>}{trip.stops.filter(stop=>stop.afterSegmentID===s.id||stop.segmentID===s.id).map(stop=><div key={stop.id} className="journey-stop"><strong>{stop.name}</strong>{!trip.readOnly&&<button className="icon-button" aria-label={`Edit stop ${stop.name}`} onClick={()=>setEditingStop({id:stop.id,name:stop.name,tags:stop.tags.join(', ')})}><Pencil size={15}/></button>}<p>{Math.round(stop.durationSeconds/60)} min{stop.charging==='confirmed'?' · Charging confirmed by vehicle':stop.charging==='possible'?' · Possible charging (nearby infrastructure)':''}</p>{stop.nearbyName&&<p className="muted small-copy">Nearby: {stop.nearbyName}</p>}<button type="button" className="text-button" disabled={grouping.busy||trip.readOnly} onClick={()=>grouping.act({type:'stop',id:stop.id,name:stop.name,tags:stop.tags,replaceTags:true,ignored:true})}>Not a stop</button><div className="tags">{stop.tags.map(tag=><span key={tag}>{tag}</span>)}</div></div>)}{!trip.readOnly&&i<trip.segments.length-1&&<button className="text-button journey-split" disabled={grouping.busy} onClick={async()=>{if(await grouping.act({type:'split',after:s.id,before:trip.segments[i+1].id}))onBack();}}>Split journey here</button>}</div>)}</section>
 {editingStop&&<form className="journey-rename" onSubmit={async e=>{e.preventDefault();if(await grouping.act({type:'stop',replaceTags:true,id:editingStop.id,name:editingStop.name,tags:editingStop.tags.split(',').map(t=>t.trim()).filter(Boolean)}))setEditingStop(null);}}><label>Stop name<input value={editingStop.name} required maxLength={100} onChange={e=>setEditingStop({...editingStop,name:e.target.value})}/></label><label>Stop tags<input value={editingStop.tags} onChange={e=>setEditingStop({...editingStop,tags:e.target.value})}/></label><button className="primary" disabled={grouping.busy}>Save stop</button><button type="button" className="secondary" onClick={()=>setEditingStop(null)}>Cancel</button></form>}
 <p className="muted small-copy">Grouping changes only the journal view. All original recordings, telemetry, photos and corrections remain available above. Sharing permissions are managed on each original recording.</p><button className="secondary" disabled={trip.readOnly||grouping.busy||!grouping.metadata.history?.length} onClick={()=>grouping.act({type:'undo'})}>Undo last grouping change</button>{grouping.error&&<p role="alert" className="error">{grouping.error}</p>}</div></SwipeBack>;
}
