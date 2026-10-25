import { Maximize2, Navigation } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { appleMaps, appleMapsAvailable } from '../lib/appleMaps.js';
export default function AppleMap({payload,onResult,large=false,picker=false,onLocate,locating=false,trimRange=null}){
 const [preview,setPreview]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [projection,setProjection]=useState([]);
 const [themeVersion,setThemeVersion]=useState(0);
 useEffect(()=>{const changed=()=>setThemeVersion(v=>v+1);window.addEventListener('letm3go:theme-changed',changed);return()=>window.removeEventListener('letm3go:theme-changed',changed);},[]);
 const [mapID]=useState(()=>crypto.randomUUID());
 useEffect(()=>()=>{if(appleMapsAvailable())void appleMaps.close({mapID}).catch(()=>{});},[mapID]);
 const latest=useRef(onResult);useEffect(()=>{latest.current=onResult;},[onResult]);
 const data=JSON.stringify(payload);
 const isTrimPreview=Boolean(trimRange);
 const projected=projection.flat();
 const selected=trimRange&&projected.length>1?projected.slice(Math.min(projected.length-2,Math.floor(trimRange.start/(trimRange.points.length-1)*(projected.length-1))),Math.max(2,Math.ceil(trimRange.end/(trimRange.points.length-1)*(projected.length-1))+1)):[];
 useEffect(()=>{let alive=true;if(!appleMapsAvailable())return;appleMaps.snapshot({...JSON.parse(data),trimPreview:isTrimPreview,width:700,height:large?600:350}).then(result=>{if(alive){setPreview(result.image);setProjection(result.projection||[]);setError('');}}).catch(()=>{if(alive)setError('Map preview unavailable. Tap to open Apple Maps.');});return()=>{alive=false;};},[data,large,themeVersion,isTrimPreview]);
 async function open(){setBusy(true);setError('');try{const result=await appleMaps.open({...JSON.parse(data),picker,mapID});latest.current?.(result);}catch{setError('Apple Maps could not open. Please retry.');}finally{setBusy(false);}}
 return <div className="map-frame apple-map-frame"><button type="button" className={`${picker?'place-picker':'journey-map'} ${large?'large':''} ${isTrimPreview?'trim-preview':''} apple-map-preview`} aria-label={picker?'Choose saved place in Apple Maps':'Open interactive Apple journey map'} disabled={busy||!appleMapsAvailable()} onClick={open}>{preview&&<img src={preview} alt="Apple map preview"/>}{trimRange&&selected.length>1&&<svg className="trim-map-overlay" viewBox={`0 0 700 ${large?600:350}`} preserveAspectRatio="none" aria-hidden="true"><polyline points={selected.map(p=>p.join(',')).join(' ')} fill="none" stroke="white" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/><polyline points={selected.map(p=>p.join(',')).join(' ')} fill="none" stroke="#4659d9" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg>}<span className="apple-map-attribution">Apple Maps</span><span className="apple-map-open">{busy?'Opening…':picker?'Choose location':'Explore map'} <Maximize2 size={16} strokeWidth={1.8} aria-hidden="true"/></span>{!preview&&<span className="apple-map-placeholder">{appleMapsAvailable()?'Apple Maps':'Maps are available in the iPhone app.'}</span>}</button>{onLocate&&<button type="button" className="map-locate-button" aria-label="Show my location" title="Show my location" disabled={locating} onClick={onLocate}><Navigation size={20}/></button>}{error&&<p role="status" className="notice">{error}</p>}</div>;
}
