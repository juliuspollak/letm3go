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
  if(scanning)return;
  setScanning(true);setSuggestions([]);setNotice('Preparing route locations…');
  const segments=trip.segments?.length?trip.segments:[trip];
  const samples=[];
  for(const segment of segments){
   const points=Array.isArray(segment.points)&&segment.points.length?segment.points:
    (segment.routeSegments||[]).flat().map(p=>Array.isArray(p)?{latitude:p[0],longitude:p[1]}:p);
   if(!points.length)continue;
   const count=Math.min(10,points.length);
   for(let i=0;i<count;i++){
    const index=Math.round(i*(points.length-1)/Math.max(1,count-1));
    const point=points[index];
    if(placeKey(point)&&!samples.some(item=>placeKey(item.point)===placeKey(point)))samples.push({point,index});
   }
  }
  if(!samples.length){setNotice('This activity has no usable GPS route points to search.');setScanning(false);return;}
  const result=[],errors=[];
  try{
   for(let n=0;n<samples.length;n++){
    setNotice(`Checking place ${n+1} of ${samples.length}…`);
    const {point}=samples[n],key=placeKey(point);
    let place=grouping.metadata.places?.[key];
    if(!place?.nearbyName&&!place?.categories?.length){
     try{
      // Pass the actual sampled coordinate. Displayed/trimmed indices are not native indices.
      place=await recorder.recogniseTripPlace(null,0,point);
     }catch(error){errors.push(error?.message||'Place lookup unavailable');continue;}
    }
    for(const name of [place?.nearbyName,...(place?.categories||[]),place?.locality].filter(Boolean)){
     if(typeof name!=='string'||name.length>50||result.some(x=>x.tag.toLowerCase()===name.toLowerCase())||hidden.some(x=>x.toLowerCase()===name.toLowerCase()))continue;
     result.push({tag:name,point:n,source:place?.source||'Apple Maps'});
    }
    const visible=result.filter(x=>!trip.tags?.some(t=>t.toLowerCase()===x.tag.toLowerCase()));
    setSuggestions([...visible]);
   }
   const available=result.filter(x=>!trip.tags?.some(t=>t.toLowerCase()===x.tag.toLowerCase()));
   setNotice(available.length?`Found ${available.length} place suggestions. Review them below.`:errors.length===samples.length?'Place lookup could not run. Check your connection and try again on your iPhone.':errors.length?`No new places found; ${errors.length} lookups failed. Try again with a connection.`:'No additional named places found along this route. You can still add a place name manually.');
  }catch(error){setNotice(error?.message||'Place search failed. Please try again.');}
  finally{setScanning(false);}
 }
 const end=(trip.segments?.at(-1)||trip).points?.at(-1);
 const canRemember=Number.isFinite(end?.latitude)&&Number.isFinite(end?.longitude)&&typeof run==='function';
 async function save(tags){await grouping.act({type:'manualTags',anchor,tags});}
 return <section className="journey-custom-tags"><h3><Tag size={17}/> Your tags</h3><p className="muted small-copy">Personal tags describe this trip. To recognise a destination on future visits, also save it as a place.</p><div className="tags">{autoTags.map(tag=><span key={tag} className="manual-tag">{tag}<button type="button" aria-label={`Hide tag ${tag}`} disabled={grouping.busy||trip.readOnly} onClick={()=>void grouping.act({type:'hideTag',anchor,tag})}><X size={13}/></button></span>)}{custom.map(tag=><span key={tag} className="manual-tag">{tag}<button type="button" aria-label={`Remove tag ${tag}`} disabled={grouping.busy||trip.readOnly} onClick={()=>void save(custom.filter(t=>t!==tag))}><X size={13}/></button></span>)}</div>
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
