import {useState} from 'react';
import {Tag,Plus,X} from 'lucide-react';
export default function JourneyTags({trip,grouping}){
 const anchor=trip.segmentIDs?.[0]||trip.id;
 const custom=grouping.metadata.manualTags?.[anchor]||[];
 const [value,setValue]=useState('');
 async function save(tags){await grouping.act({type:'manualTags',anchor,tags});}
 return <section className="journey-custom-tags"><h3><Tag size={17}/> Your tags</h3><p className="muted small-copy">Add your own tags, separate from automatically recognised places and stops.</p><div className="tags">{custom.map(tag=><span key={tag} className="manual-tag">{tag}<button type="button" aria-label={`Remove tag ${tag}`} disabled={grouping.busy} onClick={()=>void save(custom.filter(t=>t!==tag))}><X size={13}/></button></span>)}</div>
 {!trip.readOnly&&<form onSubmit={async e=>{e.preventDefault();const tag=value.trim();if(!tag||custom.some(t=>t.toLowerCase()===tag.toLowerCase()))return;if(await grouping.act({type:'manualTags',anchor,tags:[...custom,tag]}))setValue('');}}><input aria-label="New custom tag" value={value} maxLength={50} placeholder="e.g. Bottle return, Weekend…" onChange={e=>setValue(e.target.value)}/><button type="submit" className="secondary" disabled={grouping.busy||!value.trim()||custom.length>=20}><Plus size={16}/> Add tag</button></form>}
 {grouping.error&&<p role="alert" className="error">{grouping.error}</p>}</section>;
}
