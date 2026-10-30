import { useState } from 'react';
import { Flag, Undo2 } from 'lucide-react';
import { distanceText } from '../lib/distanceUnits.js';
import { SEGMENT_NAME_MAX, cleanSegmentName, namedSegments, segmentColor, segmentProblem, segmentStats } from '../lib/namedSegments.js';

const clock=seconds=>{const s=Math.max(0,Math.round(seconds||0)),h=Math.floor(s/3600),m=Math.floor(s/60)%60;return h?`${h} h ${m} min`:m?`${m} min ${s%60} s`:`${s%60} s`;};
// Short sections read better in metres.
const length=(meters,unit)=>unit==='km'&&meters<1000?`${Math.round(meters)} m`:distanceText(meters/1000,unit);
const time=point=>point?new Date(point.timestamp*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit',second:'2-digit'}):'—';

// Choose a section of the recording like trimming a video: two handles on the
// recording's own GPS fixes, the map highlighting the section as they move, a
// name, Save. The recording and its visible route are never changed.
export function SegmentEditor({trip,draft,onChange,onCancel,onSave,busy,unit='km'}){
 const points=trip.points||[],last=points.length-1;
 const [name,setName]=useState(draft.name||''),[history,setHistory]=useState([]),[tried,setTried]=useState(false);
 const {start,end}=draft;
 const stats=segmentStats(trip,start,end);
 const cleanName=cleanSegmentName(name);
 // Each drag or key press can be undone: the range before it is remembered.
 const remember=()=>setHistory(h=>h.at(-1)?.start===start&&h.at(-1)?.end===end?h:[...h.slice(-19),{start,end}]);
 const undo=()=>{const previous=history.at(-1);if(!previous)return;setHistory(h=>h.slice(0,-1));onChange(previous);};
 const handle=(which,value)=>which==='start'?onChange({start:Math.min(value,end-1),end}):onChange({start,end:Math.max(value,start+1)});
 const gesture={onPointerDown:remember,onKeyDown:remember,onTouchStart:remember};
 async function save(e){
  e.preventDefault();setTried(true);
  if(!cleanName||!stats.valid)return;
  await onSave({name:cleanName,start,end});
 }
 return <form className="notice segment-editor" aria-label={draft.existing?'Edit segment':'Create segment'} onSubmit={save}>
  <h2>{draft.existing?'Edit segment':'Create segment'}</h2>
  <p className="muted small-copy">Drag the handles until the highlighted section is right.</p>
  <div className="route-range route-dual-slider segment-range">
   <div className="route-range-track" aria-hidden="true"><span style={{left:`${100*start/last}%`,right:`${100*(last-end)/last}%`}}/></div>
   <input aria-label="Segment start" type="range" min="0" max={last} value={start} {...gesture} onChange={e=>handle('start',Number(e.target.value))}/>
   <input aria-label="Segment finish" type="range" min="0" max={last} value={end} {...gesture} onChange={e=>handle('end',Number(e.target.value))}/>
  </div>
  <dl className="segment-stats">
   <div><dt>Start</dt><dd>{time(points[start])}</dd></div>
   <div><dt>Finish</dt><dd>{time(points[end])}</dd></div>
   <div><dt>Distance</dt><dd>{length(stats.distanceMeters,unit)}</dd></div>
   <div><dt>Duration</dt><dd>{clock(stats.durationSeconds)}</dd></div>
  </dl>
  {stats.gapSeconds>0&&<p className="muted small-copy">Includes {clock(stats.gapSeconds)} without GPS; that stretch is not drawn or counted.</p>}
  {!stats.valid&&<p className="muted small-copy" role="status">{segmentProblem(stats.problem)}</p>}
  <label className="segment-name">Segment name<input value={name} maxLength={SEGMENT_NAME_MAX} placeholder="Rock Garden Descent" aria-invalid={tried&&!cleanName} onChange={e=>setName(e.target.value)}/></label>
  {tried&&!cleanName&&<p className="error" role="alert">Name the segment to save it.</p>}
  <div className="detail-actions segment-actions">
   <button type="button" className="secondary" onClick={undo} disabled={!history.length} aria-label="Undo handle change"><Undo2 size={16}/> Undo</button>
   <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
   <button type="submit" className="primary" disabled={busy||!stats.valid}>{busy?'Saving…':'Save Segment'}</button>
  </div>
 </form>;
}

// The saved segments of a recording, in their map colours. Tap one for its
// summary and Edit, Rename or Delete.
export function SegmentList({trip,onEdit,onRename,onDelete,busy,unit='km'}){
 const segments=namedSegments(trip);
 const [open,setOpen]=useState(null),[renaming,setRenaming]=useState(''),[confirm,setConfirm]=useState(false);
 if(!segments.length)return null;
 const points=trip.points||[];
 return <section className="segment-list" aria-label="Segments">
  <h2>Segments</h2>
  <ul>{segments.map(segment=>{
   const selected=open===segment.id;
   return <li key={segment.id} className={selected?'open':''}>
    <button type="button" className="segment-chip" aria-expanded={selected} onClick={()=>{setOpen(selected?null:segment.id);setRenaming('');setConfirm(false);}}>
     <span className="segment-swatch" style={{background:segmentColor(segment.colorIndex)}} aria-hidden="true"/>
     <strong>{segment.name}</strong>
     <span>{length(segment.distanceMeters,unit)} · {clock(segment.durationSeconds)}</span>
    </button>
    {selected&&<div className="segment-summary">
     <p className="muted small-copy">{time(points[segment.startIndex])} – {time(points[segment.endIndex])} · {segment.pointCount} GPS points · Private</p>
     {renaming!==''?<form className="segment-rename" onSubmit={async e=>{e.preventDefault();const name=cleanSegmentName(renaming);if(name&&await onRename(segment,name))setRenaming('');}}>
      <label>New name<input value={renaming} maxLength={SEGMENT_NAME_MAX} onChange={e=>setRenaming(e.target.value)} autoFocus/></label>
      <div className="detail-actions"><button type="button" className="secondary" onClick={()=>setRenaming('')}>Cancel</button><button className="primary" disabled={busy||!cleanSegmentName(renaming)}>Save name</button></div>
     </form>:confirm?<div className="segment-delete"><p>Delete “{segment.name}”? The recording is not changed.</p>
      <div className="detail-actions"><button type="button" className="secondary" onClick={()=>setConfirm(false)}>Keep</button><button type="button" className="primary" disabled={busy} onClick={async()=>{if(await onDelete(segment)){setOpen(null);setConfirm(false);}}}>Delete segment</button></div>
     </div>:<div className="detail-actions">
      <button type="button" className="secondary" onClick={()=>onEdit(segment)}>Edit</button>
      <button type="button" className="secondary" onClick={()=>setRenaming(segment.name)}>Rename</button>
      <button type="button" className="secondary" onClick={()=>setConfirm(true)}>Delete</button>
     </div>}
    </div>}
   </li>;
  })}</ul>
 </section>;
}

export function CreateSegmentButton({onClick,disabled}){
 return <button type="button" className="secondary full create-segment" onClick={onClick} disabled={disabled}><Flag size={16}/> Create Segment</button>;
}
