import {useEffect,useMemo,useState} from 'react';
import {Flag,Pencil,Scissors,Trash2,Upload} from 'lucide-react';
import JourneyMap from './JourneyMap.jsx';
import {activityLabel} from '../lib/activityNames.js';
import {distanceText} from '../lib/distanceUnits.js';
import {geometryDistance} from '../lib/mtb.js';
import {parseGpx,validateGpx} from '../lib/gpx.js';
import {deleteSegment,effortTime,segmentDetail,updateSegment} from '../lib/segmentsApi.js';

const NONE=[];
// One segment's details, the same wherever it is opened from: the Segments
// library, the Map's Segments layer or a notification. Its creator and admins
// (the server's `can_edit`) can rename it, move its start and finish, replace
// its route from a GPX file or delete it. None of this touches any activity.
export default function SegmentDetail({id,unit='km',onChanged,onDeleted}){
 const [state,setState]=useState({id:null,segment:null,error:''});
 const [reload,setReload]=useState(0);
 const [mode,setMode]=useState(null);
 const [busy,setBusy]=useState(false),[actionError,setActionError]=useState('');
 useEffect(()=>{
  let alive=true;
  segmentDetail(id).then(segment=>{if(alive)setState({id,segment,error:segment?'':'This segment is no longer available.'});})
   .catch(error=>{if(alive)setState({id,segment:null,error:error.message});});
  return()=>{alive=false;};
 },[id,reload]);
 const segment=state.id===id?state.segment:null;
 const loading=state.id!==id;
 if(loading)return <p role="status" className="muted">Loading segment…</p>;
 if(!segment)return <div className="empty"><Flag/><h3>Segment unavailable</h3><p>{state.error}</p><button type="button" className="secondary" onClick={()=>setReload(n=>n+1)}>Retry</button></div>;
 if(segment.deleted)return <div className="empty"><Flag/><h3>{segment.name}</h3><p>This segment was deleted. It is no longer shown to anyone.</p></div>;
 const run=async(action,after)=>{
  setBusy(true);setActionError('');
  try{await action();setMode(null);after?.();}catch(error){setActionError(error.message);}finally{setBusy(false);}
 };
 const saved=()=>{setReload(n=>n+1);onChanged?.(id);};
 const stats=segment.stats||{};
 return <article className="segment-detail" aria-label={`Segment ${segment.name}`}>
  <p className="eyebrow">{segment.activity?activityLabel(segment.activity).toUpperCase():'COMMUNITY SEGMENT'}</p>
  <h2>{segment.name}</h2>
  <p className="muted">{distanceText(segment.distance_meters/1000,unit)} · {segment.mine?'Created by you':`Created by ${segment.creator_name}`} · {new Date(segment.created_at).toLocaleDateString()}</p>
  {mode!=='trim'&&<SegmentMap segment={segment}/>}
  {mode==='trim'&&<TrimRoute segment={segment} unit={unit} busy={busy} onCancel={()=>setMode(null)} onSave={geometry=>run(()=>updateSegment(id,{geometry,note:'start and finish moved'}),saved)}/>}
  <dl className="segment-stats">
   <div><dt>Efforts</dt><dd>{stats.efforts??0}</dd></div>
   <div><dt>People</dt><dd>{stats.athletes??0}</dd></div>
   <div><dt>Best time</dt><dd>{effortTime(stats.best_seconds)}</dd></div>
   <div><dt>Your best</dt><dd>{effortTime(stats.my_best_seconds)}</dd></div>
   <div><dt>Your efforts</dt><dd>{stats.my_efforts??0}</dd></div>
  </dl>
  {!stats.efforts&&<p className="muted small-copy">No efforts yet. Rides, walks and runs that pass along it are matched after they sync.</p>}
  {segment.mine&&segment.status!=='approved'&&<p className="notice">This segment is not public ({segment.status.replace('_',' ')}).</p>}
  {segment.can_edit&&mode===null&&<div className="detail-actions segment-actions">
   <button type="button" className="secondary" onClick={()=>setMode('rename')}><Pencil size={16}/> Rename</button>
   <button type="button" className="secondary" onClick={()=>setMode('trim')}><Scissors size={16}/> Start &amp; finish</button>
   <label className="secondary segment-gpx"><Upload size={16}/> Replace route (GPX)<input type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" className="sr-only" onChange={async event=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    try{
     const {points}=parseGpx(await file.text());const check=validateGpx(points);
     if(!check.ok)throw new Error(check.reason);
     await run(()=>updateSegment(id,{geometry:points.map(([lat,lon])=>[lat,lon]),note:'route replaced from GPX'}),saved);
    }catch(error){setActionError(error.message);}
   }}/></label>
   <button type="button" className="text-button danger" onClick={()=>setMode('delete')}><Trash2 size={16}/> Delete</button>
  </div>}
  {mode==='rename'&&<RenameSegment segment={segment} busy={busy} onCancel={()=>setMode(null)} onSave={name=>run(()=>updateSegment(id,{name}),saved)}/>}
  {mode==='delete'&&<div className="notice" role="alertdialog" aria-label="Delete segment">
   <p><strong>Delete {segment.name}?</strong></p>
   <p className="muted small-copy">It disappears for everyone{segment.mine?'':', and its creator is told'}. Activities, including the one it was made from, are not changed.</p>
   <div className="detail-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setMode(null)}>Cancel</button>
    <button type="button" className="primary danger" disabled={busy} onClick={()=>run(()=>deleteSegment(id),()=>onDeleted?.(id))}>{busy?'Deleting…':'Delete segment'}</button></div>
  </div>}
  {actionError&&<p role="alert" className="error">{actionError}</p>}
  {segment.can_edit&&!segment.mine&&<p className="muted small-copy">You are editing someone else’s segment as an admin. They are told about changes.</p>}
 </article>;
}

