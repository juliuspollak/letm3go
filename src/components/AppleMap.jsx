import { Maximize2, Navigation } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { appleMaps, appleMapsAvailable } from '../lib/appleMaps.js';
export default function AppleMap({payload,onResult,large=false,picker=false,onLocate,locating=false}){
 const [preview,setPreview]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [themeVersion,setThemeVersion]=useState(0);
 useEffect(()=>{const changed=()=>setThemeVersion(v=>v+1);window.addEventListener('letm3go:theme-changed',changed);return()=>window.removeEventListener('letm3go:theme-changed',changed);},[]);
 const [mapID]=useState(()=>crypto.randomUUID());
 useEffect(()=>()=>{if(appleMapsAvailable())void appleMaps.close({mapID}).catch(()=>{});},[mapID]);
 const latest=useRef(onResult);useEffect(()=>{latest.current=onResult;},[onResult]);
 const data=JSON.stringify(payload);
 useEffect(()=>{let alive=true;if(!appleMapsAvailable())return;appleMaps.snapshot({...JSON.parse(data),width:700,height:large?600:350}).then(result=>{if(alive){setPreview(result.image);setError('');}}).catch(()=>{if(alive)setError('Map preview unavailable. Tap to open Apple Maps.');});return()=>{alive=false;};},[data,large,themeVersion]);
 async function open(){setBusy(true);setError('');try{const result=await appleMaps.open({...JSON.parse(data),picker,mapID});latest.current?.(result);}catch{setError('Apple Maps could not open. Please retry.');}finally{setBusy(false);}}
 return <div className="map-frame apple-map-frame"><button type="button" className={`${picker?'place-picker':'journey-map'} ${large?'large':''} apple-map-preview`} aria-label={picker?'Choose saved place in Apple Maps':'Open interactive Apple journey map'} disabled={busy||!appleMapsAvailable()} onClick={open}>{preview&&<img src={preview} alt="Apple map preview"/>}<span className="apple-map-attribution">Apple Maps</span><span className="apple-map-open">{busy?'Opening…':picker?'Choose location':'Explore map'} <Maximize2 size={16} strokeWidth={1.8} aria-hidden="true"/></span>{!preview&&<span className="apple-map-placeholder">{appleMapsAvailable()?'Apple Maps':'Maps are available in the iPhone app.'}</span>}</button>{onLocate&&<button type="button" className="map-locate-button" aria-label="Show my location" title="Show my location" disabled={locating} onClick={onLocate}><Navigation size={20}/></button>}{error&&<p role="status" className="notice">{error}</p>}</div>;
}
