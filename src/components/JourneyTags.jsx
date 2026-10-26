import {useState} from 'react';
import {recorder} from '../lib/recorder.js';
import {placeKey} from '../lib/journeyGrouping.js';
import {Tag,Plus,X} from 'lucide-react';
export default function JourneyTags({trip,grouping,run}){
 const anchor=trip.segmentIDs?.[0]||trip.id;
 const custom=grouping.metadata.manualTags?.[anchor]||[];
 const [value,setValue]=useState(''),[remember,setRemember]=useState(false),[notice,setNotice]=useState('');
 const [scanning,setScanning]=useState(false),[suggestions,setSuggestions]=useState([]);
 const hidden=grouping.metadata.hiddenTags?.[anchor]||[];
 const autoTags=(trip.tags||[]).filter(t=>!custom.some(c=>c.toLowerCase()===t.toLowerCase()));
 async function scanRoute(){
  if(scanning)return;setScanning(true);setNotice('');
  const result=[];const segments=trip.segments?.length?trip.segments:[trip];
  try{
   for(const seg of segments){
    if(!seg.points?.length)continue;
    const indexes=[0,Math.round((seg.points.length-1)*.2),Math.round((seg.points.length-1)*.4),Math.round((seg.points.length-1)*.6),Math.round((seg.points.length-1)*.8),seg.points.length-1];
    for(const index of [...new Set(indexes)]){
     const point=seg.points[index],key=placeKey(point);if(!key)continue;
     let place=grouping.metadata.places[key];
     if(!place?.locality&&!place?.nearbyName&&!place?.categories?.length)place=await recorder.recogniseTripPlace(seg.id,index,seg.source!=='device'&&seg.source!=='simulator'?point:null);
     for(const name of [place?.nearbyName,...(place?.categories||[]),place?.locality].filter(Boolean)){
      if(name.length>50||result.some(x=>x.tag.toLowerCase()===name.toLowerCase())||hidden.some(x=>x.toLowerCase()===name.toLowerCase()))continue;
      result.push({tag:name,point:index,source:place?.source||'Apple Maps'});
     }
    }
   }
   setSuggestions(result.filter(x=>!trip.tags?.some(t=>t.toLowerCase()===x.tag.toLowerCase())));
   setNotice(result.length?'Review the suggestions below. Nothing is added automatically by this scan.':'No additional named places were found.');
  }catch(e){setNotice(e.message||'Place lookup unavailable. Try again on your iPhone.');}
  finally{setScanning(false);}
 }
 const end=(trip.segments?.at(-1)||trip).points?.at(-1);
 const canRemember=Number.isFinite(end?.latitude)&&Number.isFinite(end?.longitude)&&typeof run==='function';
 async function save(tags){await grouping.act({type:'manualTags',anchor,tags});}
 return <section className="journey-custom-tags"><h3><Tag size={17}/> Your tags</h3><p className="muted small-copy">Personal tags describe this trip. To recognise a destination on future visits, also save it as a place.</p><div className="tags">{autoTags.map(tag=><span key={tag} className="manual-tag">{tag}<button type="button" aria-label={`Hide tag ${tag}`} disabled={grouping.busy||trip.readOnly} onClick={()=>void grouping.act({type:'hideTag',anchor,tag})}><X size={13}/></button></span>)}{custom.map(tag=><span key={tag} className="manual-tag">{tag}<button type="button" aria-label={`Remove tag ${tag}`} disabled={grouping.busy||trip.readOnly} onClick={()=>void save(custom.filter(t=>t!==tag))}><X size={13}/></button></span>)}</div>
 {!trip.readOnly&&<div className="tag-review-tools"><button type="button" className="secondary" disabled={scanning||grouping.busy} onClick={()=>void scanRoute()}>{scanning?'Checking route…':'Find more places on this route'}</button>{suggestions.map(s=><div className="tag-suggestion" key={s.tag}><span><strong>{s.tag}</strong><small>{s.source}</small></span><button type="button" onClick={async()=>{if(await grouping.act({type:'manualTags',anchor,tags:[...custom,s.tag]}))setSuggestions(a=>a.filter(x=>x.tag!==s.tag));}} disabled={grouping.busy||custom.length>=20}>Add</button><button type="button" onClick={()=>setSuggestions(a=>a.filter(x=>x.tag!==s.tag))}>Skip</button></div>)}{hidden.length>0&&<details><summary>Hidden tags ({hidden.length})</summary>{hidden.map(tag=><button type="button" className="text-button" key={tag} onClick={()=>void grouping.act({type:'restoreTag',anchor,tag})}>Restore {tag}</button>)}</details>}</div>}
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