function SegmentMap({segment,geometry=segment.geometry}){
 const layer=useMemo(()=>[{...segment,geometry}],[segment,geometry]);
 return <div className="segment-map"><JourneyMap journeys={NONE} segmentLayer={layer}/></div>;
}

function RenameSegment({segment,busy,onCancel,onSave}){
 const [name,setName]=useState(segment.name);
 const clean=name.trim();
 return <form className="segment-rename" onSubmit={event=>{event.preventDefault();if(clean&&clean!==segment.name)onSave(clean);}}>
  <label>Name<input value={name} maxLength={150} autoFocus onChange={event=>setName(event.target.value)}/></label>
  <div className="detail-actions"><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button className="primary" disabled={busy||!clean||clean===segment.name}>Save name</button></div>
 </form>;
}

// Moves the start and finish along the current route. A new version is saved;
// earlier versions stay on the server.
function TrimRoute({segment,unit,busy,onCancel,onSave}){
 const last=segment.geometry.length-1;
 const [range,setRange]=useState([0,last]);
 const geometry=useMemo(()=>segment.geometry.slice(range[0],range[1]+1),[segment.geometry,range]);
 const metres=geometryDistance(geometry);
 const valid=geometry.length>=5&&metres>=50;
 return <div className="segment-trim">
  <SegmentMap segment={segment} geometry={geometry}/>
  <label>Start<input type="range" min={0} max={last} value={range[0]} onChange={event=>{const v=Number(event.target.value);setRange(([,end])=>[Math.min(v,end-1),end]);}}/></label>
  <label>Finish<input type="range" min={0} max={last} value={range[1]} onChange={event=>{const v=Number(event.target.value);setRange(([start])=>[start,Math.max(v,start+1)]);}}/></label>
  <p className="muted small-copy">{distanceText(metres/1000,unit)}{valid?'':' · a segment needs at least 50 m and 5 points'}</p>
  <div className="detail-actions"><button type="button" className="secondary" onClick={onCancel}>Cancel</button>
   <button type="button" className="primary" disabled={busy||!valid||(range[0]===0&&range[1]===last)} onClick={()=>onSave(geometry.map(([lat,lon])=>[lat,lon]))}>{busy?'Saving…':'Save start & finish'}</button></div>
 </div>;
}
