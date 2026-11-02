import {compareRoutes} from '../lib/journeyGeometry.js';
import {scanRoutePlaces} from '../lib/routePlaceScan.js';
import {useState} from 'react';
import {Tag,Plus,X} from 'lucide-react';
export default function JourneyTags({trip,grouping,run,onActivity}){
 const anchor=trip.segmentIDs?.[0]||trip.id;
 const custom=grouping.metadata.manualTags?.[anchor]||[];
 const [value,setValue]=useState(''),[remember,setRemember]=useState(false),[notice,setNotice]=useState('');
 const [scanning,setScanning]=useState(false),[suggestions,setSuggestions]=useState([]),[visitsOpen,setVisitsOpen]=useState(false);
 const hidden=grouping.metadata.hiddenTags?.[anchor]||[];
 const destination=grouping.destinations?.find(d=>d.placeID===trip.recognition?.primary?.placeID);
 const autoTags=(trip.tags||[]).filter(t=>!custom.some(c=>c.toLowerCase()===t.toLowerCase()));
 async function scanRoute(){
  if(scanning)return;
  setScanning(true);setSuggestions([]);setNotice('Preparing route locations…');
  try{
   const result=await scanRoutePlaces(trip,{hidden,places:grouping.metadata.places,onProgress:({notice,suggestions})=>{setNotice(notice);if(suggestions)setSuggestions(suggestions);}});
   setSuggestions(result.suggestions);setNotice(result.notice);
  }catch(error){setNotice(error?.message||'Place search failed. Please try again.');}
  finally{setScanning(false);}
 }
 const end=(trip.segments?.at(-1)||trip).points?.at(-1);
 const canRemember=Number.isFinite(end?.latitude)&&Number.isFinite(end?.longitude)&&typeof run==='function';
 async function save(tags){await grouping.act({type:'manualTags',anchor,tags});}
 return <section className="journey-custom-tags"><h3><Tag size={17}/> Your tags</h3><p className="muted small-copy">Personal tags describe this trip. To recognise a destination on future visits, also save it as a place.</p><div className="tags">{autoTags.map(tag=><span key={tag} className="manual-tag">{tag}<button type="button" aria-label={`Hide tag ${tag}`} disabled={grouping.busy||trip.readOnly} onClick={()=>void grouping.act({type:'hideTag',anchor,tag})}><X size={13}/></button></span>)}{custom.map(tag=><span key={tag} className="manual-tag">{tag}<button type="button" aria-label={`Remove tag ${tag}`} disabled={grouping.busy||trip.readOnly} onClick={()=>void save(custom.filter(t=>t!==tag))}><X size={13}/></button></span>)}</div>
 {destination&&<details onToggle={e=>setVisitsOpen(e.currentTarget.open)}><summary>{destination.name} — Visited {destination.visits} {destination.visits===1?'time':'times'}</summary>{visitsOpen&&<ul>{destination.activities.map(activity=>{
  const related=grouping.journeys.find(j=>j.id===activity.id),comparison=related&&related.id!==trip.id?compareRoutes(trip,related):null;
  return <li key={activity.id}><button type="button" className="text-button" disabled={!onActivity||!related} onClick={()=>onActivity?.(related)}>{activity.title} · {new Date(activity.startedAt*1000).toLocaleDateString('en-AU')}</button>{comparison&&<small>{comparison.similar?'Similar GPS route':comparison.partial?'Partial route overlap':'Same destination; different or unverified route'}</small>}</li>;
 })}</ul>}</details>}
 {!trip.readOnly&&<div className="tag-review-tools"><button type="button" className="secondary" disabled={scanning||grouping.busy} onClick={()=>void scanRoute()}>{scanning?'Checking route…':'Find more places on this route'}</button>{suggestions.map(s=><div className="tag-suggestion" key={s.tag}><span><strong>{s.tag}</strong><small>{s.source}</small></span><button type="button" onClick={async()=>{if(await grouping.act({type:'manualTags',anchor,tags:[...custom,s.tag]}))setSuggestions(a=>a.filter(x=>x.tag!==s.tag));}} disabled={grouping.busy||custom.length>=20}>Add</button><button type="button" disabled={grouping.busy} onClick={async()=>{if(await grouping.act({type:'hideTag',anchor,tag:s.tag}))setSuggestions(a=>a.filter(x=>x.tag!==s.tag));}}>Skip</button></div>)}{hidden.length>0&&<details><summary>Hidden tags ({hidden.length})</summary>{hidden.map(tag=><button type="button" className="text-button" key={tag} onClick={()=>void grouping.act({type:'restoreTag',anchor,tag})}>Restore {tag}</button>)}</details>}</div>}
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
