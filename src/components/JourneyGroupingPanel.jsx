import {useState} from 'react';
export default function JourneyGroupingPanel({activities,grouping,onClose}){
 const [selected,setSelected]=useState([]);
 const drives=activities.filter(t=>t.activity==='Driving'&&t.endedAt!=null).sort((a,b)=>a.startedAt-b.startedAt);
 return <section className="journey-grouping-panel"><h2>Group journeys</h2><p className="muted small-copy">Combine consecutive drives into one journey. Original routes and edits stay intact. Only your own drives can be grouped; known different vehicles stay separate.</p>
 {grouping.suggestions.length>0&&<section><h3>Possible continuations</h3>{grouping.suggestions.map(s=><div key={s.id} className="journey-suggestion"><strong>{s.stop?.name||'Nearby stop'}</strong><p className="small-copy">{s.reason}</p><button className="secondary" disabled={grouping.busy} onClick={()=>grouping.act({type:'merge',ids:s.segmentIDs})}>Continue as one journey</button><button className="text-button" disabled={grouping.busy} onClick={()=>grouping.act({type:'split',after:s.segmentIDs[0],before:s.segmentIDs[1]})}>Keep separate</button></div>)}</section>}
 <h3>Select drives to merge</h3><div className="journey-merge-list">{drives.map(t=><label key={t.id}><input type="checkbox" checked={selected.includes(t.id)} onChange={e=>setSelected(e.target.checked?[...selected,t.id]:selected.filter(id=>id!==t.id))}/><span><strong>{t.title}</strong><small>{new Date(t.startedAt*1000).toLocaleString()} · {t.distance} km · {t.vehicle||'Vehicle unassigned'}</small></span></label>)}</div>
 {!drives.length&&<p>No completed drives yet.</p>}<button type="button" className="primary full" disabled={grouping.busy||selected.length<2} onClick={async()=>{if(await grouping.act({type:'merge',ids:selected})){setSelected([]);onClose();}}}>Merge selected drives</button>
 {(grouping.metadata.history||[]).length>0&&<button type="button" className="secondary full" disabled={grouping.busy} onClick={()=>grouping.act({type:'undo'})}>Undo last grouping change</button>}
 {grouping.error&&<p role="alert" className="error">{grouping.error}</p>}</section>;
}
