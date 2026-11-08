import {compareRoutes} from '../lib/journeyGeometry.js';
import {scanRoutePlaces} from '../lib/routePlaceScan.js';
import {useState} from 'react';
import {Tag,Plus,X} from 'lucide-react';
import {knownTags,tagChoice,tagSuggestions} from '../lib/tagSearch.js';
import {tagNote,rememberLabel,tagAdded,placeSaved,REMEMBER_RADIUS} from '../lib/tagMessaging.js';
import {rememberDestinationPlace,rememberedPlaceAt} from '../lib/rememberedPlace.js';
// Two ideas, one section, never blurred: a tag describes this trip, a remembered
// place recognises the destination on future visits. Typing searches the tags the
// person already uses (from the journal already in memory, so no lookup per
// keystroke) and offers the ones not yet on this activity. A name that differs only
// by capitals or spacing reuses the existing spelling instead of adding a twin.
export default function JourneyTags({trip,grouping,run,onActivity}){
 const anchor=trip.segmentIDs?.[0]||trip.id;
 const custom=grouping.metadata.manualTags?.[anchor]||[];
 const hidden=grouping.metadata.hiddenTags?.[anchor]||[];
 const destination=grouping.destinations?.find(d=>d.placeID===trip.recognition?.primary?.placeID);
 const autoTags=(trip.tags||[]).filter(t=>!custom.some(c=>c.toLowerCase()===t.toLowerCase()));
 const applied=[...autoTags,...custom];
 const known=knownTags(grouping.journeys||[]);
 const end=(trip.segments?.at(-1)||trip).points?.at(-1);
 const remembered=rememberedPlaceAt(grouping.metadata.places,end);
 const canRemember=Number.isFinite(end?.latitude)&&Number.isFinite(end?.longitude)&&typeof run==='function';
 const [value,setValue]=useState(''),[remember,setRemember]=useState(false),[notice,setNotice]=useState('');
 const [picking,setPicking]=useState(false),[working,setWorking]=useState(false);
 const [scanning,setScanning]=useState(false),[suggestions,setSuggestions]=useState([]),[visitsOpen,setVisitsOpen]=useState(false);
 const matches=picking?tagSuggestions({known,applied,query:value}):[];
 const choice=picking?tagChoice({known,applied,query:value}):null;
 async function scanRoute(){
  if(scanning)return;
  setScanning(true);setSuggestions([]);setNotice('Preparing route locations…');
  try{
   const result=await scanRoutePlaces(trip,{hidden,places:grouping.metadata.places,onProgress:({notice,suggestions})=>{setNotice(notice);if(suggestions)setSuggestions(suggestions);}});
   setSuggestions(result.suggestions);setNotice(result.notice);
  }catch(error){setNotice(error?.message||'Place search failed. Please try again.');}
  finally{setScanning(false);}
 }
 async function save(tags){await grouping.act({type:'manualTags',anchor,tags});}
 // Adding a tag and remembering the destination are separate actions, so a tag
 // already on the trip never blocks remembering it — that was the silent no-op.
 async function commit(name){
  const chosen=tagChoice({known,applied,query:name});
  if(!chosen.name)return;
  const remembering=remember&&canRemember;
  if(chosen.applied&&!remembering){setNotice('That tag is already on this trip. Turn on “Remember the destination” to save it as a place.');return;}
  setNotice('');setWorking(true);
  let failure='';
  if(remembering){
   try{await rememberDestinationPlace({trip,run,grouping,name:chosen.name});}
   catch(error){failure=error?.message||'The destination could not be saved.';}
  }
  if(!chosen.applied&&!await grouping.act({type:'manualTags',anchor,tags:[...custom,chosen.name]})){setWorking(false);return;}
  setWorking(false);setValue('');setRemember(false);setPicking(false);
  setNotice(failure||(remembering?placeSaved(chosen.name):tagAdded));
 }

 return <section className="journey-custom-tags"><h3><Tag size={17}/> Your tags</h3><p className="muted small-copy">{tagNote({remembered})}</p><div className="tags">{autoTags.map(tag=><span key={tag} className="manual-tag">{tag}<button type="button" aria-label={`Hide tag ${tag}`} disabled={grouping.busy||trip.readOnly} onClick={()=>void grouping.act({type:'hideTag',anchor,tag})}><X size={13}/></button></span>)}{custom.map(tag=><span key={tag} className="manual-tag">{tag}<button type="button" aria-label={`Remove tag ${tag}`} disabled={grouping.busy||trip.readOnly} onClick={()=>void save(custom.filter(t=>t!==tag))}><X size={13}/></button></span>)}</div>
 {destination&&<details onToggle={e=>setVisitsOpen(e.currentTarget.open)}><summary>{destination.name} — Visited {destination.visits} {destination.visits===1?'time':'times'}</summary>{visitsOpen&&<ul>{destination.activities.map(activity=>{
  const related=grouping.journeys.find(j=>j.id===activity.id),comparison=related&&related.id!==trip.id?compareRoutes(trip,related):null;
  return <li key={activity.id}><button type="button" className="text-button" disabled={!onActivity||!related} onClick={()=>onActivity?.(related)}>{activity.title} · {new Date(activity.startedAt*1000).toLocaleDateString('en-AU')}</button>{comparison&&<small>{comparison.similar?'Similar GPS route':comparison.partial?'Partial route overlap':'Same destination; different or unverified route'}</small>}</li>;
 })}</ul>}</details>}
 {!trip.readOnly&&<div className="tag-review-tools"><button type="button" className="secondary" disabled={scanning||grouping.busy} onClick={()=>void scanRoute()}>{scanning?'Checking route…':'Find more places on this route'}</button>{suggestions.map(s=><div className="tag-suggestion" key={s.tag}><span><strong>{s.tag}</strong><small>{s.source}{s.kind==='destination'?' · at the end of this trip':''}</small></span><button type="button" onClick={async()=>{if(await grouping.act({type:'manualTags',anchor,tags:[...custom,s.tag]})){setSuggestions(a=>a.filter(x=>x.tag!==s.tag));setNotice(tagAdded);}}} disabled={grouping.busy||custom.length>=20}>Add</button><button type="button" disabled={grouping.busy} onClick={async()=>{if(await grouping.act({type:'hideTag',anchor,tag:s.tag}))setSuggestions(a=>a.filter(x=>x.tag!==s.tag));}}>Skip</button></div>)}{hidden.length>0&&<details><summary>Hidden tags ({hidden.length})</summary>{hidden.map(tag=><button type="button" className="text-button" key={tag} onClick={()=>void grouping.act({type:'restoreTag',anchor,tag})}>Restore {tag}</button>)}</details>}</div>}
 {!trip.readOnly&&<form onSubmit={e=>{e.preventDefault();void commit(value);}}>
  <div className="tag-picker">
   <input aria-label="New custom tag" value={value} maxLength={50} placeholder="Search or add a tag" autoComplete="off" enterKeyHint="done" onChange={e=>{setValue(e.target.value);setPicking(true);}} onFocus={()=>setPicking(true)}/>
   {picking&&(matches.length>0||choice?.create)&&<ul className="tag-suggestions" role="listbox" aria-label="Tag suggestions">{matches.map(name=><li key={name}><button type="button" role="option" aria-selected={false} onClick={()=>void commit(name)}><Tag size={13}/>{name}</button></li>)}{choice?.create&&<li><button type="button" role="option" aria-selected={false} onClick={()=>void commit(choice.name)}><Plus size={13}/>Create “{choice.name}”</button></li>}</ul>}
  </div>
  <button type="submit" className="secondary" disabled={grouping.busy||working||!choice?.name||(!choice.applied&&custom.length>=20)}><Plus size={16}/> {choice?.applied?'Remember':'Add tag'}</button>
  {canRemember&&<label className="journey-remember-place"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/> {rememberLabel(remembered?.radius||REMEMBER_RADIUS)}</label>}
 </form>}
 {notice&&<p role="status" className="muted small-copy">{notice}</p>}
 {grouping.error&&<p role="alert" className="error">{grouping.error}</p>}</section>;
}
