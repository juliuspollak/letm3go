import {useMemo,useState} from 'react';
import {Flag} from 'lucide-react';
import {SEGMENT_NAME_MAX,cleanSegmentName} from '../lib/namedSegments.js';
import {segmentLibrary} from '../lib/segmentRides.js';

// Looking after segments, apart from any one ride: a ride shows how you did on them,
// and this is where they are renamed, moved or removed.
export default function SegmentLibrary({journeys,run,busy,error,onChangeSection}){
 const rows=useMemo(()=>segmentLibrary(journeys),[journeys]);
 const [open,setOpen]=useState(null),[name,setName]=useState(''),[confirming,setConfirming]=useState(false);
 function choose(row){setOpen(open===row.id?null:row.id);setName(row.name);setConfirming(false);}
 async function rename(event,row){
  event.preventDefault();
  const clean=cleanSegmentName(name);
  if(clean)await run('saveNamedSegment',{id:row.activityID,segmentID:row.id,name:clean,start:row.startIndex,end:row.endIndex});
 }
 async function remove(row){
  if(await run('deleteNamedSegment',{id:row.activityID,segmentID:row.id})){setOpen(null);setConfirming(false);}
 }
 return <section className="garage-view">
  <p className="eyebrow">YOUR TRAILS</p><h2>My Segments</h2>
  {!rows.length&&<div className="empty"><Flag/><h3>No segments yet</h3><p>Open a ride and choose Create Segment.</p></div>}
  {rows.map(row=><div className="notice" key={row.id}>
   <button type="button" className="text-button" aria-expanded={open===row.id} onClick={()=>choose(row)}><Flag size={15} color={row.color} aria-hidden="true"/> {row.name}</button>
   <p className="muted small-copy">{row.total}× on {row.rideCount} ride{row.rideCount===1?'':'s'} · best {row.best} · made {row.when}</p>
   {open===row.id&&<>
    <form onSubmit={event=>rename(event,row)}><label>Name<input value={name} maxLength={SEGMENT_NAME_MAX} onChange={event=>setName(event.target.value)}/></label><button className="secondary" disabled={busy||!cleanSegmentName(name)||name===row.name}>Save name</button></form>
    <div className="detail-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>onChangeSection(row)}>Change section</button>{confirming?<button type="button" className="primary" disabled={busy} onClick={()=>remove(row)}>Delete segment</button>:<button type="button" className="text-button" onClick={()=>setConfirming(true)}>Delete</button>}</div>
    {confirming&&<p className="muted small-copy">Your rides are not changed.</p>}
   </>}
  </div>)}
  {error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
