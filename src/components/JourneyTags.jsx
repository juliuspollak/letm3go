import {useState} from 'react';
import {Tag,Plus,X} from 'lucide-react';
export default function JourneyTags({trip,grouping,run}){
 const anchor=trip.segmentIDs?.[0]||trip.id;
 const custom=grouping.metadata.manualTags?.[anchor]||[];
 const [value,setValue]=useState(''),[remember,setRemember]=useState(false),[notice,setNotice]=useState('');
 const end=(trip.segments?.at(-1)||trip).points?.at(-1);
 const canRemember=Number.isFinite(end?.latitude)&&Number.isFinite(end?.longitude)&&typeof run==='function';
 async function save(tags){await grouping.act({type:'manualTags',anchor,tags});}
 return <section className="journey-custom-tags"><h3><Tag size={17}/> Your tags</h3><p className="muted small-copy">Personal tags describe this trip. To recognise a destination on future visits, also save it as a place.</p><div className="tags">{custom.map(tag=><span key={tag} className="manual-tag">{tag}<button type="button" aria-label={`Remove tag ${tag}`} disabled={grouping.busy||trip.readOnly} onClick={()=>void save(custom.filter(t=>t!==tag))}><X size={13}/></button></span>)}</div>
 {!trip.readOnly&&<form onSubmit={async e=>{e.preventDefault();setNotice('');const tag=value.trim();if(!tag||custom.some(t=>t.toLowerCase()===tag.toLowerCase()))return;
  if(remember&&canRemember){
   const result=await run('savePlace',{name:tag,kind:'favourite',latitude:end.latitude,longitude:end.longitude,radius:200});
   if(!result){setNotice('Could not save the destination. No tag was added.');return;}
  }
  if(await grouping.act({type:'manualTags',anchor,tags:[...custom,tag]})){setValue('');setRemember(false);setNotice(remember?'Saved as a favourite place. Future trips ending nearby will use this name.':'Tag added to this trip.');}
 }}><input aria-label="New custom tag" value={value} maxLength={50} placeholder="e.g. Stockland Shellharbour" onChange={e=>setValue(e.target.value)}/><button type="submit" className="secondary" disabled={grouping.busy||!value.trim()||custom.length>=20}><Plus size={16}/> Add tag</button>{canRemember&&<label className="journey-remember-place"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/> Remember the destination for future trips (200 m radius)</label>}</form>}
 {notice&&<p role="status" className="muted small-copy">{notice}</p>}
 {grouping.error&&<p role="alert" className="error">{grouping.error}</p>}</section>;
}
